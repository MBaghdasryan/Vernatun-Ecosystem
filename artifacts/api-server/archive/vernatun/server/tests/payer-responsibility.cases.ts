import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool} from '../db.js';
type Client={call(path:string,method?:string,body?:unknown):Promise<{status:number;data:any}>};
type Fixture={owner:Client;family:Client;admin:Client;accountant:()=>Promise<Client>;manager:()=>Promise<Client>;renter:()=>Promise<Client>;buildingId:string;query:string;seed:{accounts:Record<string,{id:string}>}};
export function registerPayerResponsibilityTests(get:()=>Fixture){
 let serviceId:string,tariffId:string,payerId:string,unitId:string,orgId:string,next:string;
 let policyVersion=0,accepted:any,accountant:Client;
 const month=(offset:number)=>{const d=new Date(next+'T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+offset);return d.toISOString().slice(0,10)};
 const calculate=(p:string)=>accountant.call('/finance/calculate','POST',{payerAssignmentId:payerId,tariffId,period:p});
  const create=(startsOn:string,endsOn?:string,recipientId=get().seed.accounts.family.id)=>get().owner.call('/resident/payer-responsibilities','POST',{
   payerAssignmentId:payerId,recipientId,startsOn,...(endsOn?{endsOn}:{}),clientId:randomUUID()});
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
  const minute=new Date().getUTCHours()*60+new Date().getUTCMinutes(),clock=(n:number)=>String(Math.floor(((n+1440)%1440)/60)).padStart(2,'0')+':'+String((n+1440)%60).padStart(2,'0');
  await pool.query(`INSERT INTO notification_preferences(user_id,quiet_enabled,quiet_start,quiet_end,timezone)
   VALUES($1,true,$2,$3,'UTC') ON CONFLICT(user_id) DO UPDATE SET quiet_enabled=true,quiet_start=$2,quiet_end=$3,timezone='UTC'`,
   [f.seed.accounts.family.id,clock(minute-30),clock(minute+30)]);
  const proposed=await f.owner.call('/resident/payer-responsibilities','POST',body);
  assert.equal(proposed.status,201,JSON.stringify(proposed.data));
  assert.equal(proposed.data.status,'pending');assert.equal(await effective(next),f.seed.accounts.unit_owner.id);
  // These are distinct authenticated sessions holding the same pending offer.
  const ownerPending=(await f.owner.call('/resident/payer-responsibilities')).data;
  const recipientPending=(await f.family.call('/resident/payer-responsibilities')).data;
  const findOffer=(workspace:any,id:string)=>workspace.delegations.find((d:any)=>d.id===id);
  assert.equal(findOffer(ownerPending,proposed.data.id).status,'pending');
  assert.equal(findOffer(recipientPending,proposed.data.id).status,'pending');
  let notice=(await pool.query(`SELECT id,visible_after FROM notifications WHERE user_id=$1 AND entity_type='payer_responsibility'
   AND entity_id=$2 AND event_code='payer_responsibility_pending'`,[f.seed.accounts.family.id,proposed.data.id])).rows[0];
  assert.ok(notice);assert.ok(new Date(notice.visible_after).getTime()>Date.now());
  const emailIntent=(await pool.query('SELECT state,not_before FROM notification_email_outbox WHERE notification_id=$1',[notice.id])).rows[0];
  assert.equal(emailIntent.state,'pending_domain');assert.equal(new Date(emailIntent.not_before).getTime(),new Date(notice.visible_after).getTime());
  // The canonical queue defers this event during quiet hours; advance the isolated
  // test row so the authorized destination can be checked before the window ends.
  await pool.query('UPDATE notifications SET visible_after=now()-interval \'1 second\' WHERE id=$1',[notice.id]);
  const visibleNotice=(await f.family.call('/notifications')).data.find((n:any)=>n.id===notice.id);
  assert.equal(visibleNotice.access_denied,false);assert.equal(visibleNotice.category,'finance');
  assert.equal(Object.hasOwn(visibleNotice,'entity_id'),false);
  const unreadBefore=(await f.family.call('/notifications/unread-count')).data.unread;
  const marked=await f.family.call('/notifications/'+notice.id+'/read','POST',{});
  assert.equal(marked.status,200,JSON.stringify(marked.data));
  assert.ok((await pool.query('SELECT read_at FROM notifications WHERE id=$1',[notice.id])).rows[0].read_at);
  assert.equal((await f.family.call('/notifications/unread-count')).data.unread,unreadBefore-1);
  const destination=await f.family.call('/notifications/'+notice.id+'/destination');
  assert.equal(destination.status,200);assert.equal(destination.data.destination,'/imtun/preferences');
  const replay=await f.owner.call('/resident/payer-responsibilities','POST',body);assert.equal(replay.data.id,proposed.data.id);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM notifications WHERE user_id=$1 AND entity_id=$2
   AND event_code='payer_responsibility_pending'`,[f.seed.accounts.family.id,proposed.data.id])).rows[0].n,1);
  assert.equal((await f.owner.call('/resident/payer-responsibilities','POST',{...body,recipientId:randomUUID()})).status,409);
  assert.equal((await review(f.owner,proposed.data,'accept')).status,403);
  assert.equal((await f.family.call('/resident/payer-responsibilities','POST',{...body,clientId:randomUUID()})).status,403);
  assert.equal((await f.owner.call('/resident/payer-responsibilities?buildingId='+randomUUID())).status,403);
  const consent=await review(f.family,proposed.data,'accept');assert.equal(consent.status,200,JSON.stringify(consent.data));accepted=consent.data;
  // The other already-authenticated session sees the decision on its next read.
  const ownerAfterAccept=(await f.owner.call('/resident/payer-responsibilities')).data;
  const recipientAfterAccept=(await f.family.call('/resident/payer-responsibilities')).data;
  assert.equal(findOffer(ownerAfterAccept,proposed.data.id).status,'accepted');
  assert.equal(findOffer(recipientAfterAccept,proposed.data.id).status,'accepted');
  assert.equal((await review(f.family,proposed.data,'accept')).data.version,accepted.version);
  notice=(await pool.query(`SELECT id FROM notifications WHERE user_id=$1 AND entity_type='payer_responsibility'
   AND entity_id=$2 AND event_code='payer_responsibility_accepted'`,[f.seed.accounts.unit_owner.id,accepted.id])).rows[0];
  assert.ok(notice);
  const ownerDestination=await f.owner.call('/notifications/'+notice.id+'/destination');
  assert.equal(ownerDestination.status,200);assert.equal(ownerDestination.data.destination,'/imtun/preferences');
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM notifications WHERE user_id=$1 AND entity_id=$2
   AND event_code='payer_responsibility_accepted'`,[f.seed.accounts.unit_owner.id,accepted.id])).rows[0].n,1);
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
  const recipientAfterRevoke=(await f.family.call('/resident/payer-responsibilities')).data;
  assert.equal(findOffer(recipientAfterRevoke,accepted.id).status,'revoked');
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM notifications WHERE user_id=$1 AND entity_id=$2
   AND event_code='payer_responsibility_revoked'`,[f.seed.accounts.unit_owner.id,accepted.id])).rows[0].n,1);
  assert.equal(await effective(month(1)),f.seed.accounts.unit_owner.id);
  const unchanged=(await pool.query('SELECT payer_user_id FROM payer_assignments WHERE id=$1',[payerId])).rows[0];
  assert.equal(unchanged.payer_user_id,f.seed.accounts.unit_owner.id);
  const history=(await pool.query('SELECT payer_user_id FROM invoices WHERE id=ANY($1::uuid[]) ORDER BY id',[[before.data.id,invoice.data.id]])).rows;
  assert.deepEqual(history.map(r=>r.payer_user_id).sort(),[f.seed.accounts.unit_owner.id,f.seed.accounts.family.id].sort());
  assert.equal((await create(next)).status,409); // includes already-created draft/published charges
  await pool.query(`UPDATE notification_preferences SET in_app_enabled=true,email_enabled=true,quiet_enabled=false,
   categories=$2::jsonb WHERE user_id=$1`,
   [f.seed.accounts.family.id,JSON.stringify({finance:{in_app:false,email:false}})]);
  const declinedOffer=await create(month(6),month(6));assert.equal(declinedOffer.status,201,JSON.stringify(declinedOffer.data));
  const ownerBeforeDecline=(await f.owner.call('/resident/payer-responsibilities')).data;
  assert.equal(findOffer(ownerBeforeDecline,declinedOffer.data.id).status,'pending');
  const muted=(await pool.query(`SELECT id,in_app_enabled FROM notifications WHERE user_id=$1 AND entity_id=$2
   AND event_code='payer_responsibility_pending'`,[f.seed.accounts.family.id,declinedOffer.data.id])).rows[0];
  assert.equal(muted.in_app_enabled,false);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM notification_email_outbox WHERE notification_id=$1',[muted.id])).rows[0].n,0);
  const declined=await review(f.family,declinedOffer.data,'decline');assert.equal(declined.status,200);
  const ownerAfterDecline=(await f.owner.call('/resident/payer-responsibilities')).data;
  assert.equal(findOffer(ownerAfterDecline,declinedOffer.data.id).status,'declined');
  await pool.query(`UPDATE notification_preferences SET categories='{}'::jsonb WHERE user_id=$1`,[f.seed.accounts.family.id]);
  assert.equal((await review(f.family,declinedOffer.data,'decline')).data.version,declined.data.version);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM notifications WHERE user_id=$1 AND entity_id=$2
   AND event_code='payer_responsibility_declined'`,[f.seed.accounts.unit_owner.id,declinedOffer.data.id])).rows[0].n,1);
  const familyAssignment=(await pool.query(`SELECT id FROM role_assignments WHERE user_id=$1 AND unit_id=$2
   AND role_key='family' AND active ORDER BY id LIMIT 1`,[f.seed.accounts.family.id,unitId])).rows[0];
  await pool.query('UPDATE role_assignments SET active=false WHERE id=$1',[familyAssignment.id]);
  try{
   const pendingNoticeId=(await pool.query(`SELECT id FROM notifications WHERE user_id=$1 AND entity_id=$2
    AND event_code='payer_responsibility_pending'`,[f.seed.accounts.family.id,proposed.data.id])).rows[0].id;
   const readAtBefore=(await pool.query('SELECT read_at FROM notifications WHERE id=$1',[pendingNoticeId])).rows[0].read_at;
   assert.equal((await f.family.call('/notifications/'+pendingNoticeId+'/destination')).status,403);
   const readAtAfter=(await pool.query('SELECT read_at FROM notifications WHERE id=$1',[pendingNoticeId])).rows[0].read_at;
   assert.equal(readAtAfter?.getTime(),readAtBefore?.getTime());
  }finally{
   await pool.query('UPDATE role_assignments SET active=true WHERE id=$1',[familyAssignment.id]);
  }
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
  test('renter eligibility follows recorded lease dates for proposals, acceptance and both billing paths',async()=>{
   const f=get(),renter=await f.renter(),manager=await f.manager(),renterId=f.seed.accounts.renter.id,ownerId=f.seed.accounts.unit_owner.id;
   accountant=await f.accountant();
   const role=(await pool.query(`SELECT id FROM role_assignments WHERE user_id=$1 AND unit_id=$2 AND role_key='renter' AND active ORDER BY id LIMIT 1`,[renterId,unitId])).rows[0];
   assert.ok(role,'test renter must have a live assignment for the payer unit');
   await pool.query('UPDATE role_assignments SET expires_at=NULL WHERE id=$1',[role.id]);
   assert.equal((await pool.query('SELECT count(*)::int AS n FROM leases WHERE organization_id=$1 AND unit_id=$2 AND renter_id=$3',[orgId,unitId,renterId])).rows[0].n,0);
   await policy(true);

   // Restored renter with no recorded contract keeps the legacy path.
   const legacyPeriod=month(7),legacyOffer=await create(legacyPeriod,legacyPeriod,renterId);
   assert.equal(legacyOffer.status,201,JSON.stringify(legacyOffer.data));
   const legacyAccepted=await review(renter,legacyOffer.data,'accept');
   assert.equal(legacyAccepted.status,200,JSON.stringify(legacyAccepted.data));
   const legacyInvoice=await calculate(legacyPeriod);
   assert.equal(legacyInvoice.status,201,JSON.stringify(legacyInvoice.data));
   assert.equal(legacyInvoice.data.payer_user_id,renterId);
   assert.equal((await accountant.call('/finance/invoices/'+legacyInvoice.data.id+'/publish','POST',{})).status,200);
   const historical=(await pool.query(`SELECT i.id,i.payer_user_id,i.period::text,i.amount_minor::text,i.currency,i.status,
    c.payer_assignment_id,c.tariff_id,c.payer_delegation_id FROM invoices i JOIN charges c ON c.invoice_id=i.id WHERE i.id=$1`,[legacyInvoice.data.id])).rows[0];

   // A recorded expired lease disables the legacy no-lease exception.
   await pool.query(`INSERT INTO leases(organization_id,unit_id,renter_id,starts_on,ends_on,amount_minor,currency,created_by)
    VALUES($1,$2,$3,'2000-01-01','2000-12-31',1000,'AMD',$4)`,[orgId,unitId,renterId,f.seed.accounts.manager.id]);
   const expiredPeriod=month(8),expiredOffer=await create(expiredPeriod,expiredPeriod,renterId);
   assert.equal(expiredOffer.status,409);assert.equal(expiredOffer.data.error,'recipient_not_eligible');
   assert.equal((await pool.query('SELECT resident_payer_recipient_valid($1,$2,$3,$4::date) AS ok',[orgId,unitId,renterId,expiredPeriod])).rows[0].ok,false);
   const workspace=(await f.owner.call('/resident/payer-responsibilities')).data;
   assert.ok(!workspace.recipients.some((r:any)=>r.id===renterId));

   // Active recorded lease: API acceptance, ordinary billing, and batch posting.
   const finalPeriod=month(10),leaseEnd=(period:string)=>{const d=new Date(period+'T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+1);d.setUTCDate(0);return d.toISOString().slice(0,10)};
   const lease=await manager.call('/leases','POST',{unitId,renterId,startsOn:'2001-01-01',endsOn:leaseEnd(finalPeriod),amountMinor:'1000',currency:'AMD'});
   assert.equal(lease.status,201,JSON.stringify(lease.data));
   const activePeriod=month(8),activeOffer=await create(activePeriod,activePeriod,renterId);
   assert.equal(activeOffer.status,201,JSON.stringify(activeOffer.data));
   assert.equal((await review(renter,activeOffer.data,'accept')).status,200);
   assert.equal((await pool.query('SELECT resident_payer_recipient_valid($1,$2,$3,$4::date) AS ok',[orgId,unitId,renterId,activePeriod])).rows[0].ok,true);
   const activeInvoice=await calculate(activePeriod);
   assert.equal(activeInvoice.status,201,JSON.stringify(activeInvoice.data));
   assert.equal(activeInvoice.data.payer_user_id,renterId);

   const batchPeriod=month(9),batchOffer=await create(batchPeriod,batchPeriod,renterId);
   assert.equal(batchOffer.status,201,JSON.stringify(batchOffer.data));
   assert.equal((await review(renter,batchOffer.data,'accept')).status,200);
   const draft=await accountant.call('/finance/batches','POST',{buildingId:f.buildingId,period:batchPeriod,tariffId,key:randomUUID()});
   assert.equal(draft.status,201,JSON.stringify(draft.data));
   const posted=await accountant.call('/finance/batches/'+draft.data.id+'/publish','POST',{key:randomUUID(),version:draft.data.version,acceptWarnings:true});
   assert.equal(posted.status,200,JSON.stringify(posted.data));
   const batchInvoice=(await pool.query(`SELECT i.payer_user_id FROM invoices i JOIN charges c ON c.invoice_id=i.id
    WHERE c.payer_assignment_id=$1 AND i.period=$2`,[payerId,batchPeriod])).rows[0];
   assert.equal(batchInvoice.payer_user_id,renterId);

   // An accepted offer becomes ineffective when the target period lies beyond
   // the recorded lease, even while the renter remains eligible today.
   const targetPeriod=month(10),pending=await create(targetPeriod,targetPeriod,renterId);
   assert.equal(pending.status,201,JSON.stringify(pending.data));
   const today=(await pool.query("SELECT (now() AT TIME ZONE 'Asia/Yerevan')::date::text AS day")).rows[0].day;
   await pool.query('UPDATE leases SET ends_on=$2 WHERE id=$1',[lease.data.id,today]);
   const beyondAccept=await review(renter,pending.data,'accept');
   assert.equal(beyondAccept.status,409,JSON.stringify(beyondAccept.data));
   assert.equal(beyondAccept.data.error,'recipient_not_eligible');
   assert.equal((await pool.query('SELECT resident_payer_recipient_valid($1,$2,$3,$4::date) AS ok',[orgId,unitId,renterId,targetPeriod])).rows[0].ok,false);

   // Restore through the versioned lease API, then verify future billing beyond
   // the renewed period and the canceled lease cannot select the former renter.
   const restored=await manager.call('/leases/'+lease.data.id+'/extend','POST',{version:lease.data.version,endsOn:leaseEnd(finalPeriod)});
   assert.equal(restored.status,200,JSON.stringify(restored.data));
   const beyondOffer=await create(month(11),month(11),renterId);
   assert.equal(beyondOffer.status,409);assert.equal(beyondOffer.data.error,'recipient_not_eligible');
   const beyondInvoice=await calculate(month(11));
   assert.equal(beyondInvoice.status,201,JSON.stringify(beyondInvoice.data));
   assert.equal(beyondInvoice.data.payer_user_id,ownerId);
   const nonRenterBatch=await accountant.call('/finance/batches','POST',{buildingId:f.buildingId,period:month(12),tariffId,key:randomUUID()});
   assert.equal(nonRenterBatch.status,201,JSON.stringify(nonRenterBatch.data));
   const nonRenterPosted=await accountant.call('/finance/batches/'+nonRenterBatch.data.id+'/publish','POST',{key:randomUUID(),version:nonRenterBatch.data.version,acceptWarnings:true});
   assert.equal(nonRenterPosted.status,200,JSON.stringify(nonRenterPosted.data));
   const ownerBatchInvoice=(await pool.query(`SELECT i.payer_user_id FROM invoices i JOIN charges c ON c.invoice_id=i.id
    WHERE c.payer_assignment_id=$1 AND i.period=$2`,[payerId,month(12)])).rows[0];
   assert.equal(ownerBatchInvoice.payer_user_id,ownerId);

   const extension=await manager.call('/leases/'+lease.data.id+'/extend','POST',{version:restored.data.version,endsOn:leaseEnd(month(14))});
   assert.equal(extension.status,200,JSON.stringify(extension.data));
   const cancelOffer=await create(month(13),month(13),renterId);
   assert.equal(cancelOffer.status,201,JSON.stringify(cancelOffer.data));
   const canceled=await manager.call('/leases/'+lease.data.id+'/cancel','POST',{version:extension.data.version,reason:'Renter moved out'});
   assert.equal(canceled.status,200,JSON.stringify(canceled.data));
   const afterCancel=await review(renter,cancelOffer.data,'accept');
   assert.notEqual(afterCancel.status,200);
   assert.equal((await pool.query('SELECT status FROM resident_payer_delegations WHERE id=$1',[cancelOffer.data.id])).rows[0].status,'pending');
   const canceledOffer=await create(month(14),month(14),renterId);
   assert.equal(canceledOffer.status,409);assert.equal(canceledOffer.data.error,'recipient_not_eligible');
   assert.equal((await pool.query('SELECT resident_payer_recipient_valid($1,$2,$3,$4::date) AS ok',[orgId,unitId,renterId,month(13)])).rows[0].ok,false);
   const canceledInvoice=await calculate(month(13));
   assert.equal(canceledInvoice.status,201,JSON.stringify(canceledInvoice.data));
   assert.equal(canceledInvoice.data.payer_user_id,ownerId);
   const canceledBatch=await accountant.call('/finance/batches','POST',{buildingId:f.buildingId,period:month(14),tariffId,key:randomUUID()});
   assert.equal(canceledBatch.status,201,JSON.stringify(canceledBatch.data));
   const canceledPosted=await accountant.call('/finance/batches/'+canceledBatch.data.id+'/publish','POST',{key:randomUUID(),version:canceledBatch.data.version,acceptWarnings:true});
   assert.equal(canceledPosted.status,200,JSON.stringify(canceledPosted.data));
   const canceledBatchInvoice=(await pool.query(`SELECT i.payer_user_id FROM invoices i JOIN charges c ON c.invoice_id=i.id
    WHERE c.payer_assignment_id=$1 AND i.period=$2`,[payerId,month(14)])).rows[0];
   assert.equal(canceledBatchInvoice.payer_user_id,ownerId);
   assert.deepEqual((await pool.query(`SELECT i.id,i.payer_user_id,i.period::text,i.amount_minor::text,i.currency,i.status,
    c.payer_assignment_id,c.tariff_id,c.payer_delegation_id FROM invoices i JOIN charges c ON c.invoice_id=i.id WHERE i.id=$1`,[legacyInvoice.data.id])).rows[0],historical);
  });
  test('lease extension and cancellation serialize against batch and ordinary billing',async()=>{
   const f=get(),manager=await f.manager(),renterId=f.seed.accounts.renter.id,ownerId=f.seed.accounts.unit_owner.id;
   accountant=await f.accountant();
   const leaseEnd=(period:string)=>{const d=new Date(period+'T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+1);d.setUTCDate(0);return d.toISOString().slice(0,10)};
   const lease=await manager.call('/leases','POST',{unitId,renterId,startsOn:'2001-01-01',endsOn:leaseEnd(month(17)),amountMinor:'1000',currency:'AMD'});
   assert.equal(lease.status,201,JSON.stringify(lease.data));
   const renter=await f.renter();
   const offer=await create(month(16),undefined,renterId);
   assert.equal(offer.status,201,JSON.stringify(offer.data));
   assert.equal((await review(renter,offer.data,'accept')).status,200);
   const racePeriod=month(18),draft=await accountant.call('/finance/batches','POST',{buildingId:f.buildingId,period:racePeriod,tariffId,key:randomUUID()});
   assert.equal(draft.status,201,JSON.stringify(draft.data));
   const [extended,published]=await Promise.all([
    manager.call('/leases/'+lease.data.id+'/extend','POST',{version:lease.data.version,endsOn:leaseEnd(racePeriod)}),
    accountant.call('/finance/batches/'+draft.data.id+'/publish','POST',{key:randomUUID(),version:draft.data.version,acceptWarnings:true}),
   ]);
   assert.equal(extended.status,200,JSON.stringify(extended.data));
   if(published.status===200){
    const row=(await pool.query(`SELECT i.payer_user_id,c.payer_delegation_id FROM invoices i JOIN charges c ON c.invoice_id=i.id
     WHERE c.payer_assignment_id=$1 AND i.period=$2`,[payerId,racePeriod])).rows[0];
    assert.equal(row.payer_user_id,ownerId);
    assert.equal(row.payer_delegation_id,null);
   }else{
    assert.equal(published.status,409,JSON.stringify(published.data));
    assert.equal(published.data.error,'batch_preview_changed');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM charges WHERE payer_assignment_id=$1 AND period=$2',[payerId,racePeriod])).rows[0].n,0);
    const fresh=await accountant.call('/finance/batches','POST',{buildingId:f.buildingId,period:racePeriod,tariffId,key:randomUUID()});
    assert.equal(fresh.status,201,JSON.stringify(fresh.data));
    const posted=await accountant.call('/finance/batches/'+fresh.data.id+'/publish','POST',{key:randomUUID(),version:fresh.data.version,acceptWarnings:true});
    assert.equal(posted.status,200,JSON.stringify(posted.data));
    const row=(await pool.query(`SELECT i.payer_user_id,c.payer_delegation_id FROM invoices i JOIN charges c ON c.invoice_id=i.id
     WHERE c.payer_assignment_id=$1 AND i.period=$2`,[payerId,racePeriod])).rows[0];
    assert.equal(row.payer_user_id,renterId);
    assert.ok(row.payer_delegation_id);
   }

   // Reaching this invoice before cancellation may keep the renter as the
   // immutable original payer; if cancellation wins, the owner is charged.
   const nextEnd=await manager.call('/leases/'+lease.data.id+'/extend','POST',{version:extended.data.version,endsOn:leaseEnd(month(20))});
   assert.equal(nextEnd.status,200,JSON.stringify(nextEnd.data));
   const cancelPeriod=month(19),before=(await pool.query('SELECT id,payer_user_id FROM invoices WHERE period=$1 AND unit_id=$2',[cancelPeriod,unitId])).rows;
   assert.equal(before.length,0);
   const [canceled,billed]=await Promise.all([
    manager.call('/leases/'+lease.data.id+'/cancel','POST',{version:nextEnd.data.version,reason:'Move-out concurrent with billing'}),
    calculate(cancelPeriod),
   ]);
   assert.equal(canceled.status,200,JSON.stringify(canceled.data));
   assert.equal(billed.status,201,JSON.stringify(billed.data));
   const final=(await pool.query('SELECT payer_user_id FROM invoices WHERE id=$1',[billed.data.id])).rows[0];
   assert.ok([ownerId,renterId].includes(final.payer_user_id));
   assert.equal(billed.data.payer_user_id,final.payer_user_id);
   const charge=(await pool.query('SELECT payer_delegation_id FROM charges WHERE invoice_id=$1',[billed.data.id])).rows[0];
   if(final.payer_user_id===ownerId)assert.equal(charge.payer_delegation_id,null);
   else assert.ok(charge.payer_delegation_id);
  });
}
