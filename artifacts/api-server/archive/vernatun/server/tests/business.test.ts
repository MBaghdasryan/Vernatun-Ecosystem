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
 const charge=preview.data.charges.find((line:any)=>line.serviceId===service.data.id);
 assert.ok(charge);
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
 assert.equal((await family.call(`/finance/invoices/${stored.id}/details`)).status,404);
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
