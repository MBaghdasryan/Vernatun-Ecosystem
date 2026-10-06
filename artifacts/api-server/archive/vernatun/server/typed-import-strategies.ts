import {z} from 'zod';
import type {PoolClient} from 'pg';
import type {Context} from './access.js';
import {ApiError} from './access.js';
import {day} from './finance-shared.js';
const number=z.string().trim().min(1).max(50),email=z.string().email().transform(s=>s.toLowerCase());
const unit=z.object({number,area:z.string().regex(/^\d{1,6}(\.\d{1,2})?$/).refine(s=>Number(s)>0&&Number(s)<=100000)}).strict();
const owner=z.object({unitNumber:number,email}).strict();
const resident=owner.extend({startsOn:day,endsOn:day,rentMinor:z.string().regex(/^\d{1,14}$/),currency:z.enum(['AMD','RUB','USD'])}).strict().refine(r=>r.endsOn>=r.startsOn);
const meter=z.object({unitNumber:number,serialNumber:z.string().trim().min(1).max(200),kind:z.enum(['water','electricity','gas'])}).strict();
const opening=z.object({unitNumber:number,email,amountMinor:z.string().regex(/^-?[1-9]\d{0,13}$/),currency:z.enum(['AMD','RUB','USD']),period:day.refine(s=>s.endsWith('-01')),reference:z.string().trim().min(1).max(100)}).strict();
export const entityType=z.enum(['units','owners','residents','meters','opening_balances']);
export type EntityType=z.infer<typeof entityType>;
export const strategies={units:unit,owners:owner,residents:resident,meters:meter,opening_balances:opening};
export function authorizeStrategy(c:Context,type:EntityType){
 const extra:Partial<Record<EntityType,string[]>>={owners:['roles.assign'],residents:['roles.assign'],opening_balances:['billing.publish','payments.reconcile']};
 if(!c.permissions.includes('imports.manage')&&!(type==='opening_balances'&&c.permissions.includes('imports.finance')))throw new ApiError(403,'import_type_forbidden');
 if(type==='opening_balances'&&c.building_id)throw new ApiError(403,'organization_scope_required');
 if(!c.organization_id||c.unit_id||!(extra[type]??[]).every(p=>c.permissions.includes(p)))throw new ApiError(403,'import_type_forbidden');
}
export async function validateRows(db:PoolClient,c:Context,building:string,type:EntityType,rows:Record<string,string>[]){
 const out:any[]=[],seen=new Set<string>(),residentUnits=new Set<string>();
 for(let n=0;n<rows.length;n++){
  const parsed=strategies[type].safeParse(rows[n]),errors:string[]=[];let mapped:any=rows[n],unitId:string|null=null,userId:string|null=null;
  if(!parsed.success)errors.push('invalid_values');
  else{
   mapped=parsed.data;const r=mapped,ref=type==='units'?building+'|'+r.number:type==='meters'?r.serialNumber:type==='opening_balances'?r.reference:building+'|'+r.unitNumber+'|'+r.email;
   if(seen.has(ref))errors.push('duplicate_source');seen.add(ref);
   if((await db.query('SELECT id FROM import_entity_refs WHERE organization_id=$1 AND entity_type=$2 AND reference=$3',[c.organization_id,type,ref])).rowCount)errors.push('already_imported');
   const u=(await db.query('SELECT id FROM units WHERE building_id=$1 AND organization_id=$2 AND number=$3',[building,c.organization_id,type==='units'?r.number:r.unitNumber])).rows[0];
   if(type==='units'){if(u)errors.push('duplicate_unit')}
   else if(!u)errors.push('unit_not_found');else unitId=u.id;
   if(r.email){
    const people=(await db.query('SELECT u.id FROM users u JOIN memberships m ON m.user_id=u.id WHERE lower(u.email)=$1 AND m.organization_id=$2 AND m.active AND NOT u.blocked',[r.email,c.organization_id])).rows;
    if(people.length!==1)errors.push('registered_org_account_required');else userId=people[0].id;
   }
   if(type==='owners'||type==='residents'){
    if(type==='residents'){if(residentUnits.has(r.unitNumber))errors.push('duplicate_resident_unit');residentUnits.add(r.unitNumber)}
    if(unitId&&userId&&(await db.query("SELECT id FROM role_assignments WHERE organization_id=$1 AND unit_id=$2 AND user_id=$3 AND role_key=$4 AND active",[c.organization_id,unitId,userId,type==='owners'?'unit_owner':'renter'])).rowCount)errors.push('duplicate_role');
    if(type==='residents'&&unitId&&(await db.query("SELECT id FROM role_assignments WHERE organization_id=$1 AND unit_id=$2 AND role_key='renter' AND active AND (expires_at IS NULL OR expires_at>now())",[c.organization_id,unitId])).rowCount)errors.push('occupied_unit');
   }
   if(type==='meters'&&(await db.query('SELECT id FROM meters WHERE organization_id=$1 AND serial_number=$2',[c.organization_id,r.serialNumber])).rowCount)errors.push('duplicate_meter');
   if(type==='opening_balances'&&unitId&&userId&&!(await db.query("SELECT id FROM role_assignments WHERE organization_id=$1 AND unit_id=$2 AND user_id=$3 AND role_key IN ('unit_owner','renter')",[c.organization_id,unitId,userId])).rowCount)errors.push('payer_account_mismatch');
  }
  out.push({sourceRow:n+2,source:rows[n],mapped,unitId,userId,state:errors.length?'invalid':'valid',errors});
 }
 return out;
}
export async function commitRow(db:PoolClient,c:Context,building:string,type:EntityType,row:any,actor:string){
 const r=row.mapped;let id:string,reference:string;
 if(type==='units'){
  id=(await db.query('INSERT INTO units(organization_id,building_id,number,area) VALUES($1,$2,$3,$4) RETURNING id',[c.organization_id,building,r.number,r.area])).rows[0].id;reference=building+'|'+r.number;
 }else if(type==='meters'){
  id=(await db.query('INSERT INTO meters(organization_id,unit_id,serial_number,kind) VALUES($1,$2,$3,$4) RETURNING id',[c.organization_id,row.unitId,r.serialNumber,r.kind])).rows[0].id;reference=r.serialNumber;
 }else if(type==='owners'||type==='residents'){
  id=(await db.query(`INSERT INTO role_assignments(user_id,organization_id,building_id,unit_id,role_key,starts_at,expires_at)
   SELECT $1,$2,$3,$4,$5,CASE WHEN $5='unit_owner' THEN now() ELSE $6::date::timestamp AT TIME ZONE o.timezone END,
   CASE WHEN $5='unit_owner' THEN NULL ELSE (($7::date+1)::timestamp AT TIME ZONE o.timezone)-interval '1 microsecond' END
   FROM organizations o WHERE o.id=$2 RETURNING id`,[row.userId,c.organization_id,building,row.unitId,type==='owners'?'unit_owner':'renter',r.startsOn??null,r.endsOn??null])).rows[0].id;
  if(type==='residents')await db.query('INSERT INTO leases(organization_id,unit_id,renter_id,starts_on,ends_on,amount_minor,currency,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[c.organization_id,row.unitId,row.userId,r.startsOn,r.endsOn,r.rentMinor,r.currency,actor]);
  reference=building+'|'+r.unitNumber+'|'+r.email;
 }else{
  reference=r.reference;const amount=BigInt(r.amountMinor);
  if(amount>0n){
   id=(await db.query("INSERT INTO invoices(organization_id,unit_id,payer_user_id,period,amount_minor,currency,status,created_by) VALUES($1,$2,$3,$4,$5,$6,'draft',$7) RETURNING id",[c.organization_id,row.unitId,row.userId,r.period,amount.toString(),r.currency,actor])).rows[0].id;
   await db.query("INSERT INTO invoice_lines(invoice_id,description,quantity_hundredths,rate_minor,amount_minor) VALUES($1,'Opening balance',100,$2,$2)",[id,amount.toString()]);
   await db.query("UPDATE invoices SET status='published',published_at=now(),published_by=$2 WHERE id=$1",[id,actor]);
  }else{
   id=(await db.query("INSERT INTO payments(organization_id,payer_user_id,amount_minor,currency,source,reference,confirmed_by) VALUES($1,$2,$3,$4,'opening_balance',$5,$6) RETURNING id",[c.organization_id,row.userId,(-amount).toString(),r.currency,'opening:'+reference,actor])).rows[0].id;
   await db.query('INSERT INTO payment_accounts(payment_id,organization_id,unit_id,payer_user_id,created_by) VALUES($1,$2,$3,$4,$5)',[id,c.organization_id,row.unitId,row.userId,actor]);
  }
 }
 return {id,reference};
}
