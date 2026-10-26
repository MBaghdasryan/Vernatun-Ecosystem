import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool} from '../db.js';
type Client={call(path:string,method?:string,body?:unknown):Promise<{status:number;data:any}>};
type Fixture={owner:Client;family:Client;admin:Client;accountant:()=>Promise<Client>;buildingId:string;query:string;seed:{accounts:Record<string,{id:string}>}};
export function registerPayerResponsibilityTests(get:()=>Fixture){
 let serviceId:string,tariffId:string,payerId:string,unitId:string,orgId:string,next:string;
 let policyVersion=0,accepted:any,accountant:Client;
 const month=(offset:number)=>{const d=new Date(next+'T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+offset);return d.toISOString().slice(0,10)};
 const calculate=(p:string)=>accountant.call('/finance/calculate','POST',{payerAssignmentId:payerId,tariffId,period:p});
 const create=(startsOn:string,endsOn?:string)=>get().owner.call('/resident/payer-responsibilities','POST',{
  payerAssignmentId:payerId,recipientId:get().seed.accounts.family.id,startsOn,...(endsOn?{endsOn}:{}),clientId:randomUUID()});
 const review=(c:Client,r:any,action:string)=>c.call('/resident/payer-responsibilities/'+r.id,'PUT',{action,version:r.version});
 const effective=async(p:string)=>(await pool.query('SELECT resident_effective_payer($1,$2::date) AS id',[payerId,p])).rows[0].id;
 async function policy(enabled:boolean){
  const f=get(),r=await f.admin.call('/resident/payer-policy/'+serviceId+f.query,'PUT',{enabled,version:policyVersion});
  assert.equal(r.status,200,JSON.stringify(r.data));policyVersion=r.data.version;
 }
 test('future payer consent is recipient-only, opt-in, scoped, replay-safe and never rewrites history',async()=>{
  const f=get();accountant=await f.accountant();
  unitId=(await f.owner.call('/resident/household')).data.unitId;
  orgId=(await pool.query('SELECT organization_id FROM units WHERE id=$1',[unitId])).rows[0].organization_id;
  serviceId=(await pool.query("INSERT INTO services(organization_id,name) VALUES($1,'Responsibility acceptance fee') RETURNING id",[orgId])).rows[0].id;
  tariffId=(await pool.query("INSERT INTO tariffs(organization_id,service_id,amount_minor,currency,basis) VALUES($1,$2,10000,'AMD','unit') RETURNING id",[orgId,serviceId])).rows[0].id;
  payerId=(await pool.query("INSERT INTO payer_assignments(organization_id,unit_id,payer_user_id,service_id,starts_on) VALUES($1,$2,$3,$4,'2000-01-01') RETURNING id",[orgId,unitId,f.seed.accounts.unit_owner.id,serviceId])).rows[0].id;
  next=(await f.owner.call('/resident/payer-responsibilities')).data.nextPeriod;
  const before=await calculate(month(-1));assert.equal(before.status,201,JSON.stringify(before.data));
  assert.equal((await create(next)).status,409); // default deny
  assert.equal((await f.family.call('/resident/payer-policy/'+serviceId+f.query,'PUT',{enabled:true,version:0})).status,403);
  await policy(true);
  assert.equal((await f.admin.call('/resident/payer-policy/'+serviceId+f.query,'PUT',{enabled:false,version:0})).status,409);
  const workspace=(await f.owner.call('/resident/payer-responsibilities')).data;
  assert.ok(workspace.recipients.some((r:any)=>r.id===f.seed.accounts.family.id));
  const body={payerAssignmentId:payerId,recipientId:f.seed.accounts.family.id,startsOn:next,clientId:randomUUID()};
  const proposed=await f.owner.call('/resident/payer-responsibilities','POST',body);
  assert.equal(proposed.status,201,JSON.stringify(proposed.data));
  assert.equal(proposed.data.status,'pending');assert.equal(await effective(next),f.seed.accounts.unit_owner.id);
  const replay=await f.owner.call('/resident/payer-responsibilities','POST',body);assert.equal(replay.data.id,proposed.data.id);
  assert.equal((await f.owner.call('/resident/payer-responsibilities','POST',{...body,recipientId:randomUUID()})).status,409);
  assert.equal((await review(f.owner,proposed.data,'accept')).status,403);
  assert.equal((await f.family.call('/resident/payer-responsibilities','POST',{...body,clientId:randomUUID()})).status,403);
  assert.equal((await f.owner.call('/resident/payer-responsibilities?buildingId='+randomUUID())).status,403);
  const consent=await review(f.family,proposed.data,'accept');assert.equal(consent.status,200,JSON.stringify(consent.data));accepted=consent.data;
  assert.equal((await review(f.family,proposed.data,'accept')).data.version,accepted.version);
  assert.equal(await effective(next),f.seed.accounts.family.id);
  const invoice=await calculate(next);assert.equal(invoice.status,201,JSON.stringify(invoice.data));
  assert.equal(invoice.data.payer_user_id,f.seed.accounts.family.id);
  assert.equal((await calculate(next)).data.id,invoice.data.id);
  assert.equal((await pool.query('SELECT payer_delegation_id FROM charges WHERE invoice_id=$1',[invoice.data.id])).rows[0].payer_delegation_id,accepted.id);
  // Fixture publication only: invoice publishing itself is covered by finance suites.
  await pool.query("UPDATE invoices SET status='published',published_at=now(),published_by=$2 WHERE id=$1",[invoice.data.id,f.seed.accounts.accountant.id]);
  assert.ok((await f.family.call('/resident/payer-responsibilities')).data.invoices.some((r:any)=>r.id===invoice.data.id));
  assert.ok(!(await f.owner.call('/resident/payer-responsibilities')).data.invoices.some((r:any)=>r.id===invoice.data.id));
  const revoked=await review(f.owner,accepted,'revoke');assert.equal(revoked.status,200);
  assert.equal(await effective(month(1)),f.seed.accounts.unit_owner.id);
  const unchanged=(await pool.query('SELECT payer_user_id FROM payer_assignments WHERE id=$1',[payerId])).rows[0];
  assert.equal(unchanged.payer_user_id,f.seed.accounts.unit_owner.id);
  const history=(await pool.query('SELECT payer_user_id FROM invoices WHERE id=ANY($1::uuid[]) ORDER BY id',[[before.data.id,invoice.data.id]])).rows;
  assert.deepEqual(history.map(r=>r.payer_user_id).sort(),[f.seed.accounts.unit_owner.id,f.seed.accounts.family.id].sort());
  assert.equal((await create(next)).status,409); // includes already-created draft/published charges
 });
 test('payer consent invalidates batch previews, respects eligibility and blocks already-created future bills',async()=>{
  const f=get(),p=month(2),pending=await create(p,p);assert.equal(pending.status,201,JSON.stringify(pending.data));
  assert.equal((await calculate(p)).status,201);
  const denied=await review(f.family,pending.data,'accept');assert.equal(denied.status,409);assert.equal(denied.data.error,'period_already_calculated');
  assert.equal((await review(f.owner,pending.data,'revoke')).status,200);
  const p2=month(3),draftBody={buildingId:f.buildingId,period:p2,tariffId,key:randomUUID()};
  const batch=await accountant.call('/finance/batches','POST',draftBody);assert.equal(batch.status,201,JSON.stringify(batch.data));
  const offer=await create(p2,p2);assert.equal(offer.status,201);
  const consent=await review(f.family,offer.data,'accept');assert.equal(consent.status,200);accepted=consent.data;
  const stale=await accountant.call('/finance/batches/'+batch.data.id+'/publish','POST',{key:randomUUID(),version:batch.data.version,acceptWarnings:true});
  assert.equal(stale.status,409);assert.equal(stale.data.error,'batch_preview_changed');
  const fresh=await accountant.call('/finance/batches','POST',{...draftBody,key:randomUUID()});assert.equal(fresh.status,201);
  assert.equal(fresh.data.snapshot.charges.find((r:any)=>r.unitId===unitId).payerId,f.seed.accounts.family.id);
  const posted=await accountant.call('/finance/batches/'+fresh.data.id+'/publish','POST',{key:randomUUID(),version:fresh.data.version,acceptWarnings:true});
  assert.equal(posted.status,200,JSON.stringify(posted.data));
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM charges WHERE payer_assignment_id=$1 AND period=$2',[payerId,p2])).rows[0].n,1);
  assert.equal((await review(f.owner,accepted,'revoke')).status,200);
  const open=await create(month(4));assert.equal(open.status,201);
  const r=await review(f.family,open.data,'accept');assert.equal(r.status,200);accepted=r.data;
  assert.equal(await effective(month(4)),f.seed.accounts.family.id);
  await policy(false);assert.equal(await effective(month(4)),f.seed.accounts.unit_owner.id);
  await policy(true);assert.equal(await effective(month(4)),f.seed.accounts.family.id);
  const familyAssignment=(await pool.query("SELECT id,expires_at FROM role_assignments WHERE user_id=$1 AND unit_id=$2 AND role_key='family' AND active",[f.seed.accounts.family.id,unitId])).rows[0];
  await pool.query("UPDATE role_assignments SET expires_at=now()-interval '1 second' WHERE id=$1",[familyAssignment.id]);
  assert.equal(await effective(month(4)),f.seed.accounts.unit_owner.id);
  await pool.query('UPDATE role_assignments SET expires_at=$2 WHERE id=$1',[familyAssignment.id,familyAssignment.expires_at]);
  const ownerAssignment=(await pool.query('SELECT owner_assignment_id FROM resident_payer_delegations WHERE id=$1',[accepted.id])).rows[0].owner_assignment_id;
  const delegated=(await pool.query(`INSERT INTO resident_delegations(organization_id,owner_assignment_id,unit_id,permission_keys,expires_at,assignment_id)
   VALUES($1,$2,$3,ARRAY['properties.own'],now()+interval '2 years',$4) RETURNING id`,[orgId,ownerAssignment,unitId,familyAssignment.id])).rows[0];
  assert.equal(await effective(month(4)),f.seed.accounts.family.id);
  await pool.query('UPDATE resident_delegations SET revoked_at=now() WHERE id=$1',[delegated.id]);
  assert.equal(await effective(month(4)),f.seed.accounts.unit_owner.id);
  await pool.query('DELETE FROM resident_delegations WHERE id=$1',[delegated.id]); // fixture cleanup only
  assert.equal((await review(f.owner,accepted,'revoke')).status,200);
 });
 test('concurrent recipient acceptance and billing produce one correctly authorized canonical charge',async()=>{
  const f=get(),p=month(5),offer=await create(p,p);assert.equal(offer.status,201);
  const [consent,bill]=await Promise.all([review(f.family,offer.data,'accept'),calculate(p)]);
  assert.equal(bill.status,201,JSON.stringify(bill.data));
  if(consent.status===200)assert.equal(bill.data.payer_user_id,f.seed.accounts.family.id);
  else{assert.equal(consent.status,409,JSON.stringify(consent.data));assert.equal(bill.data.payer_user_id,f.seed.accounts.unit_owner.id)}
  const totals=(await pool.query('SELECT count(*)::int AS n FROM charges WHERE payer_assignment_id=$1 AND period=$2',[payerId,p])).rows[0];
  assert.equal(totals.n,1);
 });
}
