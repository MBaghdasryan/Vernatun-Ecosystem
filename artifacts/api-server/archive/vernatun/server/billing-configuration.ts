import {Router,type Request} from 'express';
import {z} from 'zod';
import type {PoolClient} from 'pg';
import {pool} from './db.js';
import {ApiError,context,requireAuth,requirePermission,scopedUnit,type Context} from './access.js';
import {transaction,record,idempotent} from './operations.js';
import {resolvePayers} from './payer-responsibility-store.js';
import {ownScope} from './resident-continuity-store.js';
import {day,uuid,amountLimit} from './finance-shared.js';

export const billingConfiguration=Router();
billingConfiguration.use(async(_req,res,next)=>{
 try{
  const schema=await pool.query(`SELECT to_regclass('billing_rules') AS rules,to_regclass('unit_billing_parameters') AS unit_parameters,
   to_regclass('billing_manual_charges') AS manual_charges`);
  if(!schema.rows[0]?.rules||!schema.rows[0]?.unit_parameters||!schema.rows[0]?.manual_charges)
   return res.status(503).json({error:'billing_configuration_migration_required'});
  return next();
 }catch(error){return next(error)}
});
billingConfiguration.use(requireAuth);

const method=z.enum(['FIXED_PER_UNIT','PER_SQUARE_METER','PER_RESIDENT','PER_PARKING_SPACE','PER_METER_CONSUMPTION','PER_QUANTITY','PER_DAY','MANUAL']);
const currency=z.enum(['AMD','RUB','USD']);
const positiveMinor=z.string().regex(/^[1-9]\d{0,13}$/);
const periodDay=day.refine(v=>v.endsWith('-01'));
const readFinance=async(req:Request)=>{const c=await context(req);await requirePermission(req,c.permissions.includes('billing.read')?'billing.read':'billing.calculate');if(!c.organization_id)throw new ApiError(403,'forbidden');return c};
const manageFinance=async(req:Request)=>{const c=await requirePermission(req,'billing.calculate');if(!c.organization_id||c.unit_id)throw new ApiError(403,'forbidden');return c};
export async function createVersionedTariff(req:Request,c:Context){
 if(!c.organization_id||c.unit_id)throw new ApiError(403,'forbidden');
 const b=z.object({serviceId:uuid,name:z.string().trim().min(2).max(160),amountMinor:positiveMinor,currency,
  calculationMethod:method,rateUnit:z.string().trim().min(1).max(24),validFrom:day,validUntil:day.optional()}).strict().parse(req.body);
 if(b.validUntil&&b.validUntil<b.validFrom)throw new ApiError(400,'invalid_date_range');
 if(BigInt(b.amountMinor)>amountLimit)throw new ApiError(400,'invalid_amount');
 return transaction(async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[c.organization_id+b.serviceId]);
  const service=(await db.query('SELECT id FROM services WHERE id=$1 AND organization_id=$2 FOR UPDATE',[b.serviceId,c.organization_id])).rows[0];
  if(!service)throw new ApiError(404,'not_found');
  const previous=(await db.query(`SELECT id,valid_from::text,valid_until::text FROM tariffs
   WHERE organization_id=$1 AND service_id=$2 AND status='active' ORDER BY valid_from FOR UPDATE`,[c.organization_id,b.serviceId])).rows;
  const closeIds:string[]=[];
  for(const old of previous){
   if(overlaps(b.validFrom,b.validUntil??null,old.valid_from,old.valid_until)){
    if(old.valid_from<b.validFrom&&(!old.valid_until||old.valid_until>=b.validFrom)&&!old.valid_until)closeIds.push(old.id);
    else throw new ApiError(409,'tariff_version_conflict');
   }
  }
  const basis=b.calculationMethod==='PER_SQUARE_METER'?'area':'unit';
  const row=(await db.query(`INSERT INTO tariffs(organization_id,service_id,amount_minor,currency,basis,name,calculation_method,rate_unit,valid_from,valid_until,status,created_by)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active',$11) RETURNING *`,
  [c.organization_id,b.serviceId,b.amountMinor,b.currency,basis,b.name,b.calculationMethod,b.rateUnit,b.validFrom,b.validUntil??null,req.user!.id])).rows[0];
  for(const id of closeIds)await db.query(`UPDATE tariffs SET valid_until=$2::date-1,status='superseded',replaced_by=$3 WHERE id=$1`,[id,b.validFrom,row.id]);
  await record(db,req,c,closeIds.length?'finance.tariff.replaced':'finance.tariff.created','tariff',row.id,{previousTariffIds:closeIds});return row;
 });
}
function inScope(c:Context,buildingId:string,unitId?:string|null){
 if(c.building_id&&c.building_id!==buildingId||c.unit_id&&c.unit_id!==unitId)throw new ApiError(404,'not_found');
}
function scaled(value:string|number,places=4):bigint{
 const s=String(value);if(!/^\d+(?:\.\d{1,4})?$/.test(s))throw new ApiError(400,'invalid_quantity');
 const [whole,fraction='']=s.split('.');return BigInt(whole)*10n**BigInt(places)+BigInt(fraction.padEnd(places,'0'));
}
function rounded(raw:bigint,mode:string):bigint{
 const unit=100n;if(mode==='ROUND_UP_AMD')return ((raw+unit-1n)/unit)*unit;
 if(mode==='ROUND_DOWN_AMD')return (raw/unit)*unit;
 return ((raw+unit/2n)/unit)*unit;
}
function amountFor(rate:string,quantity:string,mode:string,min?:string|null,max?:string|null){
 const raw=(BigInt(rate)*scaled(quantity)+5000n)/10000n;
 let final=rounded(raw,mode);if(min!==null&&min!==undefined&&final<BigInt(min))final=BigInt(min);
 if(max!==null&&max!==undefined&&final>BigInt(max))final=BigInt(max);
 if(final>amountLimit)throw new ApiError(400,'invalid_amount');
 return {raw:raw.toString(),rounded:final.toString()};
}
const endOfMonth=(period:string)=>{const [y,m]=period.slice(0,7).split('-').map(Number);return new Date(Date.UTC(y,m,0)).toISOString().slice(0,10)};
const daysInMonth=(period:string)=>{const [y,m]=period.slice(0,7).split('-').map(Number);return new Date(Date.UTC(y,m,0)).getUTCDate()};
const overlaps=(aFrom:string,aUntil:string|null,bFrom:string,bUntil:string|null)=>aFrom<=(bUntil??'9999-12-31')&&bFrom<=(aUntil??'9999-12-31');
async function buildingFor(c:Context,id:string,db:PoolClient|typeof pool=pool){
 const b=(await db.query('SELECT id,name FROM buildings WHERE id=$1 AND organization_id=$2',[id,c.organization_id])).rows[0];
 if(!b||c.building_id&&c.building_id!==id||c.unit_id)throw new ApiError(404,'not_found');return b;
}

export async function calculateRuleBilling(db:PoolClient,c:Context,buildingId:string,period:string,lock=false){
 const building=await buildingFor(c,buildingId,db),periodEnd=endOfMonth(period);
 const units=(await db.query(`SELECT id,number,area::text FROM units WHERE organization_id=$1 AND building_id=$2 ORDER BY id LIMIT 1001${lock?' FOR SHARE':''}`,[c.organization_id,buildingId])).rows;
 if(units.length>1000)throw new ApiError(400,'batch_too_large');
 const rules=(await db.query(`SELECT r.*,r.valid_from::text AS rule_valid_from,r.valid_until::text AS rule_valid_until,
   s.name AS service_name,s.active AS service_active,s.billing_enabled,s.mandatory AS service_mandatory,
   t.name AS tariff_name,t.amount_minor::text,t.currency,t.rate_unit,t.status AS tariff_status,
   t.valid_from::text AS tariff_valid_from,t.valid_until::text AS tariff_valid_until
   FROM billing_rules r JOIN services s ON s.id=r.service_id AND s.organization_id=r.organization_id
   JOIN tariffs t ON t.id=r.tariff_id AND t.service_id=r.service_id AND t.organization_id=r.organization_id
   WHERE r.organization_id=$1 AND r.active AND r.valid_from<=$3::date AND (r.valid_until IS NULL OR r.valid_until>=$2::date)
   AND (r.scope_kind='organization' OR r.building_id=$4)
   ORDER BY r.service_id,r.priority DESC,r.id`,
  [c.organization_id,period,periodEnd,buildingId])).rows;
 const params=(await db.query(`SELECT DISTINCT ON(unit_id) unit_id,billing_area::text,resident_count_mode,billing_resident_count,occupancy_status,
   effective_from::text AS effective_from,effective_until::text AS effective_until
   FROM unit_billing_parameters WHERE organization_id=$1 AND unit_id=ANY($2::uuid[])
   AND effective_from<=$3::date AND (effective_until IS NULL OR effective_until>=$4::date)
   ORDER BY unit_id,effective_from DESC,id DESC`,[c.organization_id,units.map(u=>u.id),periodEnd,period])).rows;
 const paramsByUnit=new Map(params.map(p=>[p.unit_id,p]));
 const eligibility=(await db.query(`SELECT e.*,a.user_id,a.role_key,a.starts_at,a.expires_at,m.active AS membership_active,u.blocked
   FROM unit_billing_resident_eligibility e JOIN role_assignments a ON a.id=e.role_assignment_id
   JOIN memberships m ON m.user_id=a.user_id AND m.organization_id=a.organization_id
   JOIN users u ON u.id=a.user_id
   WHERE e.organization_id=$1 AND e.unit_id=ANY($2::uuid[]) AND e.effective_from<=$3::date
   AND (e.effective_until IS NULL OR e.effective_until>=$4::date)
   AND a.organization_id=e.organization_id AND a.unit_id=e.unit_id AND a.role_key IN('unit_owner','renter','family')
   AND a.active AND m.active AND NOT u.blocked AND a.starts_at<=$5::timestamptz
   AND (a.expires_at IS NULL OR a.expires_at>$5::timestamptz)`,
  [c.organization_id,units.map(u=>u.id),periodEnd,period,new Date(period+'T00:00:00Z')])).rows;
 const eligibleByUnit=new Map<string,typeof eligibility>();
 for(const e of eligibility){const list=eligibleByUnit.get(e.unit_id)??[];list.push(e);eligibleByUnit.set(e.unit_id,list)}
 const serviceIds=[...new Set(rules.map(r=>r.service_id))];
 if(lock)for(const unit of units)for(const serviceId of serviceIds)await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[unit.id+serviceId]);
 const payers=serviceIds.length?(await db.query(`SELECT p.*,p.starts_on::text,p.ends_on::text FROM payer_assignments p
   JOIN units u ON u.id=p.unit_id AND u.organization_id=p.organization_id
   WHERE p.organization_id=$1 AND u.building_id=$2 AND p.service_id=ANY($3::uuid[])
   AND p.starts_on<=$4::date AND (p.ends_on IS NULL OR p.ends_on>=$4::date) ORDER BY p.unit_id,p.service_id,p.id${lock?' FOR UPDATE OF p':''}`,
  [c.organization_id,buildingId,serviceIds,period])).rows:[];
 const effective=new Map((await resolvePayers(db,payers.map(p=>p.id),period,lock)).map(p=>[p.id,p]));
 const assignmentsByKey=new Map<string,typeof payers>();
 for(const p of payers){const key=p.unit_id+':'+p.service_id;const list=assignmentsByKey.get(key)??[];list.push(p);assignmentsByKey.set(key,list)}
 const prior=payers.length?(await db.query('SELECT payer_assignment_id FROM charges WHERE period=$1 AND payer_assignment_id=ANY($2::uuid[])',[period,payers.map(p=>p.id)])).rows:[];
 const priorIds=new Set(prior.map(p=>p.payer_assignment_id));
 const quantities=serviceIds.length?(await db.query(`SELECT DISTINCT ON(unit_id,service_id) unit_id,service_id,quantity::text FROM unit_billing_service_quantities
   WHERE organization_id=$1 AND unit_id=ANY($2::uuid[]) AND service_id=ANY($3::uuid[])
   AND effective_from<=$4::date AND (effective_until IS NULL OR effective_until>=$5::date)
   ORDER BY unit_id,service_id,effective_from DESC,id DESC`,[c.organization_id,units.map(u=>u.id),serviceIds,periodEnd,period])).rows:[];
 const quantityByKey=new Map(quantities.map(q=>[q.unit_id+':'+q.service_id,q.quantity]));
 const applicability=serviceIds.length?(await db.query(`SELECT DISTINCT ON(unit_id,service_id) unit_id,service_id,enabled
  FROM unit_billing_service_applicability WHERE organization_id=$1 AND unit_id=ANY($2::uuid[]) AND service_id=ANY($3::uuid[])
  AND effective_from<=$4::date AND (effective_until IS NULL OR effective_until>=$5::date)
  ORDER BY unit_id,service_id,effective_from DESC,id DESC`,[c.organization_id,units.map(u=>u.id),serviceIds,periodEnd,period])).rows:[];
 const applicabilityByKey=new Map(applicability.map(q=>[q.unit_id+':'+q.service_id,q.enabled]));
  const manualCharges=serviceIds.length?(await db.query(`SELECT DISTINCT ON(unit_id,service_id) *
   FROM billing_manual_charges WHERE organization_id=$1 AND unit_id=ANY($2::uuid[]) AND service_id=ANY($3::uuid[])
   AND period=$4::date AND status='active' ORDER BY unit_id,service_id,revision DESC,id DESC`,
   [c.organization_id,units.map(u=>u.id),serviceIds,period])).rows:[];
  const manualByKey=new Map(manualCharges.map(q=>[q.unit_id+':'+q.service_id,q]));
 const lines:any[]=[],exceptions:any[]=[];
 for(const unit of units){
  const services=[...new Set(rules.map(r=>r.service_id))];
  for(const serviceId of services){
   const candidates=rules.filter(r=>r.service_id===serviceId&&(
    r.scope_kind==='organization'||r.scope_kind==='building'&&r.building_id===buildingId||r.scope_kind==='unit'&&r.unit_id===unit.id));
   if(!candidates.length)continue;
   const specificity=(r:any)=>r.scope_kind==='unit'?3:r.scope_kind==='building'?2:1;
   candidates.sort((a,b)=>specificity(b)-specificity(a)||b.priority-a.priority);
   const first=candidates[0],ties=candidates.filter(r=>specificity(r)===specificity(first)&&r.priority===first.priority);
   const fail=(code:string)=>exceptions.push({unitId:unit.id,unitNumber:unit.number,serviceId:String(first.service_id),serviceName:first.service_name,code});
   if(ties.length>1){fail('rule_conflict');continue}
   if(!first.service_active||!first.billing_enabled){fail('service_disabled');continue}
   if(applicabilityByKey.get(unit.id+':'+serviceId)===false){
    if(first.service_mandatory){fail('mandatory_service_cannot_be_disabled');continue}
    continue;
   }
   const activeFrom=[period,first.rule_valid_from,first.tariff_valid_from].sort().at(-1)!;
   const activeUntil=[periodEnd,first.rule_valid_until??periodEnd,first.tariff_valid_until??periodEnd].sort()[0];
   const activeDays=Math.max(0,Math.floor((Date.parse(activeUntil+'T00:00:00Z')-Date.parse(activeFrom+'T00:00:00Z'))/86400000)+1);
   if(activeDays===0){fail('rule_not_effective');continue}
   if(activeDays<daysInMonth(period)&&first.proration_mode==='DISABLED'&&first.calculation_method!=='PER_DAY'){
    fail('mid_period_rule_requires_proration');continue;
   }
   if(!['active','superseded'].includes(first.tariff_status)||first.tariff_valid_from>periodEnd||first.tariff_valid_until&&first.tariff_valid_until<period){fail('tariff_unavailable');continue}
   const assignments=assignmentsByKey.get(unit.id+':'+serviceId)??[];
   if(assignments.length!==1){fail(assignments.length?'payer_overlap':'no_payer_rule');continue}
   const assignment=assignments[0];
   if(priorIds.has(assignment.id)){fail('already_calculated');continue}
    let quantity='1',baseUnit='unit',manualCharge:any=null;
   if(first.calculation_method==='PER_SQUARE_METER'){
    const p=paramsByUnit.get(unit.id);
    if(p&&(p.effective_from>period||p.effective_until&&p.effective_until<periodEnd)){fail('mid_period_unit_parameter_change_requires_review');continue}
    const area=p?.billing_area??unit.area;if(!area||Number(area)<=0){fail('missing_billing_area');continue}
    quantity=String(area);baseUnit='m²';
   }else if(first.calculation_method==='PER_RESIDENT'){
    const p=paramsByUnit.get(unit.id);
    if(!p){fail('resident_count_unknown');continue}
    if(p.effective_from>period||p.effective_until&&p.effective_until<periodEnd){fail('mid_period_unit_parameter_change_requires_review');continue}
    if(p.resident_count_mode!==first.occupancy_count_mode){fail('resident_count_mode_mismatch');continue}
    let count:number|undefined;
    if(first.occupancy_count_mode==='AUTO_ACTIVE_RESIDENTS'){
     const records=eligibleByUnit.get(unit.id)??[];
      if(records.some(e=>e.resides_here&&e.counts_for_billing&&(e.effective_from>period||e.effective_until&&e.effective_until<periodEnd))){fail('resident_eligibility_changed_mid_period');continue}
     if(!records.length&&p.occupancy_status!=='VACANT'){fail('resident_count_unknown');continue}
     count=records.filter(e=>e.resides_here&&e.counts_for_billing&&e.effective_from<=periodEnd&&(!e.effective_until||e.effective_until>=period)).length;
    }else count=p.billing_resident_count===null?undefined:Number(p.billing_resident_count);
    if(count===undefined){fail('resident_count_unknown');continue}
    if(count===0&&p.occupancy_status!=='VACANT'&&first.zero_policy==='MANUAL_REVIEW'){fail('zero_resident_review');continue}
    if(count===0&&first.zero_policy==='MINIMUM_ONE')count=1;
    quantity=String(count);baseUnit='resident';
   }else if(first.calculation_method==='PER_PARKING_SPACE'||first.calculation_method==='PER_QUANTITY'){
    const q=quantityByKey.get(unit.id+':'+serviceId);if(q===undefined){fail(first.calculation_method==='PER_PARKING_SPACE'?'missing_parking_count':'missing_service_quantity');continue}
    quantity=String(q);baseUnit=first.calculation_method==='PER_PARKING_SPACE'?'parking_space':'quantity';
   }else if(first.calculation_method==='PER_METER_CONSUMPTION'){
    if(!first.meter_kind){fail('meter_kind_required');continue}
    const readings=(await db.query(`SELECT m.id,
      (SELECT value_thousandths FROM meter_readings x WHERE x.meter_id=m.id AND x.period<=$3::date ORDER BY x.period DESC LIMIT 1) AS current_value,
      (SELECT value_thousandths FROM meter_readings x WHERE x.meter_id=m.id AND x.period<$3::date ORDER BY x.period DESC LIMIT 1) AS previous_value
      FROM meters m WHERE m.organization_id=$1 AND m.unit_id=$2 AND m.kind=$4 ORDER BY m.id`,
      [c.organization_id,unit.id,period,first.meter_kind])).rows;
    if(!readings.length||readings.some(x=>x.current_value===null||x.previous_value===null)){fail('missing_meter_reading');continue}
    const consumption=readings.reduce((sum,x)=>sum+BigInt(x.current_value)-BigInt(x.previous_value),0n);
    if(consumption<0n){fail('invalid_meter_reading');continue}
    quantity=(consumption/1000n).toString()+'.'+(consumption%1000n).toString().padStart(3,'0');baseUnit=first.meter_kind==='water'?'m³':first.meter_kind==='electricity'?'kWh':'m³';
   }else if(first.calculation_method==='PER_DAY'){
    quantity=String(activeDays);baseUnit='day';
   }else if(first.calculation_method==='MANUAL'){
     manualCharge=manualByKey.get(unit.id+':'+serviceId);
     if(!manualCharge){fail('manual_charge_required');continue}
     if(activeDays<daysInMonth(period)){fail('mid_period_manual_charge_requires_review');continue}
     quantity='1';baseUnit='manual';
   }
   const unproratedQuantity=quantity;
    if(!manualCharge&&first.proration_mode==='DAILY'&&first.calculation_method!=='PER_DAY'&&activeDays<daysInMonth(period)){
    const value=(scaled(quantity)*BigInt(activeDays)+BigInt(daysInMonth(period)/2))/BigInt(daysInMonth(period));
    quantity=(value/10000n).toString()+'.'+(value%10000n).toString().padStart(4,'0');
   }
    const rateMinor=manualCharge?String(manualCharge.amount_minor):String(first.amount_minor);
    const amounts=manualCharge?{raw:rateMinor,rounded:rateMinor}:amountFor(rateMinor,quantity,first.rounding_mode,first.minimum_amount===null?null:String(first.minimum_amount),first.maximum_amount===null?null:String(first.maximum_amount));
   if(BigInt(amounts.rounded)===0n){fail('zero_charge');continue}
   lines.push({unitId:unit.id,unitNumber:unit.number,serviceId:String(first.service_id),serviceName:first.service_name,tariffId:first.tariff_id,
    ruleId:first.id,calculationMethod:first.calculation_method,baseQuantity:quantity,unproratedQuantity,prorationDays:activeDays,baseUnit,
    rateMinor,rateUnit:first.rate_unit,currency:first.currency,
    rawAmountMinor:amounts.raw,roundedAmountMinor:amounts.rounded,
    manualChargeId:manualCharge?.id??null,manualReason:manualCharge?.reason??null,
    payerAssignmentId:assignment.id,payerId:effective.get(assignment.id)?.payerId??assignment.payer_user_id,
    payerDelegationId:effective.get(assignment.id)?.delegationId??null,
    roundingMode:first.rounding_mode});
  }
 }
 const totalMinor=lines.reduce((sum,line)=>sum+BigInt(line.roundedAmountMinor),0n).toString();
 const currencies=[...new Set(lines.map(line=>line.currency))];
 if(currencies.length>1)throw new ApiError(409,'mixed_currency_billing_rules');
 const snapshot={mode:'rule_engine',buildingId,buildingName:building.name,period,unitCount:units.length,
  currency:currencies[0]??'AMD',chargeCount:lines.length,totalMinor,charges:lines,exceptions,warnings:exceptions};
 return {snapshot,fingerprint:(await import('node:crypto')).createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')};
}

billingConfiguration.get('/finance/configuration',async(req,res)=>{
 const c=await readFinance(req);
 const [services,tariffs,rules,buildings]=await Promise.all([
  pool.query('SELECT * FROM services WHERE organization_id=$1 ORDER BY active DESC,name,id',[c.organization_id]),
  pool.query(`SELECT t.*,t.amount_minor::text,s.name AS service_name FROM tariffs t JOIN services s ON s.id=t.service_id
   WHERE t.organization_id=$1 ORDER BY t.valid_from DESC,t.created_at DESC`,[c.organization_id]),
  pool.query(`SELECT r.*,r.minimum_amount::text,r.maximum_amount::text,s.name AS service_name,t.name AS tariff_name,
   b.name AS building_name,u.number AS unit_number FROM billing_rules r JOIN services s ON s.id=r.service_id
   JOIN tariffs t ON t.id=r.tariff_id LEFT JOIN buildings b ON b.id=r.building_id LEFT JOIN units u ON u.id=r.unit_id
   WHERE r.organization_id=$1 AND ($2::uuid IS NULL OR r.building_id=$2) AND ($3::uuid IS NULL OR r.unit_id=$3)
   ORDER BY r.created_at DESC`,[c.organization_id,c.building_id,c.unit_id]),
  pool.query('SELECT id,name FROM buildings WHERE organization_id=$1 AND ($2::uuid IS NULL OR id=$2) ORDER BY name',[c.organization_id,c.building_id])
 ]);
 res.json({services:services.rows,tariffs:tariffs.rows,rules:rules.rows,buildings:buildings.rows});
});
billingConfiguration.get('/finance/buildings/:buildingId/units',async(req,res)=>{
 const c=await requirePermission(req,'billing.calculate'),buildingId=uuid.parse(req.params.buildingId);
 await buildingFor(c,buildingId);
 res.json((await pool.query(`SELECT id,number,area::text AS legal_area FROM units
  WHERE organization_id=$1 AND building_id=$2 ORDER BY number,id LIMIT 2000`,[c.organization_id,buildingId])).rows);
});

billingConfiguration.post('/finance/services',async(req,res)=>{
 const c=await manageFinance(req),b=z.object({
  name:z.string().trim().min(2).max(160),description:z.string().trim().max(2000).default(''),
  category:z.enum(['maintenance','security','cleaning','waste','parking','intercom','utilities','optional','other']).default('other'),
  mandatory:z.boolean().default(true),defaultCalculationMethod:method.default('FIXED_PER_UNIT')
 }).strict().parse(req.body);
 res.status(201).json(await transaction(async db=>{
  const row=(await db.query(`INSERT INTO services(organization_id,name,description,category,mandatory,default_calculation_method)
   VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[c.organization_id,b.name,b.description,b.category,b.mandatory,b.defaultCalculationMethod])).rows[0];
  await record(db,req,c,'finance.service.created','service',row.id);return row;
 }));
});

billingConfiguration.post('/finance/configuration/tariffs',async(req,res)=>{
 const c=await manageFinance(req),b=z.object({
  serviceId:uuid,name:z.string().trim().min(2).max(160),amountMinor:positiveMinor,currency,
  calculationMethod:method,rateUnit:z.string().trim().min(1).max(24),validFrom:day,validUntil:day.optional()
 }).strict().parse(req.body);
 if(b.validUntil&&b.validUntil<b.validFrom)throw new ApiError(400,'invalid_date_range');
 const rate=BigInt(b.amountMinor);if(rate>amountLimit)throw new ApiError(400,'invalid_amount');
 res.status(201).json(await transaction(async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[c.organization_id+b.serviceId]);
  const service=(await db.query('SELECT id FROM services WHERE id=$1 AND organization_id=$2 FOR UPDATE',[b.serviceId,c.organization_id])).rows[0];
  if(!service)throw new ApiError(404,'not_found');
  const previous=(await db.query(`SELECT id,valid_from::text,valid_until::text FROM tariffs
   WHERE organization_id=$1 AND service_id=$2 AND status='active' ORDER BY valid_from FOR UPDATE`,[c.organization_id,b.serviceId])).rows;
  const closeIds:string[]=[];
  for(const old of previous){
   if(overlaps(b.validFrom,b.validUntil??null,old.valid_from,old.valid_until)){
    if(old.valid_from<b.validFrom&&(!old.valid_until||old.valid_until>=b.validFrom)&&!old.valid_until)closeIds.push(old.id);
    else throw new ApiError(409,'tariff_version_conflict');
   }
  }
  const basis=b.calculationMethod==='PER_SQUARE_METER'?'area':'unit';
  const row=(await db.query(`INSERT INTO tariffs(organization_id,service_id,amount_minor,currency,basis,name,calculation_method,rate_unit,valid_from,valid_until,status,created_by)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active',$11) RETURNING *`,
  [c.organization_id,b.serviceId,b.amountMinor,b.currency,basis,b.name,b.calculationMethod,b.rateUnit,b.validFrom,b.validUntil??null,req.user!.id])).rows[0];
  for(const id of closeIds)await db.query(`UPDATE tariffs SET valid_until=$2::date-1,status='superseded',replaced_by=$3 WHERE id=$1`,[id,b.validFrom,row.id]);
  await record(db,req,c,closeIds.length?'finance.tariff.replaced':'finance.tariff.created','tariff',row.id,{previousTariffIds:closeIds});return row;
 }));
});

const ruleInput=z.object({
 serviceId:uuid,tariffId:uuid,scopeKind:z.enum(['organization','building','unit']),buildingId:uuid.optional(),unitId:uuid.optional(),
 calculationMethod:method,occupancyCountMode:z.enum(['AUTO_ACTIVE_RESIDENTS','REGISTRY_COUNT','MANUAL_COUNT']).optional(),
 zeroPolicy:z.enum(['ALLOW_ZERO','MINIMUM_ONE','MANUAL_REVIEW']).default('MANUAL_REVIEW'),
 roundingMode:z.enum(['NEAREST_AMD','ROUND_UP_AMD','ROUND_DOWN_AMD']).default('NEAREST_AMD'),
 prorationMode:z.enum(['DISABLED','DAILY']).default('DISABLED'),
 minimumAmount:z.string().regex(/^\d{1,14}$/).optional(),maximumAmount:z.string().regex(/^\d{1,14}$/).optional(),
 validFrom:day,validUntil:day.optional(),priority:z.number().int().min(-1000).max(1000).default(0),
 meterKind:z.enum(['water','electricity','gas']).optional(),active:z.boolean().default(false)
}).strict();
async function checkRuleConflict(db:PoolClient,c:Context,b:z.infer<typeof ruleInput>,excludeId?:string){
 const buildingId=b.buildingId??null,unitId=b.unitId??null;
 if(b.scopeKind==='organization'&&(buildingId||unitId)||b.scopeKind==='building'&&(!buildingId||unitId)||b.scopeKind==='unit'&&(!buildingId||!unitId))throw new ApiError(400,'invalid_scope');
 if(c.building_id&&b.scopeKind==='organization')throw new ApiError(403,'organization_scope_required');
 if(buildingId){const building=(await db.query('SELECT id FROM buildings WHERE id=$1 AND organization_id=$2',[buildingId,c.organization_id])).rows[0];if(!building||c.building_id&&c.building_id!==buildingId)throw new ApiError(404,'not_found')}
 if(unitId){const unit=(await db.query('SELECT id FROM units WHERE id=$1 AND organization_id=$2 AND building_id=$3',[unitId,c.organization_id,buildingId])).rows[0];if(!unit||c.unit_id)throw new ApiError(404,'not_found')}
 if(b.validUntil&&b.validUntil<b.validFrom||b.maximumAmount&&b.minimumAmount&&BigInt(b.maximumAmount)<BigInt(b.minimumAmount))throw new ApiError(400,'validation_error');
 const tariff=(await db.query('SELECT id,service_id,status,valid_from::text,valid_until::text FROM tariffs WHERE id=$1 AND service_id=$2 AND organization_id=$3',[b.tariffId,b.serviceId,c.organization_id])).rows[0];
 if(!tariff)throw new ApiError(404,'not_found');
 if(tariff.status==='draft'||tariff.valid_from>b.validFrom||tariff.valid_until&&tariff.valid_until<(b.validUntil??'9999-12-31'))throw new ApiError(400,'tariff_rule_period_mismatch');
 if(b.calculationMethod==='PER_RESIDENT'&&!b.occupancyCountMode||b.calculationMethod!=='PER_RESIDENT'&&b.occupancyCountMode)throw new ApiError(400,'validation_error');
 if(b.calculationMethod==='PER_METER_CONSUMPTION'&&!b.meterKind)throw new ApiError(400,'meter_kind_required');
 if(b.active){
  const q=await db.query(`SELECT id,valid_from::text,valid_until::text FROM billing_rules WHERE organization_id=$1 AND service_id=$2
   AND active AND scope_kind=$3 AND building_id IS NOT DISTINCT FROM $4::uuid AND unit_id IS NOT DISTINCT FROM $5::uuid
   AND ($6::uuid IS NULL OR id<>$6)`,[c.organization_id,b.serviceId,b.scopeKind,buildingId,unitId,excludeId??null]);
  if(q.rows.some(r=>overlaps(b.validFrom,b.validUntil??null,r.valid_from,r.valid_until)))throw new ApiError(409,'billing_rule_conflict');
 }
}
billingConfiguration.post('/finance/billing-rules',async(req,res)=>{
 const c=await manageFinance(req),b=ruleInput.parse(req.body);
 res.status(201).json(await transaction(async db=>{
  await checkRuleConflict(db,c,b);
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[c.organization_id+b.serviceId+(b.buildingId??'')+(b.unitId??'')]);
  await checkRuleConflict(db,c,b);
  const row=(await db.query(`INSERT INTO billing_rules(organization_id,service_id,tariff_id,scope_kind,building_id,unit_id,
   calculation_method,occupancy_count_mode,zero_policy,rounding_mode,proration_mode,minimum_amount,maximum_amount,
   valid_from,valid_until,active,priority,meter_kind,created_by)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
  [c.organization_id,b.serviceId,b.tariffId,b.scopeKind,b.buildingId??null,b.unitId??null,b.calculationMethod,b.occupancyCountMode??null,
   b.zeroPolicy,b.roundingMode,b.prorationMode,b.minimumAmount??null,b.maximumAmount??null,b.validFrom,b.validUntil??null,b.active,b.priority,b.meterKind??null,req.user!.id])).rows[0];
  await record(db,req,c,b.active?'finance.billing_rule.activated':'finance.billing_rule.created','billing_rule',row.id);return row;
 }));
});
billingConfiguration.patch('/finance/billing-rules/:id',async(req,res)=>{
 const c=await manageFinance(req),id=uuid.parse(req.params.id),b=z.object({active:z.boolean(),validUntil:day.nullable().optional()}).strict().parse(req.body);
 res.json(await transaction(async db=>{
  const old=(await db.query('SELECT * FROM billing_rules WHERE id=$1 AND organization_id=$2 FOR UPDATE',[id,c.organization_id])).rows[0];
  if(!old||c.building_id&&old.building_id!==c.building_id)throw new ApiError(404,'not_found');
  const updated={...old,active:b.active,validUntil:b.validUntil===undefined?old.valid_until?.toISOString?.().slice(0,10)??old.valid_until:b.validUntil};
  await checkRuleConflict(db,c,{serviceId:old.service_id,tariffId:old.tariff_id,scopeKind:old.scope_kind,buildingId:old.building_id??undefined,unitId:old.unit_id??undefined,
   calculationMethod:old.calculation_method,occupancyCountMode:old.occupancy_count_mode??undefined,zeroPolicy:old.zero_policy,roundingMode:old.rounding_mode,
   prorationMode:old.proration_mode,minimumAmount:old.minimum_amount===null?undefined:String(old.minimum_amount),maximumAmount:old.maximum_amount===null?undefined:String(old.maximum_amount),
   validFrom:String(old.valid_from).slice(0,10),validUntil:updated.validUntil??undefined,priority:old.priority,meterKind:old.meter_kind??undefined,active:b.active},id);
  const row=(await db.query('UPDATE billing_rules SET active=$3,valid_until=$4 WHERE id=$1 AND organization_id=$2 RETURNING *',[id,c.organization_id,b.active,updated.validUntil??null])).rows[0];
  await record(db,req,c,b.active?'finance.billing_rule.activated':'finance.billing_rule.deactivated','billing_rule',id);return row;
 }));
});

billingConfiguration.post('/finance/manual-charges',async(req,res)=>{
 const c=await manageFinance(req),b=z.object({unitId:uuid,serviceId:uuid,period:periodDay,amountMinor:positiveMinor,
  currency,reason:z.string().trim().min(5).max(1000),key:uuid}).strict().parse(req.body);
 if(BigInt(b.amountMinor)>amountLimit)throw new ApiError(400,'invalid_amount');
 const unit=await scopedUnit(c,b.unitId);
 res.status(201).json(await transaction(async db=>idempotent(db,req,b.key,b,async()=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[unit.id+b.serviceId+b.period]);
  const rule=(await db.query(`SELECT t.currency FROM billing_rules r
   JOIN services s ON s.id=r.service_id AND s.organization_id=r.organization_id
   JOIN tariffs t ON t.id=r.tariff_id AND t.service_id=r.service_id AND t.organization_id=r.organization_id
   WHERE r.organization_id=$1 AND r.service_id=$2 AND r.active AND r.calculation_method='MANUAL'
   AND s.active AND s.billing_enabled AND t.status='active' AND t.valid_from<=$5::date
   AND (t.valid_until IS NULL OR t.valid_until>=$6::date) AND r.valid_from<=$5::date
   AND (r.valid_until IS NULL OR r.valid_until>=$6::date)
   AND (r.scope_kind='organization' OR r.scope_kind='building' AND r.building_id=$3 OR r.scope_kind='unit' AND r.unit_id=$4)
   ORDER BY CASE r.scope_kind WHEN 'unit' THEN 3 WHEN 'building' THEN 2 ELSE 1 END DESC,r.priority DESC LIMIT 1`,
   [c.organization_id,b.serviceId,unit.building_id,unit.id,b.period,endOfMonth(b.period)])).rows[0];
  if(!rule)throw new ApiError(409,'manual_rule_required');
  if(rule.currency!==b.currency)throw new ApiError(400,'currency_mismatch');
  const old=(await db.query(`SELECT * FROM billing_manual_charges WHERE organization_id=$1 AND unit_id=$2
   AND service_id=$3 AND period=$4 AND status='active' FOR UPDATE`,
   [c.organization_id,unit.id,b.serviceId,b.period])).rows[0];
  const revision=Number((await db.query(`SELECT COALESCE(max(revision),0)+1 AS revision FROM billing_manual_charges
   WHERE organization_id=$1 AND unit_id=$2 AND service_id=$3 AND period=$4`,
   [c.organization_id,unit.id,b.serviceId,b.period])).rows[0].revision);
  if(old)await db.query("UPDATE billing_manual_charges SET status='superseded' WHERE id=$1",[old.id]);
  const row=(await db.query(`INSERT INTO billing_manual_charges(organization_id,unit_id,service_id,period,amount_minor,currency,
   reason,revision,supersedes_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
   [c.organization_id,unit.id,b.serviceId,b.period,b.amountMinor,b.currency,b.reason,revision,old?.id??null,req.user!.id])).rows[0];
  await record(db,req,c,'finance.manual_charge.created','billing_manual_charge',row.id,{unitId:unit.id,serviceId:b.serviceId,period:b.period,revision,reason:b.reason});
  return row;
 })));
});

billingConfiguration.post('/finance/billing/preview',async(req,res)=>{
 const c=await requirePermission(req,'billing.calculate'),b=z.object({buildingId:uuid,period:periodDay}).strict().parse(req.body);
 const result=await transaction(db=>calculateRuleBilling(db,c,b.buildingId,b.period,false));
 res.json({unitCount:result.snapshot.unitCount,chargeCount:result.snapshot.chargeCount,totalMinor:result.snapshot.totalMinor,
  charges:result.snapshot.charges.map((x:any)=>({unitNumber:x.unitNumber,serviceName:x.serviceName,calculationMethod:x.calculationMethod,baseQuantity:x.baseQuantity,baseUnit:x.baseUnit,rateMinor:x.rateMinor,currency:x.currency,rawAmountMinor:x.rawAmountMinor,roundedAmountMinor:x.roundedAmountMinor})),
  exceptions:result.snapshot.exceptions.map((x:any)=>({unitNumber:x.unitNumber,serviceName:x.serviceName,code:x.code}))});
});

billingConfiguration.get('/properties/:id/billing-parameters',async(req,res)=>{
 const c=await manageFinance(req),unit=await scopedUnit(c,uuid.parse(req.params.id));
 const today=new Date().toISOString().slice(0,10);
  const [param,residents,quantities,applicability,manualCharges]=await Promise.all([
  pool.query(`SELECT * FROM unit_billing_parameters WHERE organization_id=$1 AND unit_id=$2 AND effective_from<=$3::date
   AND (effective_until IS NULL OR effective_until>=$3::date) ORDER BY effective_from DESC LIMIT 1`,[c.organization_id,unit.id,today]),
  pool.query(`SELECT a.id AS assignment_id,a.user_id,u.name,a.role_key, e.resides_here,e.counts_for_billing,e.effective_from::text,e.effective_until::text
   FROM role_assignments a JOIN users u ON u.id=a.user_id
   LEFT JOIN LATERAL(SELECT * FROM unit_billing_resident_eligibility x WHERE x.role_assignment_id=a.id
    AND x.effective_from<=$3::date AND (x.effective_until IS NULL OR x.effective_until>=$3::date) ORDER BY x.effective_from DESC LIMIT 1)e ON true
   WHERE a.organization_id=$1 AND a.unit_id=$2 AND a.role_key IN('unit_owner','renter','family') AND a.active
   AND (a.expires_at IS NULL OR a.expires_at>now()) ORDER BY u.name`,[c.organization_id,unit.id,today]),
  pool.query(`SELECT q.*,s.name AS service_name FROM unit_billing_service_quantities q JOIN services s ON s.id=q.service_id
   WHERE q.organization_id=$1 AND q.unit_id=$2 AND q.effective_from<=$3::date AND (q.effective_until IS NULL OR q.effective_until>=$3::date)`,
  [c.organization_id,unit.id,today]),
  pool.query(`SELECT a.*,s.name AS service_name FROM unit_billing_service_applicability a JOIN services s ON s.id=a.service_id
   WHERE a.organization_id=$1 AND a.unit_id=$2 AND a.effective_from<=$3::date AND (a.effective_until IS NULL OR a.effective_until>=$3::date)`,
   [c.organization_id,unit.id,today]),
   pool.query(`SELECT m.id,m.service_id,s.name AS service_name,m.period::text,m.amount_minor::text,m.currency,m.reason,m.revision,m.created_at
    FROM billing_manual_charges m JOIN services s ON s.id=m.service_id AND s.organization_id=m.organization_id
    WHERE m.organization_id=$1 AND m.unit_id=$2 AND m.status='active' ORDER BY m.period DESC,m.created_at DESC LIMIT 12`,
    [c.organization_id,unit.id])
 ]);
 const p=param.rows[0];
 res.json({unit:{id:unit.id,building_id:unit.building_id,number:unit.number,legal_area:String(unit.area),
  billing_area:p?.billing_area===null||p?.billing_area===undefined?String(unit.area):String(p.billing_area)},
   parameters:p??null,residents:residents.rows,serviceQuantities:quantities.rows,serviceApplicability:applicability.rows,manualCharges:manualCharges.rows});
});

billingConfiguration.patch('/properties/:id/billing-parameters',async(req,res)=>{
 const c=await manageFinance(req),unit=await scopedUnit(c,uuid.parse(req.params.id)),b=z.object({
  effectiveFrom:day,billingArea:z.string().regex(/^\d{1,8}(?:\.\d{1,2})?$/).nullable().optional(),
  residentCountMode:z.enum(['AUTO_ACTIVE_RESIDENTS','REGISTRY_COUNT','MANUAL_COUNT']),
  billingResidentCount:z.number().int().min(0).max(1000).nullable().optional(),occupancyStatus:z.enum(['OCCUPIED','VACANT','UNKNOWN']),
  reason:z.string().trim().min(3).max(1000),residents:z.array(z.object({assignmentId:uuid,residesHere:z.boolean(),countsForBilling:z.boolean()}).strict()).max(100).default([]),
  serviceQuantities:z.array(z.object({serviceId:uuid,quantity:z.string().regex(/^\d{1,10}(?:\.\d{1,4})?$/)}).strict()).max(50).default([]),
  serviceApplicability:z.array(z.object({serviceId:uuid,enabled:z.boolean()}).strict()).max(50).default([])
 }).strict().parse(req.body);
 if(!b.effectiveFrom.endsWith('-01'))throw new ApiError(400,'effective_date_must_start_month');
 if(b.billingArea!==undefined&&b.billingArea!==null&&Number(b.billingArea)<=0)throw new ApiError(400,'invalid_area');
 if((b.residentCountMode==='AUTO_ACTIVE_RESIDENTS')&&(b.billingResidentCount!==undefined&&b.billingResidentCount!==null)||
    (b.residentCountMode!=='AUTO_ACTIVE_RESIDENTS')&&b.billingResidentCount==null)throw new ApiError(400,'invalid_resident_count');
 inScope(c,unit.building_id,unit.id);
 const result=await transaction(async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[unit.id+'billing-parameters']);
  const current=(await db.query(`SELECT * FROM unit_billing_parameters WHERE organization_id=$1 AND unit_id=$2
   AND effective_from<=$3::date AND (effective_until IS NULL OR effective_until>=$3::date) ORDER BY effective_from DESC LIMIT 1 FOR UPDATE`,
  [c.organization_id,unit.id,b.effectiveFrom])).rows[0];
  if(current&&current.effective_from===b.effectiveFrom)throw new ApiError(409,'billing_parameter_version_exists');
  if(current)await db.query('UPDATE unit_billing_parameters SET effective_until=$2::date-1 WHERE id=$1',[current.id,b.effectiveFrom]);
  const row=(await db.query(`INSERT INTO unit_billing_parameters(organization_id,unit_id,billing_area,resident_count_mode,billing_resident_count,
   occupancy_status,effective_from,reason,changed_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
  [c.organization_id,unit.id,b.billingArea===undefined?current?.billing_area??null:b.billingArea,b.residentCountMode,
   b.residentCountMode==='AUTO_ACTIVE_RESIDENTS'?null:b.billingResidentCount,b.occupancyStatus,b.effectiveFrom,b.reason,req.user!.id])).rows[0];
  for(const person of b.residents){
   const assignment=(await db.query(`SELECT id FROM role_assignments WHERE id=$1 AND organization_id=$2 AND unit_id=$3
    AND role_key IN('unit_owner','renter','family') AND active`,[person.assignmentId,c.organization_id,unit.id])).rows[0];
   if(!assignment)throw new ApiError(400,'invalid_resident_assignment');
   const prior=(await db.query(`SELECT id FROM unit_billing_resident_eligibility WHERE role_assignment_id=$1
    AND effective_from<=$2::date AND (effective_until IS NULL OR effective_until>=$2::date) FOR UPDATE`,
   [person.assignmentId,b.effectiveFrom])).rows[0];
   if(prior)await db.query('UPDATE unit_billing_resident_eligibility SET effective_until=$2::date-1 WHERE id=$1',[prior.id,b.effectiveFrom]);
   await db.query(`INSERT INTO unit_billing_resident_eligibility(organization_id,unit_id,role_assignment_id,resides_here,counts_for_billing,effective_from,reason,changed_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[c.organization_id,unit.id,person.assignmentId,person.residesHere,person.countsForBilling,b.effectiveFrom,b.reason,req.user!.id]);
  }
  for(const q of b.serviceQuantities){
   const service=(await db.query('SELECT id FROM services WHERE id=$1 AND organization_id=$2',[q.serviceId,c.organization_id])).rows[0];
   if(!service)throw new ApiError(404,'not_found');
   const prior=(await db.query(`SELECT id FROM unit_billing_service_quantities WHERE organization_id=$1 AND unit_id=$2 AND service_id=$3
    AND effective_from<=$4::date AND (effective_until IS NULL OR effective_until>=$4::date) FOR UPDATE`,[c.organization_id,unit.id,q.serviceId,b.effectiveFrom])).rows[0];
   if(prior)await db.query('UPDATE unit_billing_service_quantities SET effective_until=$2::date-1 WHERE id=$1',[prior.id,b.effectiveFrom]);
   await db.query(`INSERT INTO unit_billing_service_quantities(organization_id,unit_id,service_id,quantity,effective_from,reason,changed_by)
    VALUES($1,$2,$3,$4,$5,$6,$7)`,[c.organization_id,unit.id,q.serviceId,q.quantity,b.effectiveFrom,b.reason,req.user!.id]);
  }
  for(const item of b.serviceApplicability){
   const service=(await db.query('SELECT id,mandatory FROM services WHERE id=$1 AND organization_id=$2',[item.serviceId,c.organization_id])).rows[0];
   if(!service)throw new ApiError(404,'not_found');
   if(service.mandatory&&!item.enabled)throw new ApiError(409,'mandatory_service_cannot_be_disabled');
   const prior=(await db.query(`SELECT id FROM unit_billing_service_applicability WHERE organization_id=$1 AND unit_id=$2 AND service_id=$3
    AND effective_from<=$4::date AND (effective_until IS NULL OR effective_until>=$4::date) FOR UPDATE`,[c.organization_id,unit.id,item.serviceId,b.effectiveFrom])).rows[0];
   if(prior)await db.query('UPDATE unit_billing_service_applicability SET effective_until=$2::date-1 WHERE id=$1',[prior.id,b.effectiveFrom]);
   await db.query(`INSERT INTO unit_billing_service_applicability(organization_id,unit_id,service_id,enabled,effective_from,reason,changed_by)
    VALUES($1,$2,$3,$4,$5,$6,$7)`,[c.organization_id,unit.id,item.serviceId,item.enabled,b.effectiveFrom,b.reason,req.user!.id]);
  }
  await record(db,req,c,'billing.unit_parameters.changed','unit',unit.id,{effectiveFrom:b.effectiveFrom,reason:b.reason});
  return row;
 });
 res.json(result);
});

billingConfiguration.post('/resident/finance/parameter-reviews',async(req,res)=>{
 const s=await ownScope(req);await requirePermission(req,'billing.own');
 const b=z.object({parameterKey:z.enum(['billing_area','resident_count','service_applicability','parking_count']),
  serviceId:uuid.optional(),proposedValue:z.union([z.string().trim().min(1).max(120),z.number().finite().min(0),z.boolean()]),
  effectiveFrom:day.optional(),reason:z.string().trim().min(5).max(2000),clientId:uuid}).strict().parse(req.body);
 if(['service_applicability','parking_count'].includes(b.parameterKey)&&!b.serviceId)throw new ApiError(400,'service_required');
 if(b.parameterKey==='service_applicability'&&typeof b.proposedValue!=='boolean'||b.parameterKey==='parking_count'&&typeof b.proposedValue!=='number')throw new ApiError(400,'invalid_value');
 if(b.parameterKey==='billing_area'&&(typeof b.proposedValue!=='number'||b.proposedValue<=0)||
    b.parameterKey==='resident_count'&&(typeof b.proposedValue!=='number'||!Number.isInteger(b.proposedValue)||b.proposedValue<0))throw new ApiError(400,'invalid_value');
 if(b.effectiveFrom&&!b.effectiveFrom.endsWith('-01'))throw new ApiError(400,'effective_date_must_start_month');
 const current=await pool.query(`SELECT u.area::text AS legal_area,p.billing_area::text AS billing_area,
  p.resident_count_mode,p.billing_resident_count
  FROM units u LEFT JOIN LATERAL(SELECT * FROM unit_billing_parameters x WHERE x.organization_id=u.organization_id
   AND x.unit_id=u.id AND x.effective_from<=CURRENT_DATE AND (x.effective_until IS NULL OR x.effective_until>=CURRENT_DATE)
   ORDER BY x.effective_from DESC LIMIT 1)p ON true WHERE u.id=$1 AND u.organization_id=$2`,[s.unitId,s.organizationId]);
 if(!current.rowCount)throw new ApiError(404,'not_found');
 const activeResidentCount=b.parameterKey==='resident_count'&&current.rows[0].resident_count_mode==='AUTO_ACTIVE_RESIDENTS'
  ?(await pool.query(`SELECT count(*)::int AS count FROM role_assignments a JOIN LATERAL(
    SELECT e.resides_here,e.counts_for_billing FROM unit_billing_resident_eligibility e
    WHERE e.organization_id=a.organization_id AND e.role_assignment_id=a.id AND e.effective_from<=CURRENT_DATE
    AND (e.effective_until IS NULL OR e.effective_until>=CURRENT_DATE) ORDER BY e.effective_from DESC LIMIT 1
   )e ON true WHERE a.organization_id=$1 AND a.unit_id=$2 AND a.active AND a.role_key IN('unit_owner','renter','family')
   AND (a.expires_at IS NULL OR a.expires_at>now()) AND e.resides_here AND e.counts_for_billing`,
   [s.organizationId,s.unitId])).rows[0].count
  :null;
 const request=await transaction(async db=>idempotent(db,req,b.clientId,b,async()=>{
  const serviceCurrent=b.serviceId?await db.query(`SELECT (SELECT enabled FROM unit_billing_service_applicability a WHERE a.organization_id=$1 AND a.unit_id=$2 AND a.service_id=$3
    ORDER BY a.effective_from DESC LIMIT 1) AS enabled,(SELECT quantity::text FROM unit_billing_service_quantities q WHERE q.organization_id=$1 AND q.unit_id=$2 AND q.service_id=$3
    ORDER BY q.effective_from DESC LIMIT 1) AS quantity`,[s.organizationId,s.unitId,b.serviceId]):null;
  const currentValue=b.parameterKey==='billing_area'?current.rows[0].billing_area??current.rows[0].legal_area:
   b.parameterKey==='resident_count'?activeResidentCount??current.rows[0].billing_resident_count??null:
   b.parameterKey==='service_applicability'?serviceCurrent?.rows[0]?.enabled??null:
   b.parameterKey==='parking_count'?serviceCurrent?.rows[0]?.quantity??null:null;
  const row=(await db.query(`INSERT INTO billing_parameter_review_requests(organization_id,unit_id,requested_by,service_id,parameter_key,current_value,proposed_value,effective_from,reason)
   VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9) RETURNING *`,
  [s.organizationId,s.unitId,req.user!.id,b.serviceId??null,b.parameterKey,JSON.stringify(currentValue),JSON.stringify(b.proposedValue),b.effectiveFrom??null,b.reason])).rows[0];
  await record(db,req,s.c,'billing.parameter_review.requested','billing_parameter_review',row.id);return row;
 }));
 res.status(201).json(request);
});

billingConfiguration.get('/finance/billing-parameter-reviews',async(req,res)=>{
 const c=await requirePermission(req,'billing.calculate');
 res.json((await pool.query(`SELECT r.*,r.created_at::text,s.name AS resident_name,u.number AS unit_number,b.name AS building_name
  FROM billing_parameter_review_requests r JOIN users s ON s.id=r.requested_by JOIN units u ON u.id=r.unit_id
  JOIN buildings b ON b.id=u.building_id WHERE r.organization_id=$1 AND ($2::uuid IS NULL OR b.id=$2)
  AND ($3::uuid IS NULL OR u.id=$3) ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END,r.created_at DESC LIMIT 250`,
 [c.organization_id,c.building_id,c.unit_id])).rows);
});

billingConfiguration.post('/finance/billing-parameter-reviews/:id/decision',async(req,res)=>{
 const c=await requirePermission(req,'billing.publish'),id=uuid.parse(req.params.id),b=z.object({
  action:z.enum(['approve','reject','needs_information']),version:z.number().int().positive(),note:z.string().trim().max(1000).default('')
 }).strict().parse(req.body);
 const row=await transaction(async db=>{
  const item=(await db.query('SELECT * FROM billing_parameter_review_requests WHERE id=$1 AND organization_id=$2 FOR UPDATE',[id,c.organization_id])).rows[0];
  if(!item)throw new ApiError(404,'not_found');
  const scoped=(await db.query('SELECT building_id FROM units WHERE id=$1 AND organization_id=$2',[item.unit_id,c.organization_id])).rows[0];
  if(!scoped||c.building_id&&scoped.building_id!==c.building_id)throw new ApiError(404,'not_found');
  if(item.version!==b.version||item.status!=='pending')throw new ApiError(409,'stale_version');
  const status=b.action==='approve'?'approved':b.action==='reject'?'rejected':'needs_information';
  if(status==='approved'){
   const unit=(await db.query('SELECT * FROM units WHERE id=$1 AND organization_id=$2',[item.unit_id,c.organization_id])).rows[0];
   if(!unit||c.building_id&&unit.building_id!==c.building_id)throw new ApiError(404,'not_found');
   const value=typeof item.proposed_value==='string'?item.proposed_value:JSON.stringify(item.proposed_value);
   const nextMonth=new Date();nextMonth.setUTCMonth(nextMonth.getUTCMonth()+1,1);
   const from=item.effective_from??nextMonth.toISOString().slice(0,10);
   if(item.parameter_key==='billing_area'||item.parameter_key==='resident_count'){
    const old=(await db.query(`SELECT * FROM unit_billing_parameters WHERE organization_id=$1 AND unit_id=$2
     AND effective_from<=$3::date AND (effective_until IS NULL OR effective_until>=$3::date) ORDER BY effective_from DESC LIMIT 1 FOR UPDATE`,
    [c.organization_id,unit.id,from])).rows[0];
    if(old)await db.query('UPDATE unit_billing_parameters SET effective_until=$2::date-1 WHERE id=$1',[old.id,from]);
    await db.query(`INSERT INTO unit_billing_parameters(organization_id,unit_id,billing_area,resident_count_mode,billing_resident_count,
     occupancy_status,effective_from,reason,changed_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [c.organization_id,unit.id,item.parameter_key==='billing_area'?value:old?.billing_area??null,
     item.parameter_key==='resident_count'?'MANUAL_COUNT':old?.resident_count_mode??'AUTO_ACTIVE_RESIDENTS',
     item.parameter_key==='resident_count'?Number(value):old?.billing_resident_count??null,old?.occupancy_status??'UNKNOWN',
     from,'Approved resident review '+item.id,req.user!.id]);
   }
   if(item.parameter_key==='service_applicability'){
    if(!item.service_id||typeof item.proposed_value!=='boolean')throw new ApiError(409,'invalid_review_value');
    const service=(await db.query('SELECT mandatory FROM services WHERE id=$1 AND organization_id=$2',[item.service_id,c.organization_id])).rows[0];
    if(!service||service.mandatory&&!item.proposed_value)throw new ApiError(409,'mandatory_service_cannot_be_disabled');
    const old=(await db.query(`SELECT id FROM unit_billing_service_applicability WHERE organization_id=$1 AND unit_id=$2 AND service_id=$3
     AND effective_from<=$4::date AND (effective_until IS NULL OR effective_until>=$4::date) ORDER BY effective_from DESC LIMIT 1 FOR UPDATE`,
    [c.organization_id,unit.id,item.service_id,from])).rows[0];
    if(old)await db.query('UPDATE unit_billing_service_applicability SET effective_until=$2::date-1 WHERE id=$1',[old.id,from]);
    await db.query(`INSERT INTO unit_billing_service_applicability(organization_id,unit_id,service_id,enabled,effective_from,reason,changed_by)
     VALUES($1,$2,$3,$4,$5,$6,$7)`,[c.organization_id,unit.id,item.service_id,item.proposed_value,from,'Approved resident review '+item.id,req.user!.id]);
   }
   if(item.parameter_key==='parking_count'){
    if(!item.service_id||!Number.isFinite(Number(value))||Number(value)<0)throw new ApiError(409,'invalid_review_value');
    const old=(await db.query(`SELECT id FROM unit_billing_service_quantities WHERE organization_id=$1 AND unit_id=$2 AND service_id=$3
     AND effective_from<=$4::date AND (effective_until IS NULL OR effective_until>=$4::date) ORDER BY effective_from DESC LIMIT 1 FOR UPDATE`,
    [c.organization_id,unit.id,item.service_id,from])).rows[0];
    if(old)await db.query('UPDATE unit_billing_service_quantities SET effective_until=$2::date-1 WHERE id=$1',[old.id,from]);
    await db.query(`INSERT INTO unit_billing_service_quantities(organization_id,unit_id,service_id,quantity,effective_from,reason,changed_by)
     VALUES($1,$2,$3,$4,$5,$6,$7)`,[c.organization_id,unit.id,item.service_id,value,from,'Approved resident review '+item.id,req.user!.id]);
   }
  }
  const updated=(await db.query(`UPDATE billing_parameter_review_requests SET status=$2,decision_note=$3,decided_by=$4,decided_at=now(),version=version+1
   WHERE id=$1 RETURNING *`,[id,status,b.note||null,req.user!.id])).rows[0];
  await record(db,req,c,'billing.parameter_review.'+status,'billing_parameter_review',id,{unitId:item.unit_id});return updated;
 });
 res.json(row);
});
