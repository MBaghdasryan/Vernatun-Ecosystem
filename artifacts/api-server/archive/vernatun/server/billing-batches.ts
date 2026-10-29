import {Router} from 'express';
import {pool} from './db.js';
import {ApiError,requireAuth,requirePermission,type Context} from './access.js';
import {transaction,idempotent,record} from './operations.js';
import {uuid,day,hash,amountLimit,version} from './finance-shared.js';
import {z} from 'zod';
import type {PoolClient} from 'pg';
import {resolvePayers} from './payer-responsibility-store.js';
import {calculateRuleBilling} from './billing-configuration.js';
export const billingBatches=Router();billingBatches.use(requireAuth);
const input=z.object({buildingId:uuid,period:day.refine(s=>s.endsWith('-01')),tariffId:uuid}).strict();
async function calculate(db:PoolClient,c:Context,b:z.infer<typeof input>,lock=false){
 const building=(await db.query('SELECT id,name FROM buildings WHERE id=$1 AND organization_id=$2'+(lock?' FOR UPDATE':''),[b.buildingId,c.organization_id])).rows[0];
 if(!building||c.building_id&&c.building_id!==building.id||c.unit_id)throw new ApiError(404,'not_found');
 const tariff=(await db.query('SELECT t.*,s.name FROM tariffs t JOIN services s ON s.id=t.service_id WHERE t.id=$1 AND t.organization_id=$2'+(lock?' FOR SHARE OF t':''),[b.tariffId,c.organization_id])).rows[0];
 if(!tariff)throw new ApiError(404,'not_found');
  // Lock units in id order before payer assignments; lease changes and direct
  // billing use the same unit-first serialization boundary.
  const units=(await db.query('SELECT id,number,area::text FROM units WHERE building_id=$1 AND organization_id=$2 ORDER BY id LIMIT 1001'+(lock?' FOR SHARE':''),[building.id,c.organization_id])).rows;
 if(units.length>1000)throw new ApiError(400,'batch_too_large');
 if(lock)for(const unit of units)await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[unit.id+tariff.service_id]);
 const payers=(await db.query(`SELECT p.*,p.starts_on::text,p.ends_on::text FROM payer_assignments p JOIN units u ON u.id=p.unit_id
 WHERE p.organization_id=$1 AND u.building_id=$2 AND p.service_id=$3 AND p.starts_on<=$4 AND (p.ends_on IS NULL OR p.ends_on>=$4) ORDER BY p.id ${lock?'FOR UPDATE OF p':''}`,[c.organization_id,building.id,tariff.service_id,b.period])).rows;
 const effective=new Map((await resolvePayers(db,payers.map(p=>p.id),b.period,lock)).map(p=>[p.id,p]));
 const prior=(await db.query('SELECT payer_assignment_id,tariff_id,invoice_id FROM charges WHERE organization_id=$1 AND period=$2',[c.organization_id,b.period])).rows;
 const charges:Record<string,any>[]=[];const skipped:Record<string,any>[]=[];let total=0n;
 for(const unit of units){
  const choices=payers.filter(p=>p.unit_id===unit.id);const p=choices[0];
  const old=p&&prior.find(r=>r.payer_assignment_id===p.id);
  const code=choices.length!==1?(choices.length?'payer_overlap':'no_payer_rule'):old?'already_calculated':null;
  if(code){skipped.push({unitId:unit.id,number:unit.number,code,invoiceId:old?.invoice_id});continue}
  const [whole,fraction='']=unit.area.split('.');
  const quantity=tariff.basis==='unit'?100n:BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
  const amount=(BigInt(tariff.amount_minor)*quantity+50n)/100n;
  if(amount<=0n||amount>amountLimit){skipped.push({unitId:unit.id,number:unit.number,code:'invalid_amount'});continue}
   charges.push({unitId:unit.id,number:unit.number,payerId:effective.get(p.id)!.payerId,payerDelegationId:effective.get(p.id)!.delegationId,payerAssignmentId:p.id,quantityHundredths:quantity.toString(),amountMinor:amount.toString(),ruleStartsOn:p.starts_on,ruleEndsOn:p.ends_on});total+=amount;
 }
 const snapshot={...b,buildingName:building.name,tariff:{id:tariff.id,serviceId:tariff.service_id,name:tariff.name,basis:tariff.basis,rateMinor:String(tariff.amount_minor),currency:tariff.currency},unitCount:units.length,chargeCount:charges.length,totalMinor:total.toString(),charges,skipped,warnings:skipped};
 return {snapshot,fingerprint:hash(snapshot)};
}
async function batch(db:PoolClient,c:Context,id:string){
 const row=(await db.query('SELECT * FROM billing_batches WHERE id=$1 AND organization_id=$2 FOR UPDATE',[id,c.organization_id])).rows[0];
 if(!row||c.building_id&&c.building_id!==row.building_id||c.unit_id)throw new ApiError(404,'not_found');return row;
}
const quantityHundredths=(value:string)=>{const [whole,fraction='']=value.split('.');const n=BigInt(whole)*10000n+BigInt(fraction.padEnd(4,'0').slice(0,4));const q=(n+50n)/100n;return (q>0n?q:1n).toString()};
billingBatches.post('/finance/batches/preview',async(req,res)=>{const c=await requirePermission(req,'billing.calculate'),b=input.parse(req.body);res.json((await transaction(db=>calculate(db,c,b))).snapshot)});
billingBatches.post('/finance/rule-batches',async(req,res)=>{
 const c=await requirePermission(req,'billing.calculate'),b=z.object({buildingId:uuid,period:day.refine(s=>s.endsWith('-01')),key:uuid}).strict().parse(req.body);
 res.status(201).json(await transaction(db=>idempotent(db,req,b.key,b,async()=>{
  const result=await calculateRuleBilling(db,c,b.buildingId,b.period);
  if(!result.snapshot.chargeCount)throw new ApiError(409,'no_charges');
  const primaryTariffId=result.snapshot.charges[0].tariffId;
  const row=(await db.query(`INSERT INTO billing_batches(organization_id,building_id,tariff_id,period,snapshot,fingerprint,created_by,snapshot_kind)
   VALUES($1,$2,$3,$4,$5,$6,$7,'rule_engine') RETURNING *`,
  [c.organization_id,b.buildingId,primaryTariffId,b.period,JSON.stringify(result.snapshot),result.fingerprint,req.user!.id])).rows[0];
  await record(db,req,c,'billing_batch.rule_draft','billing_batch',row.id,{chargeCount:result.snapshot.chargeCount,totalMinor:result.snapshot.totalMinor});
  return row;
 })));
});
billingBatches.get('/finance/batches',async(req,res)=>{const c=await requirePermission(req,'billing.read');res.json((await pool.query('SELECT * FROM billing_batches WHERE organization_id=$1 AND ($2::uuid IS NULL OR building_id=$2) AND $3::uuid IS NULL ORDER BY created_at DESC LIMIT 100',[c.organization_id,c.building_id,c.unit_id])).rows)});
billingBatches.post('/finance/batches',async(req,res)=>{
 const c=await requirePermission(req,'billing.calculate'),b=input.extend({key:uuid}).parse(req.body);
 res.status(201).json(await transaction(db=>idempotent(db,req,b.key,b,async()=>{
  const calc=await calculate(db,c,{buildingId:b.buildingId,period:b.period,tariffId:b.tariffId});
  if(!calc.snapshot.chargeCount)throw new ApiError(409,'no_charges');
  const row=(await db.query('INSERT INTO billing_batches(organization_id,building_id,tariff_id,period,snapshot,fingerprint,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[c.organization_id,b.buildingId,b.tariffId,b.period,JSON.stringify(calc.snapshot),calc.fingerprint,req.user!.id])).rows[0];
  await record(db,req,c,'billing_batch.draft','billing_batch',row.id);return row;
 })));
});
billingBatches.post('/finance/batches/:id/:action',async(req,res)=>{
 const action=z.enum(['publish','cancel']).parse(req.params.action),c=await requirePermission(req,action==='publish'?'billing.publish':'billing.calculate'),id=uuid.parse(req.params.id);
 const b=z.object({key:uuid,version,acceptWarnings:z.boolean().default(false)}).strict().parse(req.body);
 res.json(await transaction(async db=>{
  const row=await batch(db,c,id);
  return idempotent(db,req,b.key,b,async()=>{
   if(row.version!==b.version)throw new ApiError(409,'stale_version');
   if(row.status!=='draft')throw new ApiError(409,'batch_not_draft');
   if(action==='publish'){
     const fresh=row.snapshot_kind==='rule_engine'
      ?await calculateRuleBilling(db,c,row.building_id,String(row.snapshot.period),true)
      :await calculate(db,c,{buildingId:row.building_id,period:String(row.snapshot.period),tariffId:row.tariff_id},true);
    if(fresh.fingerprint!==row.fingerprint)throw new ApiError(409,'batch_preview_changed');
    if(fresh.snapshot.warnings.length&&!b.acceptWarnings)throw new ApiError(409,'batch_warnings_unacknowledged');
    for(const line of fresh.snapshot.charges){
      const ruleBased=row.snapshot_kind==='rule_engine';
      const legacyTariff=(fresh.snapshot as any).tariff;
      const tariff=ruleBased?{name:line.serviceName,rateMinor:line.rateMinor,currency:line.currency}:{...legacyTariff,name:legacyTariff.name,rateMinor:legacyTariff.rateMinor,currency:legacyTariff.currency};
      const amountMinor=ruleBased?line.roundedAmountMinor:line.amountMinor;
      const quantity=ruleBased?quantityHundredths(line.baseQuantity):line.quantityHundredths;
      const invoice=(await db.query("INSERT INTO invoices(organization_id,unit_id,payer_user_id,period,amount_minor,currency,status,created_by) VALUES($1,$2,$3,$4,$5,$6,'draft',$7) RETURNING id",[c.organization_id,line.unitId,line.payerId,row.snapshot.period,amountMinor,tariff.currency,req.user!.id])).rows[0];
      await db.query(`INSERT INTO invoice_lines(invoice_id,description,quantity_hundredths,rate_minor,amount_minor,calculation_metadata)
       VALUES($1,$2,$3,$4,$5,$6)`,[invoice.id,tariff.name,quantity,tariff.rateMinor,amountMinor,JSON.stringify(ruleBased?{
        model:'rule_engine',method:line.calculationMethod,ruleId:line.ruleId,tariffId:line.tariffId,serviceId:line.serviceId,
        baseQuantity:line.baseQuantity,unproratedQuantity:line.unproratedQuantity,prorationDays:line.prorationDays,
        baseUnit:line.baseUnit,rateMinor:line.rateMinor,rateUnit:line.rateUnit,
        rawAmountMinor:line.rawAmountMinor,roundedAmountMinor:line.roundedAmountMinor,roundingMode:line.roundingMode,
        serviceName:line.serviceName
       }:{model:'legacy'})]);
       await db.query('INSERT INTO charges(organization_id,payer_assignment_id,period,tariff_id,invoice_id,payer_delegation_id) VALUES($1,$2,$3,$4,$5,$6)',[c.organization_id,line.payerAssignmentId,row.snapshot.period,ruleBased?line.tariffId:row.tariff_id,invoice.id,line.payerDelegationId]);
     await db.query("UPDATE invoices SET status='published',published_at=now(),published_by=$2 WHERE id=$1",[invoice.id,req.user!.id]);
     await db.query('INSERT INTO billing_batch_invoices(batch_id,organization_id,invoice_id) VALUES($1,$2,$3)',[row.id,c.organization_id,invoice.id]);
    }
   }
   const result=(await db.query('UPDATE billing_batches SET status=$2,version=version+1,published_by=CASE WHEN $2=\'published\' THEN $3::uuid ELSE NULL END,published_at=CASE WHEN $2=\'published\' THEN now() ELSE NULL END WHERE id=$1 RETURNING *',[row.id,action==='publish'?'published':'cancelled',req.user!.id])).rows[0];
   await record(db,req,c,'billing_batch.'+action,'billing_batch',row.id,{count:row.snapshot.chargeCount,totalMinor:row.snapshot.totalMinor});return result;
  });
 }));
});
