import {authenticator} from 'otplib';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {app} from '../app.js';
import {pool} from '../db.js';
import {config} from '../config.js';
if(config.NODE_ENV!=='test'||!new URL(config.DATABASE_URL).pathname.endsWith('/vernatun_test'))throw new Error('Tests require isolated vernatun_test database');
const seeded=JSON.parse(await readFile('.local/test/demo-accounts.json','utf8'));
let base='';const server=app.listen(0,'127.0.0.1');
class Client{cookie='';csrf='';async call(path:string,method='GET',body?:unknown,csrf=true){const r=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',...(this.cookie?{Cookie:this.cookie}:{}),...(csrf&&method!=='GET'?{'X-CSRF-Token':this.csrf}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});const cookies=r.headers.getSetCookie();if(cookies.length)this.cookie=cookies.map(x=>x.split(';')[0]).join('; ');const data=r.status===204?null:await r.json();if(data?.csrf)this.csrf=data.csrf;return {status:r.status,data}}async login(key:string){const a=seeded.accounts[key];await this.call('/auth/session');const r=await this.call('/auth/login','POST',{email:a.email,password:a.password});assert.equal(r.status,200);if(!r.data.contextId){const id=r.data.contexts.find((x:any)=>x.role_key===a.role).id;assert.equal((await this.call('/auth/context','POST',{id})).status,200)}return this}}

let accountant:Client,owner:Client,family:Client,other:Client,developer:Client,contractor:Client,guard:Client,support:Client,org:Client;
before(async()=>{await pool.query("DELETE FROM auth_rate_limits");await new Promise<void>(r=>server.listening?r():server.on('listening',r));base='http://127.0.0.1:'+(server.address() as {port:number}).port;accountant=await new Client().login('accountant');owner=await new Client().login('unit_owner');family=await new Client().login('family');other=await new Client().login('second_org');developer=await new Client().login('developer');contractor=await new Client().login('contractor');guard=await new Client().login('security');support=await new Client().login('support');org=await new Client().login('org_admin')});
after(async()=>{server.close();server.closeAllConnections();await pool.end()});
test('Calculation → publication → idempotent payment → adjustment; no float or resident privilege escalation',async()=>{
 const tariff=await accountant.call('/finance/tariffs','POST',{name:'Maintenance '+Date.now(),amountMinor:'12345',currency:'AMD',basis:'area'});assert.equal(tariff.status,201);
 const payer=await accountant.call('/finance/payers','POST',{unitId:seeded.fixtures.ua,payerId:seeded.accounts.unit_owner.id,serviceId:tariff.data.service_id,startsOn:'2026-09-01'});assert.equal(payer.status,201);
 assert.equal((await accountant.call('/finance/payers','POST',{unitId:seeded.fixtures.ub,payerId:seeded.accounts.unit_owner.id,serviceId:tariff.data.service_id,startsOn:'2026-09-01'})).status,404);
 const draft=await accountant.call('/finance/calculate','POST',{payerAssignmentId:payer.data.id,tariffId:tariff.data.id,period:'2026-10-01'});assert.equal(draft.status,201);const id=draft.data.id;
 const area=(await pool.query('SELECT area::text FROM units WHERE id=$1',[seeded.fixtures.ua])).rows[0].area;assert.equal(draft.data.amount_minor,((12345n*BigInt(area.replace('.',''))+50n)/100n).toString());
 assert.equal((await owner.call('/finance/invoices/'+id+'/details')).status,404);assert.equal((await owner.call('/finance/invoices/'+id+'/publish','POST',{})).status,403);
 assert.equal((await accountant.call('/finance/invoices/'+id+'/publish','POST',{})).status,200);assert.equal((await owner.call('/finance/invoices/'+id+'/details')).status,200);assert.equal((await family.call('/finance')).status,403);
 const body={invoiceId:id,amountMinor:'10000',source:'sandbox',reference:'test-'+randomBytes(8).toString('hex')};const repeats=await Promise.all([accountant.call('/finance/payments','POST',body),accountant.call('/finance/payments','POST',body)]);assert.ok(repeats.every(x=>x.status===201));assert.equal(repeats[0].data.id,repeats[1].data.id);
 assert.equal((await accountant.call('/finance/payments','POST',{...body,amountMinor:'20000'})).status,409);assert.equal((await owner.call('/finance/payments','POST',body)).status,403);
 const details=await owner.call('/finance/invoices/'+id+'/details');assert.equal(details.data.paid_minor,'10000');assert.equal(details.data.payments.length,1);
 const key=crypto.randomUUID();const adjustment={invoiceId:id,amountMinor:'-100',reason:'Correct rounding basis',key};assert.equal((await accountant.call('/finance/adjustments','POST',adjustment)).status,201);assert.equal((await accountant.call('/finance/adjustments','POST',adjustment)).status,201);assert.equal((await owner.call('/finance/invoices/'+id+'/details')).data.adjustments.length,1);
 await assert.rejects(pool.query('UPDATE invoice_lines SET amount_minor=1 WHERE invoice_id=$1',[id]));await assert.rejects(pool.query('DELETE FROM payments WHERE id=$1',[repeats[0].data.id]));
});
test('Calculation — configurable billing preserves an auditable rule snapshot through publication',async()=>{
 const effective=new Date();effective.setUTCDate(1);effective.setUTCMonth(effective.getUTCMonth()+48+(randomBytes(1)[0]%24));
 const period=effective.toISOString().slice(0,10);
 const unit=seeded.fixtures.ua;
 const buildingId=(await pool.query('SELECT building_id FROM units WHERE id=$1',[unit])).rows[0].building_id;
 const service=await accountant.call('/finance/services','POST',{name:'Area service '+randomBytes(4).toString('hex'),description:'Billing rule integration test',category:'maintenance',mandatory:true,defaultCalculationMethod:'PER_SQUARE_METER'});
 assert.equal(service.status,201);
 const tariff=await accountant.call('/finance/tariffs','POST',{serviceId:service.data.id,name:'120 AMD per square meter',amountMinor:'12000',currency:'AMD',calculationMethod:'PER_SQUARE_METER',rateUnit:'AMD/m²',validFrom:period});
 assert.equal(tariff.status,201);
 const payer=await accountant.call('/finance/payers','POST',{unitId:unit,payerId:seeded.accounts.unit_owner.id,serviceId:service.data.id,startsOn:period});
 assert.equal(payer.status,201);
 const parameters=await accountant.call(`/properties/${unit}/billing-parameters`,'PATCH',{
  effectiveFrom:period,billingArea:'66.30',residentCountMode:'AUTO_ACTIVE_RESIDENTS',billingResidentCount:null,
  occupancyStatus:'OCCUPIED',reason:'Verified area for rule calculation test',residents:[],serviceQuantities:[],serviceApplicability:[]
 });
 assert.equal(parameters.status,200);
 const rule=await accountant.call('/finance/billing-rules','POST',{
  serviceId:service.data.id,tariffId:tariff.data.id,scopeKind:'building',buildingId,
  calculationMethod:'PER_SQUARE_METER',zeroPolicy:'ALLOW_ZERO',roundingMode:'NEAREST_AMD',
  prorationMode:'DISABLED',validFrom:period,active:true,priority:50
 });
 assert.equal(rule.status,201);
 const preview=await accountant.call('/finance/billing/preview','POST',{buildingId,period});
 assert.equal(preview.status,200);
 const charge=preview.data.charges.find((line:any)=>line.serviceName===service.data.name);
 assert.ok(charge,JSON.stringify(preview.data));
 assert.equal(String(charge.baseQuantity),'66.30');
 assert.equal(String(charge.rawAmountMinor),'795600');
 assert.equal(String(charge.roundedAmountMinor),'795600');
 const draft=await accountant.call('/finance/rule-batches','POST',{buildingId,period,key:crypto.randomUUID()});
 assert.equal(draft.status,201);
 const published=await accountant.call(`/finance/batches/${draft.data.id}/publish`,'POST',{
  key:crypto.randomUUID(),version:draft.data.version,acceptWarnings:true
 });
 assert.equal(published.status,200);
 const stored=(await pool.query(`SELECT i.id,il.amount_minor::text,il.calculation_metadata
  FROM charges ch JOIN invoices i ON i.id=ch.invoice_id
  JOIN invoice_lines il ON il.invoice_id=i.id
  WHERE ch.payer_assignment_id=$1 AND ch.period=$2`,[payer.data.id,period])).rows[0];
 assert.ok(stored);
 assert.equal(stored.amount_minor,'795600');
 assert.equal(stored.calculation_metadata.method,'PER_SQUARE_METER');
 assert.equal(stored.calculation_metadata.serviceId,service.data.id);
 assert.equal((await owner.call(`/finance/invoices/${stored.id}/details`)).status,200);
 assert.equal((await family.call(`/finance/invoices/${stored.id}/details`)).status,403);
  const manualService=await accountant.call('/finance/services','POST',{name:'Manual service '+randomBytes(4).toString('hex'),description:'Manual charge integration test',category:'maintenance',mandatory:false,defaultCalculationMethod:'MANUAL'});
  assert.equal(manualService.status,201);
  const manualTariff=await accountant.call('/finance/tariffs','POST',{serviceId:manualService.data.id,name:'Manual test tariff',amountMinor:'100',currency:'AMD',calculationMethod:'MANUAL',rateUnit:'fixed',validFrom:period});
  assert.equal(manualTariff.status,201);
  const manualPayer=await accountant.call('/finance/payers','POST',{unitId:unit,payerId:seeded.accounts.unit_owner.id,serviceId:manualService.data.id,startsOn:period});
  assert.equal(manualPayer.status,201);
  const manualRule=await accountant.call('/finance/billing-rules','POST',{serviceId:manualService.data.id,tariffId:manualTariff.data.id,scopeKind:'building',buildingId,calculationMethod:'MANUAL',zeroPolicy:'ALLOW_ZERO',roundingMode:'NEAREST_AMD',prorationMode:'DISABLED',validFrom:period,active:true,priority:55});
  assert.equal(manualRule.status,201);
  const manualInput={unitId:unit,serviceId:manualService.data.id,period,amountMinor:'125000',currency:'AMD',reason:'Approved one-time maintenance charge',key:crypto.randomUUID()};
  assert.equal((await owner.call('/finance/manual-charges','POST',manualInput)).status,403);
  const manualSaves=await Promise.all([accountant.call('/finance/manual-charges','POST',manualInput),accountant.call('/finance/manual-charges','POST',manualInput)]);
  assert.ok(manualSaves.every(result=>result.status===201));assert.equal(manualSaves[0].data.id,manualSaves[1].data.id);
  const manualPreview=await accountant.call('/finance/billing/preview','POST',{buildingId,period});
  const manualLine=manualPreview.data.charges.find((line:any)=>line.serviceName===manualService.data.name);
  assert.ok(manualLine);assert.equal(String(manualLine.roundedAmountMinor),'125000');
  const manualDraft=await accountant.call('/finance/rule-batches','POST',{buildingId,period,key:crypto.randomUUID()});
  const manualPublished=await accountant.call(`/finance/batches/${manualDraft.data.id}/publish`,'POST',{key:crypto.randomUUID(),version:manualDraft.data.version,acceptWarnings:true});
  assert.equal(manualPublished.status,200);
  const manualStored=(await pool.query(`SELECT i.id,il.calculation_metadata FROM charges ch JOIN invoices i ON i.id=ch.invoice_id JOIN invoice_lines il ON il.invoice_id=i.id
   WHERE ch.payer_assignment_id=$1 AND ch.period=$2`,[manualPayer.data.id,period])).rows[0];
  assert.equal(manualStored.calculation_metadata.manualChargeId,manualSaves[0].data.id);
  assert.equal(manualStored.calculation_metadata.manualReason,'Approved one-time maintenance charge');
  const manualRevision=await accountant.call('/finance/manual-charges','POST',{...manualInput,amountMinor:'130000',reason:'Approved revised maintenance amount',key:crypto.randomUUID()});
  assert.equal(manualRevision.status,201);assert.equal(manualRevision.data.revision,2);
  assert.equal((await pool.query('SELECT status FROM billing_manual_charges WHERE id=$1',[manualSaves[0].data.id])).rows[0].status,'superseded');
  const immutableManual=(await pool.query('SELECT calculation_metadata FROM invoice_lines WHERE invoice_id=$1',[manualStored.id])).rows[0];
  assert.equal(immutableManual.calculation_metadata.manualChargeId,manualSaves[0].data.id);
  const review=await owner.call('/resident/finance/parameter-reviews','POST',{serviceId:manualService.data.id,parameterKey:'service_applicability',proposedValue:false,effectiveFrom:period,reason:'This optional service does not apply to the unit',clientId:crypto.randomUUID()});
  assert.equal(review.status,201,JSON.stringify(review.data));
  const reviewQueue=await accountant.call('/finance/billing-parameter-reviews');
  assert.ok(reviewQueue.data.some((item:any)=>item.id===review.data.id));
  assert.equal((await owner.call(`/finance/billing-parameter-reviews/${review.data.id}/decision`,'POST',{action:'approve',version:1})).status,403);
  assert.equal((await accountant.call(`/finance/billing-parameter-reviews/${review.data.id}/decision`,'POST',{action:'approve',version:1,note:'Verified against unit service plan'})).status,200);
  const organizationId=(await pool.query('SELECT organization_id FROM units WHERE id=$1',[unit])).rows[0].organization_id;
  assert.equal((await pool.query('SELECT enabled FROM unit_billing_service_applicability WHERE organization_id=$1 AND unit_id=$2 AND service_id=$3 AND effective_from=$4',[organizationId,unit,manualService.data.id,period])).rows[0].enabled,false);
});
test('Calculation — billing formulas, limits, proration and saved line explanations',async()=>{
 const period='2040-01-01',unit=seeded.fixtures.ua;
 const buildingId=(await pool.query('SELECT building_id FROM units WHERE id=$1',[unit])).rows[0].building_id;
 const organizationId=(await pool.query('SELECT organization_id FROM units WHERE id=$1',[unit])).rows[0].organization_id;
 const daysInPeriod=new Date(Date.UTC(Number(period.slice(0,4)),Number(period.slice(5,7)),0)).getUTCDate();
 const activeFrom=`${period.slice(0,7)}-11`,activeUntil=`${period.slice(0,7)}-20`,activeDays=10;
 const stamp=randomBytes(5).toString('hex');
 const ownerAssignment=(await pool.query("SELECT id FROM role_assignments WHERE user_id=$1 AND unit_id=$2 AND role_key='unit_owner' AND active",[seeded.accounts.unit_owner.id,unit])).rows[0].id;
 const familyAssignment=(await pool.query("SELECT id FROM role_assignments WHERE user_id=$1 AND unit_id=$2 AND role_key='family' AND active",[seeded.accounts.family.id,unit])).rows[0].id;
 const makeRule=async(serviceId:string,tariffId:string,options:Record<string,any>={})=>{
  const scopeKind=options.scopeKind??'unit';
  const body={serviceId,tariffId,scopeKind,...(scopeKind==='organization'?{}:{buildingId}),
   ...(scopeKind==='unit'?{unitId:unit}:{}),calculationMethod:options.method,zeroPolicy:'ALLOW_ZERO',
   roundingMode:options.roundingMode??'NEAREST_AMD',prorationMode:options.prorationMode??'DISABLED',
   validFrom:options.validFrom??period,...(options.validUntil?{validUntil:options.validUntil}:{}),
   priority:options.priority??10,active:true,...(options.minimumAmount?{minimumAmount:options.minimumAmount}:{}),
   ...(options.maximumAmount?{maximumAmount:options.maximumAmount}:{}),
   ...(options.occupancyCountMode?{occupancyCountMode:options.occupancyCountMode}:{}),
   ...(options.meterKind?{meterKind:options.meterKind}:{})};
  const result=await accountant.call('/finance/billing-rules','POST',body);
  assert.equal(result.status,201,JSON.stringify(result.data));return result.data;
 };
 const createCase=async(name:string,method:string,rate:string,options:Record<string,any>={})=>{
  const service=await accountant.call('/finance/services','POST',{name:`${name} ${stamp}`,description:'Billing formula integration test',
   category:'maintenance',mandatory:true,defaultCalculationMethod:method});
  assert.equal(service.status,201,JSON.stringify(service.data));
  const tariff=await accountant.call('/finance/configuration/tariffs','POST',{
   serviceId:service.data.id,name:`${name} tariff ${stamp}`,amountMinor:rate,currency:'AMD',
   calculationMethod:method,rateUnit:options.rateUnit??'AMD/unit',validFrom:period
  });
  assert.equal(tariff.status,201,JSON.stringify(tariff.data));
  const payer=await accountant.call('/finance/payers','POST',{
   unitId:unit,payerId:seeded.accounts.unit_owner.id,serviceId:service.data.id,startsOn:period
  });
  assert.equal(payer.status,201,JSON.stringify(payer.data));
  const rule=await makeRule(service.data.id,tariff.data.id,{method,...options});
  return {name:service.data.name,service:service.data,tariff:tariff.data,payer:payer.data,rule};
 };
 const fixed=await createCase('Fixed', 'FIXED_PER_UNIT','12345',{minimumAmount:'13000'});
 const residents=await createCase('Residents','PER_RESIDENT','300',{occupancyCountMode:'AUTO_ACTIVE_RESIDENTS',rateUnit:'AMD/resident'});
 const parking=await createCase('Parking','PER_PARKING_SPACE','1250',{rateUnit:'AMD/parking_space'});
 const quantity=await createCase('Quantity','PER_QUANTITY','50',{rateUnit:'AMD/quantity'});
 const meter=await createCase('Meter','PER_METER_CONSUMPTION','800',{meterKind:'water',rateUnit:'AMD/m³'});
 const prorated=await createCase('Prorated','FIXED_PER_UNIT','3100',{
  validFrom:activeFrom,validUntil:activeUntil,prorationMode:'DAILY'
 });
 const daily=await createCase('Daily','PER_DAY','400',{
  validFrom:activeFrom,validUntil:activeUntil,rateUnit:'AMD/day'
 });
 const capped=await createCase('Maximum','FIXED_PER_UNIT','24890',{maximumAmount:'24000'});
 const roundUp=await createCase('Round up','FIXED_PER_UNIT','123',{roundingMode:'ROUND_UP_AMD'});
 const roundDown=await createCase('Round down','FIXED_PER_UNIT','177',{roundingMode:'ROUND_DOWN_AMD'});
 const overlapping=await createCase('Overlapping','FIXED_PER_UNIT','777');
 const missingQuantity=await createCase('Missing quantity','PER_QUANTITY','100');
 const missingMeter=await createCase('Missing meter','PER_METER_CONSUMPTION','100',{meterKind:'electricity'});
 const higherLevelRule=await makeRule(overlapping.service.id,overlapping.tariff.id,{
  scopeKind:'organization',method:'FIXED_PER_UNIT',priority:99
 });
 const parameters=await accountant.call(`/properties/${unit}/billing-parameters`,'PATCH',{
  effectiveFrom:period,billingArea:null,residentCountMode:'AUTO_ACTIVE_RESIDENTS',billingResidentCount:null,
  occupancyStatus:'OCCUPIED',reason:'Set isolated billing formula fixtures',
  residents:[ownerAssignment,familyAssignment].map(assignmentId=>({assignmentId,residesHere:true,countsForBilling:true})),
  serviceQuantities:[{serviceId:parking.service.id,quantity:'2'},{serviceId:quantity.service.id,quantity:'3'}],
  serviceApplicability:[]
 });
 assert.equal(parameters.status,200,JSON.stringify(parameters.data));
 let waterMeters=(await pool.query("SELECT id FROM meters WHERE organization_id=$1 AND unit_id=$2 AND kind='water' ORDER BY id",[organizationId,unit])).rows;
 if(!waterMeters.length)waterMeters=[(await pool.query(`INSERT INTO meters(organization_id,unit_id,serial_number,kind)
  VALUES($1,$2,$3,'water') RETURNING id`,[organizationId,unit,`billing-${stamp}`])).rows[0]];
 const previousMonth=new Date(period+'T00:00:00Z');previousMonth.setUTCMonth(previousMonth.getUTCMonth()-1);
 const previousPeriod=previousMonth.toISOString().slice(0,10);
 for(const readingMeter of waterMeters)await pool.query(`INSERT INTO meter_readings(meter_id,value_thousandths,period,created_by)
  VALUES($1,10000,$2,$3),($1,12500,$4,$3)
  ON CONFLICT(meter_id,period) DO UPDATE SET value_thousandths=EXCLUDED.value_thousandths`,
 [readingMeter.id,previousPeriod,seeded.accounts.accountant.id,period]);
 const preview=await accountant.call('/finance/billing/preview','POST',{buildingId,period});
 assert.equal(preview.status,200,JSON.stringify(preview.data));
 const lineFor=(item:any)=>preview.data.charges.find((line:any)=>line.serviceName===item.name);
 const fixedLine=lineFor(fixed),residentLine=lineFor(residents),parkingLine=lineFor(parking),quantityLine=lineFor(quantity);
 const meterLine=lineFor(meter),proratedLine=lineFor(prorated),dailyLine=lineFor(daily),cappedLine=lineFor(capped);
 const roundUpLine=lineFor(roundUp),roundDownLine=lineFor(roundDown),overlapLine=lineFor(overlapping);
 for(const [label,line] of Object.entries({fixedLine,residentLine,parkingLine,quantityLine,meterLine,proratedLine,dailyLine,cappedLine,roundUpLine,roundDownLine,overlapLine}))
  assert.ok(line,`Expected ${label} in preview: ${JSON.stringify(preview.data.exceptions)}`);
 assert.deepEqual(
  [fixedLine.calculationMethod,fixedLine.baseQuantity,fixedLine.rawAmountMinor,fixedLine.roundedAmountMinor],
  ['FIXED_PER_UNIT','1','12345','13000']
 );
 assert.deepEqual(
  [residentLine.calculationMethod,residentLine.baseQuantity,residentLine.rawAmountMinor,residentLine.roundedAmountMinor],
  ['PER_RESIDENT','2','600','600']
 );
 assert.deepEqual(
  [parkingLine.calculationMethod,parkingLine.baseQuantity,parkingLine.rawAmountMinor,parkingLine.roundedAmountMinor],
  ['PER_PARKING_SPACE','2.0000','2500','2500']
 );
 assert.deepEqual(
  [quantityLine.calculationMethod,quantityLine.baseQuantity,quantityLine.rawAmountMinor,quantityLine.roundedAmountMinor],
  ['PER_QUANTITY','3.0000','150','200']
 );
 const meterQuantity=`${2*waterMeters.length}.500`,meterAmount=String(2000*waterMeters.length);
 assert.deepEqual(
  [meterLine.calculationMethod,meterLine.baseQuantity,meterLine.rawAmountMinor,meterLine.roundedAmountMinor],
  ['PER_METER_CONSUMPTION',meterQuantity,meterAmount,meterAmount]
 );
 const proratedScaled=(BigInt(activeDays)*10000n+BigInt(Math.floor(daysInPeriod/2)))/BigInt(daysInPeriod);
 const proratedQuantity=`${proratedScaled/10000n}.${(proratedScaled%10000n).toString().padStart(4,'0')}`;
 const proratedRaw=(3100n*proratedScaled+5000n)/10000n;
 const proratedRounded=((proratedRaw+50n)/100n)*100n;
 assert.deepEqual(
  [proratedLine.calculationMethod,proratedLine.baseQuantity,proratedLine.rawAmountMinor,proratedLine.roundedAmountMinor],
  ['FIXED_PER_UNIT',proratedQuantity,proratedRaw.toString(),proratedRounded.toString()]
 );
 assert.deepEqual(
  [dailyLine.calculationMethod,dailyLine.baseQuantity,dailyLine.rawAmountMinor,dailyLine.roundedAmountMinor],
  ['PER_DAY','10','4000','4000']
 );
 assert.deepEqual(
  [cappedLine.calculationMethod,cappedLine.baseQuantity,cappedLine.rawAmountMinor,cappedLine.roundedAmountMinor],
  ['FIXED_PER_UNIT','1','24890','24000']
 );
 assert.deepEqual(
  [roundUpLine.calculationMethod,roundUpLine.rawAmountMinor,roundUpLine.roundedAmountMinor],
  ['FIXED_PER_UNIT','123','200']
 );
 assert.deepEqual(
  [roundDownLine.calculationMethod,roundDownLine.rawAmountMinor,roundDownLine.roundedAmountMinor],
  ['FIXED_PER_UNIT','177','100']
 );
 assert.ok(preview.data.exceptions.some((x:any)=>x.serviceName===missingQuantity.name&&x.code==='missing_service_quantity'));
 assert.ok(preview.data.exceptions.some((x:any)=>x.serviceName===missingMeter.name&&x.code==='missing_meter_reading'));
 assert.equal(lineFor(missingQuantity),undefined);assert.equal(lineFor(missingMeter),undefined);
 const batch=await accountant.call('/finance/rule-batches','POST',{buildingId,period,key:crypto.randomUUID()});
 assert.equal(batch.status,201,JSON.stringify(batch.data));
 const batchLines=batch.data.snapshot.charges;
 assert.equal(batchLines.find((line:any)=>line.serviceId===overlapping.service.id).ruleId,overlapping.rule.id,
  'the unit rule must take precedence over the higher-priority organization rule');
 const published=await accountant.call(`/finance/batches/${batch.data.id}/publish`,'POST',{
  key:crypto.randomUUID(),version:batch.data.version,acceptWarnings:true
 });
 assert.equal(published.status,200,JSON.stringify(published.data));
 const payerIds=[fixed,residents,parking,quantity,meter,prorated,daily,capped,roundUp,roundDown,overlapping].map(item=>item.payer.id);
 const savedRows=(await pool.query(`SELECT ch.payer_assignment_id,i.id AS invoice_id,il.amount_minor::text,il.calculation_metadata
  FROM charges ch JOIN invoices i ON i.id=ch.invoice_id JOIN invoice_lines il ON il.invoice_id=i.id
  WHERE ch.period=$1 AND ch.payer_assignment_id=ANY($2::uuid[])`,[period,payerIds])).rows;
 const savedByPayer=new Map(savedRows.map(row=>[row.payer_assignment_id,row]));
 const expected=[
  [fixed,fixedLine], [residents,residentLine], [parking,parkingLine], [quantity,quantityLine],
  [meter,meterLine], [prorated,proratedLine], [daily,dailyLine], [capped,cappedLine],
  [roundUp,roundUpLine], [roundDown,roundDownLine], [overlapping,overlapLine]
 ] as const;
 for(const [item,line] of expected){
  const saved=savedByPayer.get(item.payer.id);
  assert.ok(saved,`Expected a saved invoice line for ${item.name}`);
  assert.equal(saved.amount_minor,line.roundedAmountMinor);
  assert.equal(saved.calculation_metadata.method,line.calculationMethod);
  assert.equal(saved.calculation_metadata.ruleId,item===overlapping?overlapping.rule.id:item.rule.id);
  assert.equal(saved.calculation_metadata.tariffId,item.tariff.id);
  assert.equal(saved.calculation_metadata.baseQuantity,line.baseQuantity);
  assert.equal(saved.calculation_metadata.baseUnit,line.baseUnit);
  assert.equal(saved.calculation_metadata.rateMinor,line.rateMinor);
  assert.equal(saved.calculation_metadata.rawAmountMinor,line.rawAmountMinor);
  assert.equal(saved.calculation_metadata.roundedAmountMinor,line.roundedAmountMinor);
  assert.equal(saved.calculation_metadata.roundingMode,item===roundUp?'ROUND_UP_AMD':item===roundDown?'ROUND_DOWN_AMD':'NEAREST_AMD');
 }
 assert.equal(fixedLine.roundedAmountMinor,'13000','minimum amount applies after rounding');
 assert.equal(cappedLine.roundedAmountMinor,'24000','maximum amount caps the rounded result');
 const proratedSnapshotLine=batchLines.find((line:any)=>line.serviceId===prorated.service.id);
 const dailySnapshotLine=batchLines.find((line:any)=>line.serviceId===daily.service.id);
 assert.equal(proratedSnapshotLine.unproratedQuantity,'1');
 assert.equal(proratedSnapshotLine.prorationDays,activeDays);
 assert.equal(dailySnapshotLine.baseQuantity,'10');
 assert.equal(dailySnapshotLine.prorationDays,activeDays);
 assert.equal(savedByPayer.get(prorated.payer.id)?.calculation_metadata.unproratedQuantity,'1');
 assert.equal(savedByPayer.get(prorated.payer.id)?.calculation_metadata.prorationDays,activeDays);
 assert.equal(savedByPayer.get(daily.payer.id)?.calculation_metadata.prorationDays,activeDays);
 assert.equal(savedByPayer.get(overlapping.payer.id)?.calculation_metadata.ruleId,overlapping.rule.id);
 assert.ok(higherLevelRule.id!==overlapping.rule.id);

 const nextDate=new Date(Date.UTC(Number(period.slice(0,4)),Number(period.slice(5,7)),1));
 nextDate.setUTCMonth(nextDate.getUTCMonth()+1);
 const nextPeriod=nextDate.toISOString().slice(0,10),changeFrom=`${nextPeriod.slice(0,7)}-15`;
 const changingResident=await createCase('Resident change','PER_RESIDENT','500',{
  occupancyCountMode:'AUTO_ACTIVE_RESIDENTS',validFrom:nextPeriod,rateUnit:'AMD/resident'
 });
 const nextParameters=await accountant.call(`/properties/${unit}/billing-parameters`,'PATCH',{
  effectiveFrom:nextPeriod,billingArea:null,residentCountMode:'AUTO_ACTIVE_RESIDENTS',billingResidentCount:null,
  occupancyStatus:'OCCUPIED',reason:'Start the resident-change boundary fixture',
  residents:[ownerAssignment,familyAssignment].map(assignmentId=>({assignmentId,residesHere:true,countsForBilling:true})),
  serviceQuantities:[],serviceApplicability:[]
 });
 assert.equal(nextParameters.status,200,JSON.stringify(nextParameters.data));
 await pool.query(`UPDATE unit_billing_resident_eligibility SET effective_until=$3::date-1
  WHERE organization_id=$1 AND unit_id=$2 AND role_assignment_id=ANY($4::uuid[]) AND effective_from=$5::date`,
 [organizationId,unit,changeFrom,[ownerAssignment,familyAssignment],nextPeriod]);
 const renterAssignment=(await pool.query("SELECT id FROM role_assignments WHERE user_id=$1 AND unit_id=$2 AND role_key='renter' AND active",
  [seeded.accounts.renter.id,unit])).rows[0].id;
 await pool.query('UPDATE role_assignments SET starts_at=$2::date,expires_at=NULL WHERE id=$1',[renterAssignment,nextPeriod]);
 await pool.query(`INSERT INTO unit_billing_resident_eligibility(organization_id,unit_id,role_assignment_id,resides_here,
  counts_for_billing,effective_from,reason,changed_by) VALUES($1,$2,$3,true,true,$4,'Resident enters during billing period',$5)`,
 [organizationId,unit,renterAssignment,changeFrom,seeded.accounts.accountant.id]);
 const residentChangePreview=await accountant.call('/finance/billing/preview','POST',{buildingId,period:nextPeriod});
 assert.equal(residentChangePreview.status,200,JSON.stringify(residentChangePreview.data));
 assert.ok(residentChangePreview.data.exceptions.some((x:any)=>
  x.serviceName===changingResident.name&&x.code==='resident_eligibility_changed_mid_period'));
 assert.equal(residentChangePreview.data.charges.some((line:any)=>line.serviceName===changingResident.name),false,
  'a mid-period resident change must be reviewed rather than silently prorated');
 });
test('Defect assigned contractor cannot self-accept; return and acceptance use separate accounts',async()=>{
 const d=await developer.call('/defects','POST',{unitId:seeded.fixtures.ua,subject:'Window repair',location:'Kitchen',description:'Seal needs repair',contractorId:seeded.accounts.contractor.id,dueOn:'2026-12-01'});assert.equal(d.status,201);const path='/defects/'+d.data.id;
 assert.equal((await family.call(path)).status,403);assert.equal((await other.call(path)).status,403);
 assert.equal((await contractor.call(path+'/transition','POST',{action:'start',version:1})).status,200);assert.equal((await contractor.call(path+'/transition','POST',{action:'report',version:2,note:'Window seal repaired'})).status,200);
 assert.equal((await contractor.call(path+'/transition','POST',{action:'accept',version:3})).status,403);assert.equal((await developer.call(path+'/transition','POST',{action:'return',version:3,note:'Please check again'})).status,200);assert.equal((await contractor.call(path+'/transition','POST',{action:'report',version:4,note:'Rechecked and repaired'})).status,200);assert.equal((await developer.call(path+'/transition','POST',{action:'accept',version:5})).status,200);assert.equal((await developer.call(path)).data.history.length,5);
});
test('Pass verification, single entry, exit, revocation and expiry are checked on server',async()=>{
 const make=()=>owner.call('/passes','POST',{unitId:seeded.fixtures.ua,visitor:'Test Visitor',validFrom:new Date(Date.now()-1000).toISOString(),validUntil:new Date(Date.now()+3600000).toISOString()});
 const p=await make();assert.equal(p.status,201);assert.equal(p.data.token.length,64);assert.equal((await guard.call('/passes/validate','POST',{token:p.data.token})).data.valid,true);assert.equal((await family.call('/passes')).status,403);
 const path='/passes/'+p.data.id;assert.equal((await guard.call(path+'/events','POST',{direction:'entry'})).status,201);assert.equal((await guard.call(path+'/events','POST',{direction:'entry'})).status,409);assert.equal((await guard.call(path+'/events','POST',{direction:'exit'})).status,201);assert.equal((await guard.call('/passes/validate','POST',{token:p.data.token})).data.valid,false);
 const revoked=await make();await owner.call('/passes/'+revoked.data.id+'/revoke','POST',{});assert.equal((await guard.call('/passes/'+revoked.data.id+'/events','POST',{direction:'entry'})).status,409);
 const expired=await make();await pool.query("UPDATE visitor_passes SET valid_from=now()-interval '2 hours',valid_until=now()-interval '1 hour' WHERE id=$1",[expired.data.id]);assert.equal((await guard.call('/passes/validate','POST',{token:expired.data.token})).data.valid,false);
});
test('Support grant requires organization approval and expires without granting finance or write access',async()=>{
 const g=await support.call('/support/grants','POST',{organizationId:seeded.fixtures.orgA,reason:'Diagnose property setup',permissions:['properties.read'],hours:1});assert.equal(g.status,201);assert.equal((await support.call('/support/grants/'+g.data.id+'/approve','POST',{})).status,403);assert.equal((await other.call('/support/grants/'+g.data.id+'/approve','POST',{})).status,404);assert.equal((await org.call('/support/grants/'+g.data.id+'/approve','POST',{})).status,200);
 assert.equal((await support.call('/auth/context','POST',{id:g.data.id})).status,200);assert.equal((await support.call('/properties')).status,200);assert.equal((await support.call('/finance')).status,403);assert.equal((await support.call('/properties','POST',{name:'Forbidden',address:'Forbidden'})).status,403);
 await pool.query("UPDATE support_access_grants SET expires_at=now()-interval '1 second' WHERE id=$1",[g.data.id]);assert.equal((await support.call('/properties')).status,403);
});
test('Owner delegation gives selected services only; owner revocation removes direct API access',async()=>{
 const d=await owner.call('/delegations','POST',{email:'delegated-'+randomBytes(6).toString('hex')+'@vernatun.test',expiresAt:new Date(Date.now()+86400000).toISOString(),permissions:['requests.own','requests.create']});assert.equal(d.status,201);const token=new URL(d.data.url).searchParams.get('token');const invitee=new Client();await invitee.call('/auth/session');const password=randomBytes(20).toString('hex');assert.equal((await invitee.call('/auth/accept-invitation','POST',{token,name:'Delegated Resident',password})).status,200);const email=(await pool.query('SELECT email FROM invitations WHERE delegation_id=$1',[d.data.id])).rows[0].email;assert.equal((await invitee.call('/auth/login','POST',{email,password})).status,200);assert.equal((await invitee.call('/requests')).status,200);assert.equal((await invitee.call('/invoices')).status,403);assert.equal((await invitee.call('/passes')).status,403);assert.equal((await owner.call('/delegations/'+d.data.id+'/revoke','POST',{})).status,200);assert.equal((await invitee.call('/requests')).status,403);
});

test('MFA requires second factor, consumes recovery codes once and uses shared rate storage',async()=>{
 const account=seeded.accounts.org_admin;await pool.query('DELETE FROM mfa_credentials WHERE user_id=$1',[account.id]);
 try{const setup=await org.call('/mfa/setup','POST',{password:account.password});assert.equal(setup.status,200);const code=authenticator.generate(setup.data.secret);const enabled=await org.call('/mfa/enable','POST',{code});assert.equal(enabled.status,200);assert.equal(enabled.data.recoveryCodes.length,10);
 const fresh=new Client();await fresh.call('/auth/session');assert.equal((await fresh.call('/auth/login','POST',{email:account.email,password:account.password})).data.error,'mfa_required');assert.equal((await fresh.call('/auth/login','POST',{email:account.email,password:account.password,code:enabled.data.recoveryCodes[0]})).status,200);
 const duplicate=new Client();await duplicate.call('/auth/session');assert.equal((await duplicate.call('/auth/login','POST',{email:account.email,password:account.password,code:enabled.data.recoveryCodes[0]})).status,401);assert.ok((await pool.query('SELECT count(*)::int AS n FROM auth_rate_limits')).rows[0].n>0);
 assert.equal((await fresh.call('/mfa/disable','POST',{password:account.password,code:enabled.data.recoveryCodes[1]})).status,200);
 }finally{await pool.query('DELETE FROM mfa_credentials WHERE user_id=$1',[account.id])}
});
