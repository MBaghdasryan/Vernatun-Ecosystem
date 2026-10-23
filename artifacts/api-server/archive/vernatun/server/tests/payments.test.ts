import {checkAmeriaConnection} from '../payments/ameriabank-connection.js';
import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {app} from '../app.js';
import {pool} from '../db.js';
import {config} from '../config.js';
import {installTestPaymentProvider,clearTestPaymentProviders,type PaymentProvider,type PaymentEvidence} from '../payments/providers.js';
if(config.NODE_ENV!=='test'||!new URL(config.DATABASE_URL).pathname.endsWith('/vernatun_test'))throw Error('Isolated test DB required');
const seeded=JSON.parse(await readFile('.local/test/demo-accounts.json','utf8'));
const server=app.listen(0,'127.0.0.1');let base='';
class Client{
 cookie='';csrf='';c:any;
 async call(path:string,method='GET',body?:unknown){
  const r=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',Cookie:this.cookie,'X-CSRF-Token':this.csrf},
   ...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(r.headers.getSetCookie().length)this.cookie=r.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
  const data=r.status===204?null:await r.json();if(data?.csrf)this.csrf=data.csrf;return {status:r.status,data};
 }
 async login(role:string){
  const a=seeded.accounts[role];await this.call('/auth/session');
  const r=await this.call('/auth/login','POST',{email:a.email,password:a.password});assert.equal(r.status,200);
  this.c=r.data.contexts.find((x:any)=>x.role_key===a.role);
  assert.equal((await this.call('/auth/context','POST',{id:this.c.id})).status,200);return this;
 }
}
class MockPaymentProvider implements PaymentProvider{
 readonly checkoutOrigins=['https://payments.test.invalid'];
 state:PaymentEvidence['status']='succeeded';mismatch?:'amount'|'merchant'|'currency'|'order';timeout=false;calls=0;
 orders=new Map<string,Parameters<PaymentProvider['initializePayment']>[0]>();
 constructor(readonly domain:'property'|'platform',readonly merchantIdentity:string){}
 getCapabilities(){return ['initialize','status']}
 async healthCheck(){return 'transaction_test_required' as const}
 async initializePayment(input:Parameters<PaymentProvider['initializePayment']>[0]){
  this.calls++;this.orders.set(input.orderId,input);
  if(this.timeout)throw Error('synthetic timeout after provider accepted order');
  return {providerPaymentId:'mock-'+input.orderId,redirectUrl:'https://payments.test.invalid/'+input.orderId};
 }
 async getPaymentStatus(input:Parameters<PaymentProvider['getPaymentStatus']>[0]):Promise<PaymentEvidence>{
  const o=this.orders.get(input.orderId)!;
  return {status:this.state,providerPaymentId:'mock-'+input.orderId,externalTransactionId:'tx-'+input.orderId,
   orderId:this.mismatch==='order'?'999999999':input.orderId,merchantIdentity:this.mismatch==='merchant'?'OTHER-MERCHANT':this.merchantIdentity,
   amountMinor:this.mismatch==='amount'?'1':o.amountMinor,currency:this.mismatch==='currency'?'USD':o.currency};
 }
}
let owner:Client,family:Client,accountant:Client,admin:Client,orgAdmin:Client,org:string,unit:string,orgB:string,instanceA:string,instanceB:string;
before(async()=>{
 await pool.query('DELETE FROM auth_rate_limits');
 await new Promise<void>(r=>server.listening?r():server.on('listening',r));base='http://127.0.0.1:'+(server.address() as {port:number}).port;
 owner=await new Client().login('unit_owner');family=await new Client().login('family');
 accountant=await new Client().login('accountant');admin=await new Client().login('platform_admin');orgAdmin=await new Client().login('org_admin');
 org=owner.c.organization_id;unit=owner.c.unit_id;
 orgB=(await pool.query('SELECT id FROM organizations WHERE id<>$1 ORDER BY id LIMIT 1',[org])).rows[0].id;
});
beforeEach(async()=>{await pool.query('DELETE FROM auth_rate_limits')});
after(async()=>{clearTestPaymentProviders();server.close();server.closeAllConnections();await pool.end()});
async function invoice(amount='26000'){
 const i=(await pool.query(`INSERT INTO invoices(organization_id,unit_id,payer_user_id,period,amount_minor,currency,status,created_by)
  VALUES($1,$2,$3,'2026-10-01',$4,'AMD','draft',$3) RETURNING id`,[org,unit,seeded.accounts.unit_owner.id,amount])).rows[0];
 await pool.query(`INSERT INTO invoice_lines(invoice_id,description,quantity_hundredths,rate_minor,amount_minor) VALUES($1,'Payment test',100,$2,$2)`,[i.id,amount]);
 await pool.query("UPDATE invoices SET status='published',published_by=$2,published_at=now() WHERE id=$1",[i.id,seeded.accounts.accountant.id]);
 return i.id as string;
}
async function attachMock(){
 const mock=new MockPaymentProvider('property','organization-A');
 await pool.query("UPDATE payment_provider_instances SET enabled=true,status='sandbox' WHERE id=$1",[instanceA]);
 installTestPaymentProvider(instanceA,mock);return mock;
}
test('unconfigured rails fail closed; browser and utility availability never invent money',async()=>{
 assert.equal((await new Client().call('/payments/workspace')).status,401);
 const w=await owner.call('/payments/workspace');assert.equal(w.status,200);
 assert.equal(w.data.readiness.onlineAvailable,false);assert.equal(w.data.readiness.status,'not_configured');
 const i=await invoice();
 const r=await owner.call('/payments/intents','POST',{domain:'property',invoiceIds:[i],key:randomUUID()});
 assert.equal(r.status,409);assert.equal(r.data.error,'payment_provider_not_configured');
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM payment_intents')).rows[0].n,0);
 const u=await owner.call('/utilities/workspace');assert.equal(u.status,200);assert.equal(u.data.status,'CONTRACT_REQUIRED');
 assert.deepEqual(u.data.capabilities,[]);assert.deepEqual(u.data.catalog,[]);assert.equal(u.data.balanceState,'unavailable');
 assert.equal((await family.call('/utilities/workspace')).status,403);
 assert.equal((await admin.call('/utilities/workspace')).status,403);
 const cb=await fetch(base+'/api/payments/callbacks/arca',{method:'POST',body:'{"status":"succeeded"}'});
 assert.equal(cb.status,409);
});
test('provider drafts are scoped, revisioned, secret-free and not fake connected',async()=>{
 const a=await orgAdmin.call('/payments/provider-instances','POST',{providerCode:'arca',environment:'sandbox'});
 assert.equal(a.status,201,JSON.stringify(a.data));instanceA=a.data.id;
 assert.equal(a.data.enabled,false);assert.equal(a.data.credentials_configured,false);
 assert.equal((await accountant.call('/payments/provider-instances','POST',{providerCode:'arca',environment:'sandbox'})).status,403);
 assert.equal((await admin.call('/payments/provider-instances','POST',{providerCode:'arca',environment:'sandbox'})).status,403);
 assert.equal((await orgAdmin.call('/payments/provider-instances','POST',{providerCode:'ameriabank',environment:'sandbox'})).status,403);
 assert.equal((await admin.call('/payments/provider-instances','POST',{providerCode:'telcell',environment:'sandbox'})).data.error,'utility_contract_scope_required');
 assert.equal((await orgAdmin.call('/payments/provider-instances','POST',{providerCode:'arca',environment:'sandbox',enabled:true})).status,400);
 assert.equal((await orgAdmin.call('/payments/provider-instances','POST',{providerCode:'arca',environment:'sandbox',revision:99})).status,409);
 const check=await orgAdmin.call('/payments/provider-instances/'+instanceA+'/test','POST',{});
 assert.equal(check.data.onlineAvailable,false);assert.equal(check.data.status,'contract_required');
 instanceB=(await pool.query(`INSERT INTO payment_provider_instances(provider_code,provider_type,payment_domain,scope_type,organization_id,environment)
 VALUES('arca','PROPERTY_PAYMENT','property','organization',$1,'sandbox') RETURNING id`,[orgB])).rows[0].id;
 assert.equal((await orgAdmin.call('/payments/provider-instances/'+instanceB+'/test','POST',{})).status,404);
 const p=await admin.call('/payments/provider-instances','POST',{providerCode:'ameriabank',environment:'sandbox',
  credentials:{clientId:'synthetic-client',username:'synthetic-user',password:'synthetic-test-only'}});
 assert.equal(p.status,201);assert.equal(p.data.credentials_configured,true);
 assert.ok(!JSON.stringify(p.data).includes('synthetic-'));
 const stored=(await pool.query('SELECT encrypted_credentials FROM payment_provider_instances WHERE id=$1',[p.data.id])).rows[0];
 assert.ok(!JSON.stringify(stored).includes('synthetic-'));
 assert.equal((await owner.call('/payments/provider-instances/'+p.data.id+'/test','POST',{})).status,404);
});
test('Ameriabank connection check uses only read-only bank API and never returns card data',async()=>{
 const credentials={clientId:'synthetic-client',username:'synthetic-user',password:'synthetic-secret'};
 const requests:{url:string;body:any}[]=[];
 const transport=(async(url:any,init:any)=>{
  requests.push({url:String(url),body:JSON.parse(init.body)});
  assert.equal(init.redirect,'error');assert.ok(init.signal);
  return new Response(JSON.stringify({ResponseCode:'00',CardBindingFileds:[{CardPan:'PRIVATE_CARD_DATA'}]}),
   {headers:{'Content-Type':'application/json'}});
 }) as typeof fetch;
 for(const environment of ['sandbox','production'] as const){
  const result=await checkAmeriaConnection(credentials,environment,transport);
  assert.equal(result.status,'connected');assert.equal(result.onlineAvailable,false);
  assert.ok(!JSON.stringify(result).includes('PRIVATE_CARD_DATA'));
 }
 assert.deepEqual(requests.map(r=>r.url),[
  'https://servicestest.ameriabank.am/VPOS/api/VPOS/GetBindings',
  'https://services.ameriabank.am/VPOS/api/VPOS/GetBindings']);
 assert.deepEqual(requests[0].body,{ClientID:credentials.clientId,Username:credentials.username,Password:credentials.password,PaymentType:5});
 for(const [body,reason] of [
  [{ResponseCode:'20',ResponseMessage:'sensitive upstream message'},'authentication_rejected'],
  [{ResponseCode:'500'},'bank_rejected_connection_check'],
  [{CardBindingFileds:[]},'invalid_bank_response'],
 ] as const){
  const r=await checkAmeriaConnection(credentials,'sandbox',(async()=>new Response(JSON.stringify(body),
   {headers:{'Content-Type':'application/json'}})) as typeof fetch);
  assert.equal(r.status,'failed');assert.equal(r.reason,reason);
  assert.ok(!JSON.stringify(r).includes('sensitive'));
 }
 const offline=await checkAmeriaConnection(credentials,'sandbox',(async()=>{throw new Error('SECRET')}) as typeof fetch);
 assert.equal(offline.reason,'bank_unreachable_or_invalid_response');assert.ok(!JSON.stringify(offline).includes('SECRET'));
 assert.equal((await checkAmeriaConnection(credentials,'sandbox',(async()=>new Response('<html/>',
  {headers:{'Content-Type':'text/html'}})) as typeof fetch)).reason,'invalid_bank_response');
 assert.equal((await checkAmeriaConnection({},'sandbox',transport)).reason,'invalid_saved_credentials');
 assert.equal(requests.length,2);
});
test('admin tests saved encrypted Ameriabank credentials without enabling payments, throttled and audited',async()=>{
 const i=(await pool.query("SELECT id FROM payment_provider_instances WHERE provider_code='ameriabank' AND environment='sandbox'")).rows[0];
 const original=globalThis.fetch;let bankCalls=0;
 globalThis.fetch=(async(input:any,init:any)=>{
  if(String(input)==='https://servicestest.ameriabank.am/VPOS/api/VPOS/GetBindings'){
   bankCalls++;assert.equal(JSON.parse(init.body).ClientID,'synthetic-client');
   return new Response('{"ResponseCode":"00","CardBindingFileds":[{"CardPan":"DO_NOT_PERSIST"}]}',
    {headers:{'Content-Type':'application/json'}});
  }return original(input,init);
 }) as typeof fetch;
 try{
  assert.equal((await orgAdmin.call('/payments/provider-instances/'+i.id+'/test','POST',{})).status,404);
  const tested=await admin.call('/payments/provider-instances/'+i.id+'/test','POST',{});
  assert.equal(tested.status,200,JSON.stringify(tested.data));assert.equal(tested.data.status,'connected');
  assert.equal(tested.data.onlineAvailable,false);assert.equal(bankCalls,1);
  assert.equal((await admin.call('/payments/provider-instances/'+i.id+'/test','POST',{})).status,409);
  assert.equal(bankCalls,1);
  const stored=(await pool.query('SELECT enabled,status,last_success_at,last_error FROM payment_provider_instances WHERE id=$1',[i.id])).rows[0];
  assert.equal(stored.enabled,false);assert.equal(stored.status,'contract_required');assert.ok(stored.last_success_at);
  assert.equal(stored.last_error,null);
  const w=await admin.call('/payments/workspace');assert.equal(w.data.readiness.onlineAvailable,false);
  assert.ok(w.data.instances.find((row:any)=>row.id===i.id).last_success_at);
  assert.ok(!JSON.stringify(w.data).includes('DO_NOT_PERSIST'));
 }finally{globalThis.fetch=original}
});
test('database rejects cross-organization merchant routing and platform fallback',async()=>{
 const i=await invoice();
 for(const provider of [instanceB,(await pool.query("SELECT id FROM payment_provider_instances WHERE provider_code='ameriabank'")).rows[0].id]){
  await assert.rejects(pool.query(`INSERT INTO payment_intents(payment_domain,organization_id,unit_id,payer_user_id,provider_instance_id,amount_minor,currency,description)
   VALUES('property',$1,$2,$3,$4,26000,'AMD','invalid merchant')`,[org,unit,seeded.accounts.unit_owner.id,provider]),/merchant scope mismatch/);
 }
 const body={domain:'property',invoiceIds:[i],key:randomUUID(),providerInstanceId:instanceB};
 assert.equal((await owner.call('/payments/intents','POST',body)).status,400);
});
test('property confirmation is atomic, scoped, idempotent and does not trust browser status',async()=>{
 const mock=await attachMock(),i=await invoice(),body={domain:'property',invoiceIds:[i],key:randomUUID()};
 const first=await owner.call('/payments/intents','POST',body);assert.equal(first.status,201,JSON.stringify(first.data));
 assert.equal(first.data.status,'requires_action');const id=first.data.id;
 assert.equal((await owner.call('/payments/intents','POST',body)).data.id,id);assert.equal(mock.calls,1);
 assert.equal((await owner.call('/payments/intents','POST',{...body,key:randomUUID()})).data.error,'payment_already_in_progress');
 assert.equal((await owner.call('/payments/intents/'+id+'/verify','POST',{status:'succeeded'})).status,400);
 assert.equal((await admin.call('/payments/intents/'+id)).status,404);
 const results=await Promise.all([owner.call('/payments/intents/'+id+'/verify','POST',{}),owner.call('/payments/intents/'+id+'/verify','POST',{})]);
 assert.ok(results.every(r=>r.status===200),JSON.stringify(results));assert.equal(results[0].data.status,'succeeded');
 const t=(await pool.query('SELECT * FROM payment_transactions WHERE payment_intent_id=$1',[id])).rows;assert.equal(t.length,1);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM payment_allocations WHERE payment_id=$1',[t[0].property_payment_id])).rows[0].n,1);
 assert.equal((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE entity_id=$1 AND action='payment.succeeded'",[id])).rows[0].n,1);
 assert.equal((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action='allocation.created' AND details->>'intentId'=$1",[id])).rows[0].n,1);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM notifications WHERE dedupe_key=$1',['payment.received:'+id])).rows[0].n,1);
 assert.equal((await owner.call('/payments/intents/'+id)).data.allocations[0].amount_minor,'26000');
 await assert.rejects(pool.query("UPDATE payment_transactions SET amount_minor=1 WHERE id=$1",[t[0].id]),/append-only/);
});
test('wrong amount, merchant, order and currency never post a successful payment',async()=>{
 for(const mismatch of ['amount','merchant','order','currency'] as const){
  const mock=await attachMock(),i=await invoice();mock.mismatch=mismatch;
  const r=await owner.call('/payments/intents','POST',{domain:'property',invoiceIds:[i],key:randomUUID()});assert.equal(r.status,201);
  assert.equal((await owner.call('/payments/intents/'+r.data.id+'/verify','POST',{})).data.error,'provider_evidence_mismatch');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM payment_transactions WHERE payment_intent_id=$1',[r.data.id])).rows[0].n,0);
 }
});
test('timeout retains an unknown outcome and the same provider order on retry',async()=>{
 const mock=await attachMock();mock.timeout=true;const i=await invoice(),body={domain:'property',invoiceIds:[i],key:randomUUID()};
 const r=await owner.call('/payments/intents','POST',body);assert.equal(r.status,201);assert.equal(r.data.status,'processing');
 assert.equal((await owner.call('/payments/intents','POST',body)).data.id,r.data.id);assert.equal(mock.calls,1);
 mock.timeout=false;
 assert.equal((await owner.call('/payments/intents/'+r.data.id+'/verify','POST',{})).data.status,'succeeded');
});
test('concurrent invoice payment leaves the verified online surplus as existing account credit',async()=>{
 await attachMock();const i=await invoice(),r=await owner.call('/payments/intents','POST',{domain:'property',invoiceIds:[i],key:randomUUID()});
 const manual=await accountant.call('/finance/payments','POST',{invoiceId:i,amountMinor:'6000',source:'manual_bank',reference:'manual-'+randomUUID()});assert.equal(manual.status,201);
 assert.equal((await owner.call('/payments/intents/'+r.data.id+'/verify','POST',{})).data.status,'succeeded');
 const t=(await pool.query('SELECT property_payment_id FROM payment_transactions WHERE payment_intent_id=$1',[r.data.id])).rows[0];
 const credit=(await owner.call('/finance/credits')).data.find((x:any)=>x.id===t.property_payment_id);assert.equal(credit.credit_minor,'6000');
 const target=await invoice('6000');
 const allocation=await accountant.call('/finance/credits/'+t.property_payment_id+'/allocate','POST',{key:randomUUID(),allocations:[{invoiceId:target,amountMinor:'6000'}]});
 assert.equal(allocation.status,200,JSON.stringify(allocation.data));assert.equal(allocation.data.creditMinor,'0');
});
test('platform invoice derives plan amount, cannot use ArCa, and activates only an in-date subscription',async()=>{
 const plan=(await pool.query("INSERT INTO subscription_plans(name,amount_minor,currency,building_limit) VALUES('Payments synthetic plan',120000,'AMD',100) RETURNING *")).rows[0];
 const s=(await pool.query(`INSERT INTO subscriptions(organization_id,plan_id,starts_on,ends_on,status,created_by)
  VALUES($1,$2,'2026-01-01','2027-12-31','past_due',$3) RETURNING id`,[org,plan.id,seeded.accounts.platform_admin.id])).rows[0];
 const body={subscriptionId:s.id,period:'2026-10',dueOn:'2026-10-31',key:randomUUID()};
 const issued=await admin.call('/payments/platform-invoices','POST',body);assert.equal(issued.status,201,JSON.stringify(issued.data));
 assert.equal(issued.data.amount_minor,String(plan.amount_minor));assert.equal((await admin.call('/payments/platform-invoices','POST',body)).data.id,issued.data.id);
 assert.equal((await admin.call('/payments/platform-invoices','POST',{...body,key:randomUUID(),amountMinor:'1'})).status,400);
 const instance=(await pool.query("SELECT id FROM payment_provider_instances WHERE provider_code='ameriabank'")).rows[0];
 await pool.query("UPDATE payment_provider_instances SET enabled=true,status='sandbox' WHERE id=$1",[instance.id]);
 const mock=new MockPaymentProvider('platform','Vernatun');installTestPaymentProvider(instance.id,mock);
 // Organization subscription payment stays available while past_due restricts normal writes.
 await pool.query('UPDATE organizations SET subscription_enforced=true WHERE id=$1',[org]);
 assert.equal((await orgAdmin.call('/payments/provider-instances','POST',{providerCode:'arca',environment:'production'})).data.error,'subscription_restricted');
 const intent=await orgAdmin.call('/payments/intents','POST',{domain:'platform',platformInvoiceId:issued.data.id,key:randomUUID()});assert.equal(intent.status,201,JSON.stringify(intent.data));
 assert.equal((await admin.call('/payments/intents/'+intent.data.id+'/verify','POST',{})).data.status,'succeeded');
 assert.equal((await pool.query('SELECT status FROM platform_invoices WHERE id=$1',[issued.data.id])).rows[0].status,'paid');
 assert.equal((await pool.query('SELECT status FROM subscriptions WHERE id=$1',[s.id])).rows[0].status,'active');
 const workspace=(await admin.call('/payments/workspace')).data;
 assert.ok(workspace.intents.every((i:any)=>i.payment_domain==='platform'));
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM payments WHERE reference=$1',['intent:'+intent.data.id])).rows[0].n,0);
});
