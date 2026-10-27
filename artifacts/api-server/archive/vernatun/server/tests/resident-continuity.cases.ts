import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {pool} from '../db.js';
import {config} from '../config.js';
import {referencedFiles} from '../backup-postgres.js';
interface Client{
 call(path:string,method?:string,body?:unknown):Promise<{status:number;data:any}>;
 bytes(path:string,method?:string,body?:Buffer):Promise<{status:number;body:Buffer;type:string|null;cache:string|null}>;
}
type Fixture={owner:Client;family:Client;admin:Client;manager:()=>Promise<Client>;buildingId:string;query:string;seed:{accounts:Record<string,{id:string}>}};
const settings={directory:true,discussions:true,chat:true,marketplace:true,services:true,activationRequired:false,financeTransparency:false};
export function registerResidentContinuityTests(get:()=>Fixture){
 test('household reads canonical current-unit members and does not expose the family of another resident',async()=>{
  const {owner,family,seed}=get();
  const house=await owner.call('/resident/household');assert.equal(house.status,200);assert.equal(house.data.canManageDelegations,true);
  assert.ok(house.data.members.some((m:any)=>m.userId===seed.accounts.unit_owner.id));
  const own=await family.call('/resident/household');assert.equal(own.status,200);
  assert.ok(own.data.members.every((m:any)=>m.userId===seed.accounts.family.id));
  assert.ok(own.data.leases.every((l:any)=>l.renterId===seed.accounts.family.id));
 });
 test('continuity verifies existing email without exposing code and persists failed-attempt budget',async()=>{
  const {owner,seed}=get(),user=seed.accounts.unit_owner.id;
  assert.equal((await owner.call('/resident/continuity')).status,200);
  assert.equal((await owner.call('/resident/email-verification','POST',{})).status,202);
  assert.equal((await owner.call('/resident/email-verification','POST',{})).status,429);
  const account=(await pool.query('SELECT lower(email) AS email FROM users WHERE id=$1',[user])).rows[0];
  const code='637281',hash=createHmac('sha256',config.SESSION_SECRET).update(user+'\0'+account.email+'\0'+code).digest('hex');
  await pool.query('UPDATE resident_email_challenges SET code_hash=$2 WHERE user_id=$1',[user,hash]);
  assert.equal((await owner.call('/resident/email-verification','PUT',{code:'000000'})).status,400);
  assert.equal((await pool.query('SELECT attempts FROM resident_email_challenges WHERE user_id=$1',[user])).rows[0].attempts,1);
  assert.equal((await owner.call('/resident/email-verification','PUT',{code})).status,204);
  assert.equal((await owner.call('/resident/email-verification','PUT',{code})).status,400);
  const state=(await owner.call('/resident/continuity')).data;
  assert.equal(state.emailVerified,true);assert.equal(state.phoneVerification,'PROVIDER_REQUIRED');
  assert.ok(!JSON.stringify(state).includes(hash));assert.ok(!JSON.stringify(state).includes(code));
 });
 test('direct messages are opt-in, scoped, idempotent, paged and independently blocked',async()=>{
  const {owner,family,admin,query,buildingId,seed}=get(),own=seed.accounts.unit_owner.id,other=seed.accounts.family.id;
  assert.equal((await admin.call('/resident/settings'+query,'PUT',settings)).status,200);
  await pool.query(`INSERT INTO resident_profiles(user_id,show_name,allow_messages) VALUES($1,true,true),($2,true,true)
   ON CONFLICT(user_id) DO UPDATE SET show_name=true,allow_messages=true`,[own,other]);
  const people=(await owner.call('/resident/continuity')).data.neighbors;
  assert.ok(people.some((p:any)=>p.id===other));
  const stranger=(await pool.query(`SELECT a.user_id FROM role_assignments a WHERE a.organization_id<>
   (SELECT organization_id FROM buildings WHERE id=$1) LIMIT 1`,[buildingId])).rows[0].user_id;
  assert.equal((await owner.call('/resident/direct-chats','POST',{recipientId:stranger})).status,404);
  const opened=await owner.call('/resident/direct-chats','POST',{recipientId:other});assert.equal(opened.status,200);
  const id=opened.data.id,path='/resident/direct-chats/'+id;
  assert.equal((await family.call('/resident/direct-chats','POST',{recipientId:own})).data.id,id);
  const b={body:'Private neighbor message',clientId:randomUUID()},first=await owner.call(path+'/messages','POST',b);
  assert.equal(first.status,201);assert.equal((await owner.call(path+'/messages','POST',b)).data.id,first.data.id);
  assert.equal((await owner.call(path+'/messages','POST',{...b,body:'Changed payload'})).status,409);
  assert.equal((await family.call('/resident/continuity')).data.chats.find((r:any)=>r.id===id).unread,1);
  assert.equal((await family.call(path+'/state','PUT',{action:'read'})).status,204);
  assert.equal((await family.call('/resident/continuity')).data.chats.find((r:any)=>r.id===id).unread,0);
  assert.equal((await family.call(path+'/state','PUT',{action:'block'})).status,204);
  assert.equal((await owner.call(path+'/state','PUT',{action:'unblock'})).status,204);
  assert.equal((await owner.call(path+'/messages','POST',{body:'Blocked',clientId:randomUUID()})).status,403);
  assert.equal((await family.call(path+'/state','PUT',{action:'unblock'})).status,204);
  for(let n=0;n<51;n++)await pool.query('INSERT INTO resident_direct_messages(thread_id,sender_id,client_id,body) VALUES($1,$2,$3,$4)',[id,own,randomUUID(),'Page '+n]);
  const page=(await family.call(path+'/messages')).data;assert.equal(page.items.length,50);assert.equal(page.hasMore,true);
  const earlier=(await family.call(path+'/messages?before='+page.items[0].id)).data;assert.equal(earlier.items.length,2);
  await pool.query('UPDATE resident_profiles SET allow_messages=false WHERE user_id=$1',[other]);
  assert.equal((await owner.call(path+'/messages')).status,404);
  await pool.query('UPDATE resident_profiles SET allow_messages=true WHERE user_id=$1',[other]);
 });
 test('quiet hours use canonical preference versions, timezone and deferred notifications',async()=>{
  const {owner,seed,buildingId}=get(),user=seed.accounts.unit_owner.id;
  const old=(await owner.call('/resident/continuity')).data.notificationSettings;
  const b={...old,emailEnabled:true,inAppEnabled:true,quietEnabled:true,quietStart:'22:00',quietEnd:'08:00',timezone:'Asia/Yerevan'};
  const changed=await owner.call('/resident/notification-settings','PUT',b);assert.equal(changed.status,200);
  assert.equal((await owner.call('/resident/notification-settings','PUT',b)).status,409);
  assert.equal((await owner.call('/resident/notification-settings','PUT',{...changed.data,timezone:'not/a_timezone'})).status,400);
  const until=(await pool.query("SELECT resident_quiet_until($1,'2026-01-01T23:00:00Z') AS value",[user])).rows[0].value;
  assert.equal(new Date(until).toISOString(),'2026-01-02T04:00:00.000Z');
  assert.equal((await pool.query("SELECT resident_quiet_until($1,'2026-01-01T10:00:00Z') AS value",[user])).rows[0].value,null);
  const minutes=new Date().getUTCHours()*60+new Date().getUTCMinutes(),clock=(n:number)=>String(Math.floor(((n+1440)%1440)/60)).padStart(2,'0')+':'+String((n+1440)%60).padStart(2,'0');
  await owner.call('/resident/notification-settings','PUT',{...changed.data,quietStart:clock(minutes-60),quietEnd:clock(minutes+60),timezone:'UTC'});
  const code=(await pool.query('SELECT code FROM notification_catalog WHERE NOT critical ORDER BY code LIMIT 1')).rows[0].code;
  const org=(await pool.query('SELECT organization_id FROM buildings WHERE id=$1',[buildingId])).rows[0].organization_id;
  const before=(await owner.call('/notifications/unread-count')).data.unread;
  const event=(await pool.query(`INSERT INTO notifications(user_id,organization_id,kind,event_code,entity_type) VALUES($1,$2,$3,$3,'system') RETURNING id,visible_after`,[user,org,code])).rows[0];
  assert.ok(event.visible_after);assert.ok(new Date(event.visible_after).getTime()>Date.now());
  assert.equal((await owner.call('/notifications/unread-count')).data.unread,before);
  assert.ok(!(await owner.call('/notifications')).data.some((n:any)=>n.id===event.id));
  const mail=(await pool.query('SELECT not_before FROM notification_email_outbox WHERE notification_id=$1',[event.id])).rows[0];
  assert.ok(mail?.not_before);
  await pool.query('UPDATE notifications SET visible_after=now()-interval \'1 second\' WHERE id=$1',[event.id]);
  assert.equal((await owner.call('/notifications/unread-count')).data.unread,before+1);
  const latest=(await owner.call('/resident/continuity')).data.notificationSettings;
  assert.equal((await owner.call('/resident/notification-settings','PUT',{...latest,quietEnabled:false})).status,200);
 });
 test('saved searches and comparison reuse visibility and actual sale/rent filters',async()=>{
  const {owner,family,buildingId,seed}=get(),user=seed.accounts.unit_owner.id;
  const org=(await pool.query('SELECT organization_id FROM buildings WHERE id=$1',[buildingId])).rows[0].organization_id;
  const unit=(await pool.query('SELECT unit_id FROM role_assignments WHERE user_id=$1 AND role_key=\'unit_owner\' LIMIT 1',[user])).rows[0].unit_id;
  const ids=[randomUUID(),randomUUID()];
  for(let i=0;i<2;i++)await pool.query(`INSERT INTO resident_product_records(id,organization_id,building_id,unit_id,kind,owner_user_id,title,body,data,status)
   VALUES($1,$2,$3,$4,'listings',$5,$6,'Configured listing',$7,'active')`,[ids[i],org,buildingId,unit,user,'Compare '+i,JSON.stringify({saleType:i?'rent':'sale',priceMinor:'12345',currency:'AMD',latitude:40.18+i/100,longitude:44.51})]);
  const saved=await owner.call('/resident/saved-searches','POST',{name:'Sales only',query:'Compare',offerType:'sale'});assert.equal(saved.status,201);
  const filtered=await owner.call('/resident/records/listings?search=Compare&offerType=sale');assert.equal(filtered.status,200);
  assert.ok(filtered.data.items.some((r:any)=>r.id===ids[0]));assert.ok(!filtered.data.items.some((r:any)=>r.id===ids[1]));
  const compared=await owner.call('/resident/property-comparison?ids='+ids.join(','));assert.equal(compared.status,200);assert.equal(compared.data.length,2);
  assert.equal(compared.data[0].latitude,null);assert.equal(compared.data[0].longitude,null);
  assert.equal((await owner.call('/resident/records/listings','POST',{title:'Bad location',body:'',saleType:'sale',priceMinor:'100',currency:'AMD',latitude:100})).status,400);
  assert.equal((await owner.call('/resident/property-comparison?ids='+ids[0]+','+randomUUID())).status,404);
  assert.ok(!(await family.call('/resident/continuity')).data.savedSearches.some((r:any)=>r.id===saved.data.id));
  assert.equal((await family.call('/resident/saved-searches/'+saved.data.id,'DELETE')).status,404);
  assert.equal((await owner.call('/resident/saved-searches/'+saved.data.id,'DELETE')).status,204);
 });
 test('platform tickets are canonical but private; AI questions persist without invented answers',async()=>{
  const {owner,family,seed}=get();
  const ticket=await owner.call('/resident/platform-tickets','POST',{subject:'Application support',body:'Please explain this application screen'});assert.equal(ticket.status,201);
  assert.equal((await pool.query('SELECT created_by FROM support_cases WHERE id=$1',[ticket.data.id])).rows[0].created_by,seed.accounts.unit_owner.id);
  assert.ok(!(await family.call('/resident/continuity')).data.tickets.some((r:any)=>r.id===ticket.data.id));
  const b={title:'Saved question',body:'Question awaiting an AI provider',clientId:randomUUID()};
  const history=await owner.call('/resident/ai-history','POST',b);assert.equal(history.status,201);assert.equal(history.data.providerStatus,'NOT_CONFIGURED');
  assert.equal((await owner.call('/resident/ai-history','POST',b)).data.id,history.data.id);
  assert.equal((await owner.call('/resident/ai-history','POST',{...b,body:'Changed'})).status,409);
  assert.equal((await family.call('/resident/ai-history/'+history.data.id,'DELETE')).status,404);
  assert.equal((await owner.call('/resident/ai-history/'+history.data.id,'DELETE')).status,204);
 });
 test('service slot confirmation creates exactly one canonical request and work order',async()=>{
  const {owner,admin,query,manager}=get(),operator=await manager();
  const picker=await operator.call('/resident/admin/buildings');assert.equal(picker.status,200);
  assert.ok(picker.data.some((b:any)=>'?buildingId='+b.id===query));
  const service=await admin.call('/resident/records/services'+query,'POST',{title:'Scheduled cleaning',body:'One-off visit',category:'cleaning',priceMinor:'10000',currency:'AMD'});assert.equal(service.status,201);
  const startsAt=new Date(Date.now()+2*86400000).toISOString(),endsAt=new Date(Date.now()+2*86400000+3600000).toISOString();
  const booking=await owner.call('/resident/service-bookings','POST',{serviceId:service.data.id,startsAt,endsAt,note:'Requested one hour visit'});assert.equal(booking.status,201);
  assert.equal((await owner.call('/resident/service-bookings/'+booking.data.id,'PUT',{action:'confirm',version:1})).status,403);
  assert.equal((await owner.call('/resident/service-bookings','POST',{serviceId:service.data.id,startsAt,endsAt,note:''})).status,409);
  const options=await operator.call('/resident/service-bookings/'+booking.data.id+'/options'+query);assert.equal(options.status,200);
  assert.ok(options.data.categories.length);assert.ok(options.data.technicians.length);
  const input={action:'confirm',version:booking.data.version,categoryId:options.data.categories[0].id,technicianId:options.data.technicians[0].id};
  const bad=await operator.call('/resident/service-bookings/'+booking.data.id+query,'PUT',{...input,categoryId:randomUUID()});assert.equal(bad.status,400);
  assert.equal((await pool.query('SELECT status FROM resident_service_bookings WHERE id=$1',[booking.data.id])).rows[0].status,'requested');
  const [confirmed,concurrent]=await Promise.all([operator.call('/resident/service-bookings/'+booking.data.id+query,'PUT',input),operator.call('/resident/service-bookings/'+booking.data.id+query,'PUT',input)]);
  assert.equal(confirmed.status,200,JSON.stringify(confirmed.data));assert.equal(concurrent.status,200);assert.equal(concurrent.data.requestId,confirmed.data.requestId);
  assert.equal(confirmed.data.status,'confirmed');assert.ok(confirmed.data.requestId);
  const again=await operator.call('/resident/service-bookings/'+booking.data.id+query,'PUT',input);assert.equal(again.status,200);assert.equal(again.data.requestId,confirmed.data.requestId);
  assert.equal(Number((await pool.query('SELECT count(*) FROM work_orders WHERE request_id=$1',[confirmed.data.requestId])).rows[0].count),1);
  const slots=await operator.call('/resident/service-bookings'+query);assert.equal(slots.status,200);assert.ok(slots.data.some((r:any)=>r.id===booking.data.id));
 });
 test('mandatory activation is building opt-in and cannot be bypassed by a mutation',async()=>{
  const {owner,buildingId,seed}=get(),user=seed.accounts.unit_owner.id;
  await pool.query('UPDATE resident_profiles SET verified_email=NULL,email_verified_at=NULL WHERE user_id=$1',[user]);
  await pool.query('UPDATE resident_building_settings SET activation_required=true WHERE building_id=$1',[buildingId]);
  try{
   assert.equal((await owner.call('/resident/records/vehicles','POST',{title:'Blocked car',body:'',plate:'TEST99',country:'AM',vehicleType:'car'})).status,403);
   const state=await owner.call('/resident/continuity');assert.equal(state.status,200);assert.equal(state.data.activation.ready,false);
   const email=(await pool.query('SELECT lower(email) AS email FROM users WHERE id=$1',[user])).rows[0].email,code='681329';
   const hash=createHmac('sha256',config.SESSION_SECRET).update(user+'\0'+email+'\0'+code).digest('hex');
   await pool.query(`UPDATE resident_email_challenges SET code_hash=$2,attempts=0,consumed_at=NULL,expires_at=now()+interval '5 minutes' WHERE user_id=$1`,[user,hash]);
   assert.equal((await owner.call('/resident/email-verification','PUT',{code})).status,204);
   const agreements=(await owner.call('/resident/records/agreements')).data.items;
   for(const r of agreements.filter((r:any)=>r.status==='active'&&r.data.mandatory&&!r.accepted)){
    assert.equal((await owner.call('/resident/records/agreements/'+r.id+'/actions','POST',{action:'accept',version:r.version})).status,200);
   }
   assert.equal((await owner.call('/resident/continuity')).data.activation.ready,true);
  }finally{await pool.query('UPDATE resident_building_settings SET activation_required=false WHERE building_id=$1',[buildingId]);}
 });
 test('avatars are sanitized private bytes and inactive versions remain recovery references',async()=>{
  const {owner,family,seed}=get();
  assert.equal((await owner.bytes('/resident/avatar','PUT',Buffer.from('not an image'))).status,400);
  const png=await sharp({create:{width:20,height:20,channels:3,background:'#ff7700'}}).png().toBuffer();
  assert.equal((await owner.bytes('/resident/avatar','PUT',png)).status,204);
  assert.equal((await owner.call('/resident/continuity')).data.avatarAvailable,true);
  const img=await owner.bytes('/resident/avatar');assert.equal(img.status,200);assert.equal(img.type,'image/jpeg');assert.match(img.cache??'',/private/);
  const meta=await sharp(img.body).metadata();assert.equal(meta.exif,undefined);assert.ok((meta.width??0)<=512);
  assert.equal((await family.bytes('/resident/avatar')).status,404);
  assert.equal((await owner.call('/resident/avatar','DELETE')).status,204);
  assert.equal((await owner.bytes('/resident/avatar')).status,404);
  const retained=(await pool.query('SELECT storage_key FROM resident_avatars WHERE user_id=$1 AND NOT active',[seed.accounts.unit_owner.id])).rows[0];
  assert.ok(retained);
  const db=await pool.connect();try{
   const schema=(await db.query('SELECT current_schema() AS name')).rows[0].name;
   assert.ok((await referencedFiles(db,schema)).some(r=>r.kind==='photos'&&r.key===retained.storage_key));
  }finally{db.release();}
 });
 test('building transparency is opt-in, permission gated and exposes no individual identifiers',async()=>{
  const {owner,family,buildingId}=get();
  assert.equal((await owner.call('/resident/building-finance')).status,403);
  await pool.query('UPDATE resident_building_settings SET finance_transparency=true WHERE building_id=$1',[buildingId]);
  try{
   const response=await owner.call('/resident/building-finance');assert.equal(response.status,200);assert.ok(Array.isArray(response.data));
   for(const r of response.data){assert.deepEqual(Object.keys(r).sort(),['allocatedMinor','currency','period','publishedMinor','status']);
    if(r.status==='INSUFFICIENT_COHORT'){assert.equal(r.publishedMinor,null);assert.equal(r.allocatedMinor,null);}
   }
   assert.equal((await family.call('/resident/building-finance')).status,403);
  }finally{await pool.query('UPDATE resident_building_settings SET finance_transparency=false WHERE building_id=$1',[buildingId]);}
 });
}
