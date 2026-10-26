import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {readPrivateFile,deletePrivateFile} from '../private-files.js';
import {app} from '../app.js';
import {pool} from '../db.js';
import {config} from '../config.js';
import {registerResidentContinuityTests} from './resident-continuity.cases.js';
import {registerPayerResponsibilityTests} from './payer-responsibility.cases.js';
if(config.NODE_ENV!=='test'||!new URL(config.DATABASE_URL).pathname.endsWith('/vernatun_test'))throw new Error('Isolated database required');
if(!/^qa_[a-f0-9]{20}$/.test(process.env.PRIVATE_FILES_TEST_RUN??''))throw new Error('Isolated private storage namespace required');
const seed=JSON.parse(await readFile('.local/test/demo-accounts.json','utf8'));
const server=app.listen(0,'127.0.0.1');let base='';
class Client{
 cookie='';csrf='';contextId='';
 async call(path:string,method='GET',body?:unknown){
  const r=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',Cookie:this.cookie,...(method!=='GET'?{'X-CSRF-Token':this.csrf}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(r.headers.getSetCookie().length)this.cookie=r.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');
  const data=r.status===204?null:await r.json();if(data?.csrf)this.csrf=data.csrf;return {status:r.status,data};
 }
 async login(key:string){
  await this.call('/auth/session');const a=seed.accounts[key];
  const result=await this.call('/auth/login','POST',{email:a.email,password:a.password});assert.equal(result.status,200);
  this.contextId=result.data.contexts.find((c:any)=>c.role_key===a.role).id;
  assert.equal((await this.call('/auth/context','POST',{id:this.contextId})).status,200);return this;
 }
 async bytes(path:string,method='GET',body?:Buffer){
  const r=await fetch(base+'/api'+path,{method,headers:{Cookie:this.cookie,'X-CSRF-Token':this.csrf,'Content-Type':'application/octet-stream'},
   ...(body?{body:new Uint8Array(body)}:{})});
  return {status:r.status,body:Buffer.from(await r.arrayBuffer()),type:r.headers.get('content-type'),cache:r.headers.get('cache-control')};
 }
}
let owner:Client,family:Client,admin:Client,manager:Client,ops:Client,buildingId:string,query:string;
const photoKeys:string[]=[];
before(async()=>{
 await new Promise<void>(r=>server.listening?r():server.on('listening',r));
 base='http://127.0.0.1:'+(server.address() as {port:number}).port;
 const schema=(await pool.query('SELECT current_schema() AS name')).rows[0].name;
 assert.match(schema,/^qa_[a-f0-9]{20}$/);assert.equal(schema,process.env.PRIVATE_FILES_TEST_RUN);
 await pool.query('DELETE FROM auth_rate_limits');
 owner=await new Client().login('unit_owner');family=await new Client().login('family');admin=await new Client().login('org_admin');ops=await new Client().login('manager');
 buildingId=seed.fixtures.ba;query='?buildingId='+buildingId;
});
after(async()=>{try{for(const key of photoKeys)await deletePrivateFile('photos',key)}finally{server.close();server.closeAllConnections();await pool.end()}});
const vehicle={title:'Car',body:'',plate:'TEST101',country:'AM',vehicleType:'car'};
test('migration numbering preserves GitHub 047 and resident schema is 048',async()=>{
 const names=(await pool.query('SELECT name FROM schema_migrations ORDER BY name')).rows.map(r=>r.name);
 assert.ok(names.includes('047_update_release_pipeline.sql'));
 assert.ok(names.includes('048_resident_superapp.sql'));
 assert.ok(!names.includes('047_resident_superapp.sql'));
 assert.ok(!names.includes('038_update_release_pipeline.sql'));
});
test('resident APIs require authenticated context and reject resident-selected foreign building',async()=>{
 assert.equal((await new Client().call('/resident/workspace')).status,401);
 assert.equal((await owner.call('/resident/workspace?buildingId='+randomUUID())).status,403);
 const contexts=await owner.call('/me/contexts');assert.equal(contexts.status,200);assert.ok(contexts.data.every((x:any)=>['unit_owner','renter','family'].includes(x.role)));
});
test('home is sourced from existing ledger and family has no finance disclosure',async()=>{
 const home=await owner.call('/resident/workspace');assert.equal(home.status,200);assert.equal(home.data.building.id,buildingId);
 assert.match(home.data.home.payableMinor,/^\d+$/);
 const f=await family.call('/resident/workspace');assert.equal(f.status,200);assert.equal(f.data.home.payableMinor,null);assert.equal(f.data.home.annualPaidMinor,null);
 assert.equal(home.data.integrations.find((x:any)=>x.key==='ble').status,'NOT_CONFIGURED');
});
test('profile persists privacy but cannot overwrite verified email or actor',async()=>{
 const initial=(await owner.call('/resident/workspace')).data.profile;
 const next={...initial,phone:'+374 00 000000',showName:true,showUnit:false,showPhone:false};
 assert.equal((await owner.call('/resident/profile','PUT',{...next,email:'changed@example.invalid'})).status,400);
 assert.equal((await owner.call('/resident/profile','PUT',next)).status,200);
 assert.equal((await owner.call('/resident/workspace')).data.profile.phone,next.phone);
});
test('vehicle CRUD is owner scoped, strict and versioned',async()=>{
 assert.equal((await owner.call('/resident/records/vehicles','POST',{...vehicle,organizationId:randomUUID()})).status,400);
 const created=await owner.call('/resident/records/vehicles','POST',vehicle);assert.equal(created.status,201);
 const row=created.data;
 assert.equal((await family.call('/resident/records/vehicles/'+row.id+'?version=1','DELETE')).status,404);
 assert.equal((await owner.call('/resident/records/vehicles/'+row.id,'PATCH',{...vehicle,title:'Changed',version:99})).status,409);
 assert.equal((await owner.call('/resident/records/vehicles/'+row.id,'PATCH',{...vehicle,title:'Changed',version:1})).status,200);
 assert.equal((await owner.call('/resident/records/vehicles/'+row.id+'?version=2','DELETE')).status,204);
 assert.equal((await owner.call('/resident/records/vehicles')).data.items.length,0);
});
test('only scoped administrators can enable opt-in product features and configure contacts',async()=>{
 const settings={directory:true,discussions:true,chat:true,marketplace:true,services:true};
 assert.equal((await owner.call('/resident/settings','PUT',settings)).status,403);
 assert.equal((await admin.call('/resident/settings'+query,'PUT',settings)).status,200);
 assert.equal((await owner.call('/resident/records/contacts','POST',{title:'Fake',body:'',category:'emergency',phone:'112'})).status,403);
 assert.equal((await admin.call('/resident/records/contacts'+query,'POST',{title:'Emergency',body:'Building configured contact',category:'emergency',phone:'112'})).status,201);
 const contacts=await owner.call('/resident/records/contacts');assert.equal(contacts.status,200);assert.equal(contacts.data.items[0].data.phone,'112');
 assert.equal((await admin.call('/resident/workspace?buildingId='+randomUUID())).status,404);
});
test('agreements have version-specific acceptance and required documents cannot be withdrawn',async()=>{
 const input={title:'Terms',body:'Version A',category:'terms',mandatory:true,withdrawable:false};
 const created=await admin.call('/resident/records/agreements'+query,'POST',input);assert.equal(created.status,201);
 const agreement=created.data;
 assert.equal((await owner.call('/resident/records/agreements/'+agreement.id+'/actions','POST',{action:'accept',version:1})).status,200);
 assert.equal((await owner.call('/resident/records/agreements')).data.items[0].accepted,true);
 assert.equal((await owner.call('/resident/records/agreements/'+agreement.id+'/actions','POST',{action:'withdraw',version:1})).status,403);
 const revised=await admin.call('/resident/records/agreements/'+agreement.id+query,'PATCH',{...input,body:'Version B',version:1});
 assert.equal(revised.status,200);assert.notEqual(revised.data.id,agreement.id);
 const current=(await owner.call('/resident/records/agreements')).data.items;
 assert.equal(current.length,1);assert.equal(current[0].accepted,false);
});
test('service subscriptions snapshot catalog price and cannot self-approve',async()=>{
 const service=await admin.call('/resident/records/services'+query,'POST',{title:'Window cleaning',body:'Manual scheduling after review',category:'cleaning',priceMinor:'50000',currency:'AMD'});
 assert.equal(service.status,201);
 const sub=await owner.call('/resident/records/subscriptions','POST',{title:'Cleaning request',body:'Please contact me',parentId:service.data.id,quantity:2});
 assert.equal(sub.status,201);assert.equal(sub.data.status,'requested');assert.equal(sub.data.data.priceMinor,'50000');
 assert.equal((await owner.call('/resident/records/subscriptions/'+sub.data.id+'/actions','POST',{action:'approve',version:1})).status,403);
 assert.equal((await admin.call('/resident/records/subscriptions/'+sub.data.id+'/actions'+query,'POST',{action:'approve',version:1})).data.status,'active');
 assert.equal((await owner.call('/resident/records/subscriptions/'+sub.data.id+'/actions','POST',{action:'cancel',version:2})).data.status,'cancel_requested');
});
test('conversations are private, messages idempotent, closed discussions cannot accept messages',async()=>{
 const thread=await owner.call('/resident/records/conversations','POST',{title:'Management question',body:'Hello'});assert.equal(thread.status,201);
 const path='/resident/records/conversations/'+thread.data.id+'/messages',clientId=randomUUID();
 assert.equal((await family.call(path)).status,404);
 const first=await owner.call(path,'POST',{body:'Message',clientId});assert.equal(first.status,201);
 const second=await owner.call(path,'POST',{body:'Message',clientId});assert.equal(second.data.id,first.data.id);
 assert.equal((await owner.call(path,'POST',{body:'Different',clientId})).status,409);
 assert.equal((await admin.call(path+query,'POST',{body:'Reply',clientId:randomUUID()})).status,201);
 assert.equal((await owner.call(path)).data.length,2);
 const topic=await owner.call('/resident/records/discussions','POST',{title:'Garden',body:'Let us discuss',category:'building'});assert.equal(topic.status,201);
 assert.equal((await family.call('/resident/records/discussions/'+topic.data.id+'/actions','POST',{action:'support',version:1})).status,200);
 assert.equal((await admin.call('/resident/records/discussions/'+topic.data.id+'/actions'+query,'POST',{action:'freeze',version:1})).status,200);
 assert.equal((await owner.call('/resident/records/discussions/'+topic.data.id+'/messages','POST',{body:'Late',clientId:randomUUID()})).status,409);
});
test('discussion-to-request preserves the selected message and does not create an agenda proposal',async()=>{
 const topic=await owner.call('/resident/records/discussions','POST',{title:'Repair the entrance light',body:'The entrance light is not working.',category:'building'});assert.equal(topic.status,201,JSON.stringify(topic.data));
 const message=await owner.call(`/resident/records/discussions/${topic.data.id}/messages`,'POST',{body:'It has been dark since yesterday.',clientId:randomUUID()});assert.equal(message.status,201,JSON.stringify(message.data));
 const key=randomUUID(),path=`/resident/records/discussions/${topic.data.id}/requests`;
 const input={key,sourceMessageId:message.data.id,subject:'Repair entrance light',description:'Please replace the failed lamp.'};
 const created=await owner.call(path,'POST',input);assert.equal(created.status,201,JSON.stringify(created.data));
 const replay=await owner.call(path,'POST',input);assert.equal(replay.status,201);assert.equal(replay.data.requestId,created.data.requestId);
 const links=await owner.call(`/resident/records/discussions/${topic.data.id}/lineage`);assert.equal(links.status,200,JSON.stringify(links.data));
 assert.equal(links.data.length,1);assert.equal(links.data[0].discussionId,topic.data.id);assert.equal(links.data[0].sourceMessageId,message.data.id);
 assert.equal(links.data[0].requestId,created.data.requestId);assert.equal(links.data[0].proposalId,null);assert.equal(links.data[0].meetingId,null);
 assert.equal(links.data[0].workOrderId,null);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM resident_agenda_proposals WHERE id IN (SELECT proposal_id FROM resident_discussion_lineage WHERE discussion_id=$1)',[topic.data.id])).rows[0].n,0);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM work_orders WHERE request_id=$1',[created.data.requestId])).rows[0].n,0);
});
test('marketplace requires explicit owner draft, submission and staff approval',async()=>{
 const payload={title:'Parking rent',body:'Contact through this app',saleType:'rent',priceMinor:'10000',currency:'AMD'};
 assert.equal((await family.call('/resident/records/listings','POST',payload)).status,403);
 const listing=await owner.call('/resident/records/listings','POST',payload);assert.equal(listing.status,201);assert.equal(listing.data.status,'draft');
 assert.equal((await family.call('/resident/records/listings')).data.items.length,0);
 assert.equal((await owner.call('/resident/records/listings/'+listing.data.id+'/actions','POST',{action:'submit',version:1})).data.status,'submitted');
 assert.equal((await admin.call('/resident/records/listings/'+listing.data.id+'/actions'+query,'POST',{action:'approve',version:2})).data.status,'active');
 assert.equal((await family.call('/resident/records/listings')).data.items.length,1);
 assert.equal((await family.call('/resident/records/listings/'+listing.data.id+'/messages')).status,405);
});
test('listing photos are sanitized, scoped, versioned and immutable after submission',async()=>{
 const payload={title:'Apartment with terrace',body:'Private viewing only',saleType:'sale',priceMinor:'22000000',currency:'USD',area:82.5,rooms:3,floor:4};
 const draft=(await owner.call('/resident/records/listings','POST',payload)).data;
 const path='/resident/listings/'+draft.id+'/photos';
 const photo=await sharp({create:{width:12,height:9,channels:3,background:'#cc9922'}}).png().withMetadata().toBuffer();
 const upload=async(c:Client,version:number,body=photo)=>fetch(base+'/api'+path+'?version='+version,{method:'POST',headers:{'Content-Type':'application/octet-stream',Cookie:c.cookie,'X-CSRF-Token':c.csrf},body:new Uint8Array(body)});
 assert.equal((await upload(family,1)).status,404);
 assert.equal((await upload(owner,1,Buffer.from('<svg/>'))).status,400);
 const added=await upload(owner,1);assert.equal(added.status,201);
 const row=await added.json();assert.equal(row.status,'draft');assert.equal(row.version,2);assert.equal(row.photos.length,1);
 const key=(await pool.query('SELECT storage_key FROM resident_listing_photos WHERE listing_id=$1',[draft.id])).rows[0].storage_key;photoKeys.push(key);
 assert.ok(!JSON.stringify(row).includes(key));
 const metadata=await sharp(await readPrivateFile('photos',key)).metadata();
 assert.equal(metadata.format,'jpeg');assert.equal(metadata.exif,undefined);
 const image=path+'/'+row.photos[0];
 assert.equal((await fetch(base+'/api'+image)).status,401);
 assert.equal((await family.call(image)).status,404);
 const bytes=await fetch(base+'/api'+image,{headers:{Cookie:owner.cookie}});
 assert.equal(bytes.status,200);assert.equal(bytes.headers.get('content-type'),'image/jpeg');
 assert.match(bytes.headers.get('cache-control')! ,/no-store/);
 assert.equal((await upload(owner,1)).status,409);
 // Detach uses the record version, never deletes bytes as part of the mutation.
 assert.equal((await owner.call(image+'?version=1','DELETE')).status,409);
 assert.equal((await owner.call(image+'?version=2','DELETE')).data.version,3);
 assert.ok((await readPrivateFile('photos',key)).length>0);
 assert.equal((await owner.call(image)).status,404);
 const again=await upload(owner,3);assert.equal(again.status,201);
 const updated=await again.json();
 photoKeys.push((await pool.query('SELECT storage_key FROM resident_listing_photos WHERE listing_id=$1',[draft.id])).rows[0].storage_key);
 const saved=await owner.call('/resident/records/listings/'+draft.id,'PATCH',{...payload,version:4,rooms:2});assert.equal(saved.status,200);
 assert.equal((await owner.call('/resident/records/listings/'+draft.id+'/actions','POST',{action:'submit',version:5})).data.status,'submitted');
 assert.equal((await upload(owner,6)).status,403);
 assert.equal((await admin.call('/resident/records/listings/'+draft.id+'/actions'+query,'POST',{action:'approve',version:6})).data.status,'active');
 const activeBytes=await fetch(base+'/api'+path+'/'+updated.photos[0],{headers:{Cookie:family.cookie}});assert.equal(activeBytes.status,200);await activeBytes.arrayBuffer();
 assert.equal((await family.call('/resident/records/listings?search=terrace&saleType=sale&currency=USD&minPrice=20000000&maxPrice=25000000&rooms=2')).data.items.length,1);
 assert.equal((await family.call('/resident/records/listings?currency=AMD&minPrice=20000000')).data.items.length,0);
 assert.equal((await family.call('/resident/records/listings?minPrice=1')).status,400);
 assert.equal((await family.call('/resident/records/listings?currency=USD&minPrice=5&maxPrice=1')).status,400);
 assert.equal((await family.call('/resident/records/listings?rooms=101')).status,400);
 // A photo id from a different listing cannot be substituted under this URL.
 const other=(await owner.call('/resident/records/listings','POST',payload)).data;
 assert.equal((await owner.call('/resident/listings/'+other.id+'/photos/'+updated.photos[0])).status,404);
});
test('concurrent same-version uploads serialize at the ten-photo limit',async()=>{
 const payload={title:'Concurrent photo limit',body:'Race-safe listing',saleType:'sale',priceMinor:'12000000',currency:'USD'};
 const listing=(await owner.call('/resident/records/listings','POST',payload)).data;
 const path='/resident/listings/'+listing.id+'/photos';
 const photo=await sharp({create:{width:12,height:9,channels:3,background:'#2277aa'}}).jpeg().toBuffer();
 const upload=async(version:number)=>fetch(base+'/api'+path+'?version='+version,{method:'POST',
  headers:{'Content-Type':'application/octet-stream',Cookie:owner.cookie,'X-CSRF-Token':owner.csrf},body:new Uint8Array(photo)});
 let version=1;
 for(let count=0;count<9;count++){
  const response=await upload(version);assert.equal(response.status,201);
  version=(await response.json()).version;
 }
 const [first,second]=await Promise.all([upload(version),upload(version)]);
 const responses=[first,second],successes=responses.filter(r=>r.status===201),stale=responses.filter(r=>r.status===409);
 assert.equal(successes.length,1);assert.equal(stale.length,1);
 assert.equal((await stale[0]!.json()).error,'stale_version');
 const saved=(await owner.call('/resident/records/listings/'+listing.id)).data;
 assert.equal(saved.status,'draft');assert.equal(saved.version,11);assert.equal(saved.photos.length,10);
 const rows=(await pool.query('SELECT storage_key FROM resident_listing_photos WHERE listing_id=$1',[listing.id])).rows;
 assert.equal(rows.length,10);
 photoKeys.push(...rows.map(r=>r.storage_key));
 for(const row of rows)assert.ok((await readPrivateFile('photos',row.storage_key)).length>0);
});
test('listing submit serializes with photo upload and removal',async()=>{
 const payload={title:'Concurrent listing change',body:'Race-safe listing',saleType:'rent',priceMinor:'90000',currency:'USD'};
 const photo=await sharp({create:{width:12,height:9,channels:3,background:'#44aa66'}}).jpeg().toBuffer();
 const upload=async(id:string,version:number)=>fetch(base+'/api/resident/listings/'+id+'/photos?version='+version,{method:'POST',
  headers:{'Content-Type':'application/octet-stream',Cookie:owner.cookie,'X-CSRF-Token':owner.csrf},body:new Uint8Array(photo)});
 const runUploadSubmitRace=async()=>{
  const listing=(await owner.call('/resident/records/listings','POST',payload)).data;
  const [photoResponse,submitResponse]=await Promise.all([
   upload(listing.id,1),
   owner.call('/resident/records/listings/'+listing.id+'/actions','POST',{action:'submit',version:1}),
  ]);
  const final=(await owner.call('/resident/records/listings/'+listing.id)).data;
  const count=Number((await pool.query('SELECT count(*) FROM resident_listing_photos WHERE listing_id=$1',[listing.id])).rows[0].count);
  if(photoResponse.status===201){
   assert.equal(submitResponse.status,409);assert.equal(submitResponse.data.error,'stale_version');
   assert.equal(final.status,'draft');assert.equal(final.version,2);assert.equal(count,1);
  }else{
   assert.equal(photoResponse.status,403);assert.equal(submitResponse.status,200);
   assert.equal(final.status,'submitted');assert.equal(final.version,2);assert.equal(count,0);
  }
  const rows=(await pool.query('SELECT storage_key FROM resident_listing_photos WHERE listing_id=$1',[listing.id])).rows;
  photoKeys.push(...rows.map(r=>r.storage_key));
 };
 await runUploadSubmitRace();

 const listing=(await owner.call('/resident/records/listings','POST',payload)).data;
 const added=await upload(listing.id,1);assert.equal(added.status,201);
 const addedRecord=await added.json();
 const photoId=addedRecord.photos[0] as string;
 const key=(await pool.query('SELECT storage_key FROM resident_listing_photos WHERE listing_id=$1',[listing.id])).rows[0].storage_key;
 photoKeys.push(key);
 const [removeResponse,submitResponse]=await Promise.all([
  owner.call('/resident/listings/'+listing.id+'/photos/'+photoId+'?version=2','DELETE'),
  owner.call('/resident/records/listings/'+listing.id+'/actions','POST',{action:'submit',version:2}),
 ]);
 const final=(await owner.call('/resident/records/listings/'+listing.id)).data;
 const count=Number((await pool.query('SELECT count(*) FROM resident_listing_photos WHERE listing_id=$1',[listing.id])).rows[0].count);
 if(removeResponse.status===200){
  assert.equal(submitResponse.status,409);assert.equal(submitResponse.data.error,'stale_version');
  assert.equal(final.status,'draft');assert.equal(final.version,3);assert.equal(count,0);
 }else{
  assert.equal(removeResponse.status,403);assert.equal(submitResponse.status,200);
  assert.equal(final.status,'submitted');assert.equal(final.version,3);assert.equal(count,1);
 }
 assert.ok((await readPrivateFile('photos',key)).length>0);
});
test('viewings persist explicit requests and only the listing owner can confirm or decline',async()=>{
 const listing=(await family.call('/resident/records/listings?search=terrace')).data.items[0];
 const payload={title:'Viewing request',body:'Please confirm',parentId:listing.id,viewingAt:new Date(Date.now()+3*86400000).toISOString(),viewingConsent:true};
 assert.equal((await family.call('/resident/records/conversations','POST',{...payload,viewingConsent:false})).status,400);
 assert.equal((await family.call('/resident/records/conversations','POST',{...payload,viewingAt:new Date(Date.now()-10000).toISOString()})).status,400);
 assert.equal((await family.call('/resident/records/conversations','POST',{...payload,viewingStatus:'confirmed'})).status,400);
 const response=await family.call('/resident/records/conversations','POST',payload);assert.equal(response.status,201);
 const request=response.data,path='/resident/records/conversations/'+request.id;
 assert.equal(request.data.viewingStatus,'requested');
 assert.ok(request.actions.includes('cancel_viewing'));assert.ok(!request.actions.includes('confirm_viewing'));
  const ownerId=seed.accounts.unit_owner.id,familyId=seed.accounts.family.id;
  const initialNotice=(await pool.query(`SELECT id,user_id,event_code,in_app_enabled FROM notifications
   WHERE entity_type='resident_conversation' AND entity_id=$1 ORDER BY created_at`,[request.id])).rows;
  assert.deepEqual(initialNotice.map((n:any)=>[n.user_id,n.event_code,n.in_app_enabled]),[[ownerId,'viewing_requested',true]]);
  const outbox=(await pool.query('SELECT state FROM notification_email_outbox WHERE notification_id=$1',[initialNotice[0].id])).rows[0];
  assert.equal(outbox.state,'pending_domain');
  await pool.query(`SELECT emit_notification($1,$2,'viewing_requested','resident_conversation',$3,$4)`,
   [ownerId,(await pool.query('SELECT organization_id FROM resident_product_records WHERE id=$1',[request.id])).rows[0].organization_id,
    request.id,`resident-viewing:${request.id}:viewing_requested`]);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM notifications WHERE user_id=$1 AND dedupe_key=$2`,
   [ownerId,`resident-viewing:${request.id}:viewing_requested`])).rows[0].n,1);
  const ownerInbox=await owner.call('/notifications'),ownerNotice=ownerInbox.data.find((n:any)=>n.id===initialNotice[0].id);
  assert.equal(ownerNotice.event_code,'viewing_requested');
  assert.ok(ownerNotice.targets.some((target:any)=>target.id===owner.contextId));
  assert.doesNotMatch(JSON.stringify(ownerNotice),/Viewing request|Please confirm|@/);
  const destination=await owner.call(`/notifications/${initialNotice[0].id}/destination?contextId=${owner.contextId}`);
  assert.equal(destination.data.destination,`/imtun/marketplace?recordKind=conversations&recordId=${request.id}`);
 assert.equal((await family.call(path+'/actions','POST',{action:'confirm_viewing',version:1})).status,403);
 assert.equal((await admin.call(path+'/actions'+query,'POST',{action:'confirm_viewing',version:1})).status,403);
 const stranger=await new Client().login('renter');
 assert.equal((await stranger.call(path)).status,404);
 assert.equal((await stranger.call(path+'/messages')).status,404);
 const owned=(await owner.call(path)).data;
 assert.ok(owned.actions.includes('confirm_viewing'));
 assert.equal(owned.data.phone,undefined);assert.equal(owned.data.email,undefined);
 const confirm=await owner.call(path+'/actions','POST',{action:'confirm_viewing',version:1});assert.equal(confirm.status,200);
 assert.equal(confirm.data.data.viewingStatus,'confirmed');
  const confirmed=(await pool.query(`SELECT event_code FROM notifications WHERE user_id=$1 AND entity_type='resident_conversation' AND entity_id=$2`,
   [familyId,request.id])).rows;
  assert.deepEqual(confirmed.map((n:any)=>n.event_code),['viewing_confirmed']);
  const confirmNoticeId=(await pool.query(`SELECT id FROM notifications WHERE user_id=$1 AND entity_type='resident_conversation' AND entity_id=$2 AND event_code='viewing_confirmed'`,
   [familyId,request.id])).rows[0].id;
  const familyNotice=(await family.call('/notifications')).data.find((n:any)=>n.id===confirmNoticeId);
  assert.ok(familyNotice.targets.some((target:any)=>target.id===family.contextId));
 assert.equal((await family.call(path)).data.data.viewingStatus,'confirmed');
 assert.equal((await family.call(path+'/actions','POST',{action:'cancel_viewing',version:1})).status,409);
 assert.equal((await family.call(path+'/actions','POST',{action:'cancel_viewing',version:2})).data.data.viewingStatus,'cancelled');
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM notifications WHERE user_id=$1 AND entity_type='resident_conversation' AND entity_id=$2 AND event_code='viewing_cancelled'`,
   [ownerId,request.id])).rows[0].n,1);
 assert.equal((await owner.call(path+'/actions','POST',{action:'confirm_viewing',version:3})).status,403);
 const next=(await family.call('/resident/records/conversations','POST',payload)).data;
 assert.equal((await owner.call('/resident/records/conversations/'+next.id+'/actions','POST',{action:'decline_viewing',version:1})).data.data.viewingStatus,'declined');
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM notifications WHERE user_id=$1 AND entity_type='resident_conversation' AND entity_id=$2 AND event_code='viewing_declined'`,
   [familyId,next.id])).rows[0].n,1);
  const prefs=(await owner.call('/notifications/preferences')).data;
  const categories={...prefs.categories,community:{email:false,in_app:false}};
  assert.equal((await owner.call('/notifications/preferences','PUT',{...prefs,categories})).status,200);
  try{
   const muted=(await family.call('/resident/records/conversations','POST',{...payload,title:'Private preference test'})).data;
   const suppressed=(await pool.query(`SELECT in_app_enabled FROM notifications WHERE user_id=$1 AND entity_type='resident_conversation' AND entity_id=$2 AND event_code='viewing_requested'`,
    [ownerId,muted.id])).rows[0];
   assert.equal(suppressed.in_app_enabled,false);
   assert.equal((await pool.query(`SELECT count(*)::int AS n FROM notification_email_outbox o JOIN notifications n ON n.id=o.notification_id
    WHERE n.user_id=$1 AND n.entity_type='resident_conversation' AND n.entity_id=$2`,[ownerId,muted.id])).rows[0].n,0);
  }finally{
   const current=(await owner.call('/notifications/preferences')).data;
   assert.equal((await owner.call('/notifications/preferences','PUT',{...current,categories:prefs.categories})).status,200);
  }
 const pending=(await family.call('/resident/records/conversations','POST',payload)).data;
 await owner.call('/resident/records/listings/'+listing.id+'/actions','POST',{action:'close',version:listing.version});
 assert.equal((await owner.call('/resident/records/conversations/'+pending.id+'/actions','POST',{action:'confirm_viewing',version:1})).status,403);
 assert.equal((await family.call('/resident/records/conversations/'+pending.id+'/actions','POST',{action:'cancel_viewing',version:1})).data.data.viewingStatus,'cancelled');
});
test('confirming a viewing serializes with cancellation and listing closure',async()=>{
 const payload={title:'Concurrent viewing listing',body:'Available for scheduled visits',saleType:'sale',priceMinor:'18000000',currency:'USD'};
 const makeRequest=async()=>{
  const listing=(await owner.call('/resident/records/listings','POST',payload)).data;
  const submitted=await owner.call('/resident/records/listings/'+listing.id+'/actions','POST',{action:'submit',version:1});
  assert.equal(submitted.status,200);
  const active=await admin.call('/resident/records/listings/'+listing.id+'/actions'+query,'POST',{action:'approve',version:2});
  assert.equal(active.status,200);
  const response=await family.call('/resident/records/conversations','POST',{
   title:'Concurrent viewing request',body:'Please confirm',parentId:listing.id,
   viewingAt:new Date(Date.now()+3*86400000).toISOString(),viewingConsent:true,
  });
  assert.equal(response.status,201);
  return {listingId:listing.id,conversationId:response.data.id};
 };
 const cancelled=await makeRequest(),conversationPath='/resident/records/conversations/'+cancelled.conversationId;
 const [confirm,cancel]=await Promise.all([
  owner.call(conversationPath+'/actions','POST',{action:'confirm_viewing',version:1}),
  family.call(conversationPath+'/actions','POST',{action:'cancel_viewing',version:1}),
 ]);
 const current=(await family.call(conversationPath)).data;
 if(confirm.status===200){
  assert.equal(cancel.status,409);assert.equal(cancel.data.error,'stale_version');
  assert.equal(current.version,2);assert.equal(current.data.viewingStatus,'confirmed');
 }else{
  assert.equal(confirm.status,403);assert.equal(cancel.status,200);
  assert.equal(current.version,2);assert.equal(current.data.viewingStatus,'cancelled');
 }

 const closing=await makeRequest(),closingPath='/resident/records/conversations/'+closing.conversationId;
 const [close,confirmAgainstClose]=await Promise.all([
  owner.call('/resident/records/listings/'+closing.listingId+'/actions','POST',{action:'close',version:3}),
  owner.call(closingPath+'/actions','POST',{action:'confirm_viewing',version:1}),
 ]);
 const closedListing=(await owner.call('/resident/records/listings/'+closing.listingId)).data;
 const closedRequest=(await family.call(closingPath)).data;
 assert.equal(close.status,200);assert.equal(closedListing.status,'closed');assert.equal(closedListing.version,4);
 if(confirmAgainstClose.status===200){
  // Confirmation linearized while the listing was still active; closure followed it.
  assert.equal(closedRequest.version,2);assert.equal(closedRequest.data.viewingStatus,'confirmed');
 }else{
  assert.equal(confirmAgainstClose.status,403);assert.equal(closedRequest.version,1);
  assert.equal(closedRequest.data.viewingStatus,'requested');
 }
});
test('disabling the building marketplace revokes listings, photos and linked inquiry access',async()=>{
 const listing=(await owner.call('/resident/records/listings?search=terrace')).data.items.find((r:any)=>r.photos.length>0);
 const settings={directory:true,discussions:true,chat:true,marketplace:false,services:true};
 assert.equal((await admin.call('/resident/settings'+query,'PUT',settings)).status,200);
 assert.equal((await family.call('/resident/records/listings')).status,403);
 assert.equal((await owner.call('/resident/records/listings/'+listing.id)).status,403);
 assert.equal((await owner.call('/resident/listings/'+listing.id+'/photos/'+listing.photos[0])).status,403);
 assert.equal((await family.call('/resident/records/conversations')).data.items.length,0);
 const inquiry=(await pool.query("SELECT id FROM resident_product_records WHERE kind='conversations' AND parent_id=$1 LIMIT 1",[listing.id])).rows[0];
 assert.equal((await family.call('/resident/records/conversations/'+inquiry.id)).status,404);
 await admin.call('/resident/settings'+query,'PUT',{...settings,marketplace:true});
});
test('mobile installation registration is idempotent and revocation invalidates its session only',async()=>{
 const other=await new Client().login('unit_owner');
 const input={title:'Test phone',body:'',installationId:randomUUID(),platform:'android',appVersion:'1.0',osVersion:'test',pushToken:'not-a-real-token'};
 const first=await other.call('/resident/records/mobile-devices','POST',input);assert.equal(first.status,201);
 assert.equal(first.data.data.pushToken,undefined);assert.equal(first.data.data.pushRegistered,true);
 const again=await other.call('/resident/records/mobile-devices','POST',input);assert.equal(again.data.id,first.data.id);
 assert.equal((await owner.call('/resident/records/mobile-devices/'+first.data.id+'?version=2','DELETE')).status,204);
 assert.equal((await other.call('/resident/workspace')).status,401);
 assert.equal((await owner.call('/resident/workspace')).status,200);
});
test('discussion conversion creates canonical common-area work once and exposes only a scoped summary',async()=>{
 const topic=(await owner.call('/resident/records/discussions','POST',{title:'Repair shared garden',body:'Repair the shared garden fence.',category:'building'})).data;
 const path='/resident/records/discussions/'+topic.id+'/actions';
 const category=(await ops.call('/operations/categories')).data.find((x:any)=>x.active);
 assert.ok(category);
 const body={action:'request',version:1,conversion:{confirmed:true,categoryId:category.id}};
 assert.equal((await ops.call(path+query,'POST',{action:'request',version:1})).status,400);
 assert.equal((await admin.call(path+query,'POST',body)).status,403);
 assert.equal((await owner.call(path,'POST',body)).status,403);
 assert.equal((await ops.call(path+query,'POST',{...body,version:99})).status,409);
 assert.equal((await ops.call(path+query,'POST',{...body,conversion:{confirmed:false,categoryId:category.id}})).status,400);
 const [first,replay]=await Promise.all([ops.call(path+query,'POST',body),ops.call(path+query,'POST',body)]);
 assert.equal(first.status,200,JSON.stringify(first.data));assert.equal(replay.status,200,JSON.stringify(replay.data));
 assert.equal(first.data.linkedRequestId,replay.data.linkedRequestId);
 const id=first.data.linkedRequestId;assert.ok(id);assert.equal(first.data.actions.includes('request'),false);
 const r=(await pool.query('SELECT * FROM resident_requests WHERE id=$1',[id])).rows[0];
 assert.equal(r.unit_id,null);assert.equal(r.author_user_id,null);assert.equal(r.source,'system');
 assert.equal(r.building_id,buildingId);assert.equal(r.source_discussion_id,topic.id);
 assert.equal((await pool.query('SELECT status FROM work_orders WHERE request_id=$1',[id])).rows[0].status,'queued');
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM request_sla_deadlines WHERE request_id=$1',[id])).rows[0].n,4);
 assert.equal((await ops.call('/requests/'+id)).status,200);
 assert.equal((await owner.call('/requests/'+id)).status,404);
 const link='/resident/discussions/'+topic.id+'/links/request';
 const summary=await family.call(link);assert.equal(summary.status,200);assert.equal(summary.data.id,id);
 assert.equal(summary.data.messages,undefined);assert.equal(summary.data.author_user_id,undefined);
 const list=(await owner.call('/resident/records/discussions')).data.items.find((x:any)=>x.id===topic.id);
 assert.equal(list.linkedRequestId,id);assert.equal(list.data.requestConversion.input,undefined);
 assert.equal((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action='resident.discussions.request' AND entity_id=$1",[topic.id])).rows[0].n,1);
 const retries=await Promise.all(Array.from({length:12},()=>ops.call(path+query,'POST',body)));
 assert.ok(retries.every(x=>x.status===200&&x.data.linkedRequestId===id));
 assert.equal((await ops.call(path+query,'POST',{...body,conversion:{confirmed:true,categoryId:randomUUID()}})).status,409);
 assert.equal((await ops.call(path+'?buildingId='+seed.fixtures.bb,'POST',body)).status,404);
});
test('agenda conversion uses an existing scoped draft, not topic support or a second voting engine',async()=>{
 const topic=(await owner.call('/resident/records/discussions','POST',{title:'Garden budget proposal',body:'Discuss next year garden budget.',category:'building'})).data;
 const meeting=(await ops.call('/governance/meetings','POST',{key:randomUUID(),buildingId,title:'Garden planning',description:'',
  startsAt:new Date(Date.now()+3600000).toISOString(),endsAt:new Date(Date.now()+7200000).toISOString(),quorumBasisPoints:5000,
  agenda:[{title:'Existing agenda',votingType:'yes_no',options:['yes','no','abstain'],passOption:'yes',passBasisPoints:5000}]}));
 assert.equal(meeting.status,201,JSON.stringify(meeting.data));
 const path='/resident/records/discussions/'+topic.id+'/actions';
 const body={action:'proposal',version:1,conversion:{confirmed:true,meetingId:meeting.data.id,meetingVersion:meeting.data.version,passBasisPoints:6000}};
 assert.equal((await family.call(path,'POST',body)).status,403);
 assert.equal((await ops.call(path+query,'POST',{...body,conversion:{...body.conversion,meetingId:randomUUID()}})).status,404);
 assert.equal((await ops.call(path+query,'POST',{...body,conversion:{...body.conversion,meetingVersion:99}})).status,409);
 const first=await ops.call(path+query,'POST',body);assert.equal(first.status,200,JSON.stringify(first.data));
 const replay=await ops.call(path+query,'POST',body);assert.equal(replay.status,200,JSON.stringify(replay.data));
 assert.deepEqual(first.data.data.proposalConversion,replay.data.data.proposalConversion);
 const detail=(await ops.call('/governance/meetings/'+meeting.data.id)).data;
 assert.equal(detail.status,'draft');assert.equal(detail.agenda.length,2);assert.equal(detail.version,meeting.data.version+1);
 const agenda=detail.agenda.find((x:any)=>x.source_discussion_id===topic.id);assert.ok(agenda);
 assert.equal(agenda.id,first.data.data.proposalConversion.id);assert.equal(agenda.pass_basis_points,6000);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM meeting_ballots WHERE agenda_item_id=$1',[agenda.id])).rows[0].n,0);
 assert.equal(detail.eligibility.length,0);
 const proposalPath='/resident/discussions/'+topic.id+'/links/proposal';
 assert.equal((await owner.call(proposalPath)).status,404);
 assert.equal((await family.call(proposalPath)).status,403);
 const before=(await owner.call('/resident/records/discussions')).data.items.find((x:any)=>x.id===topic.id);
 assert.equal(before.data.proposalConversion,undefined);
 // Unrelated actions must not disclose the draft receipt either.
 const supported=await owner.call(path,'POST',{action:'support',version:first.data.version});
 assert.equal(supported.status,200);assert.equal(supported.data.data.proposalConversion,undefined);
 const staffLink=await ops.call(proposalPath+query);
 assert.equal(staffLink.status,200);assert.equal(staffLink.data.id,agenda.id);assert.equal(staffLink.data.status,'draft');
 assert.equal((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action='resident.discussions.proposal' AND entity_id=$1",[topic.id])).rows[0].n,1);
 // Publishing uses the bumped meeting version; it is never implied by conversion.
 assert.equal((await ops.call('/governance/meetings/'+meeting.data.id+'/actions','POST',{key:randomUUID(),version:meeting.data.version,action:'publish'})).status,409);
 const published=await ops.call('/governance/meetings/'+meeting.data.id+'/actions','POST',{key:randomUUID(),version:detail.version,action:'publish'});
 assert.equal(published.status,200,JSON.stringify(published.data));
 const after=(await owner.call('/resident/records/discussions')).data.items.find((x:any)=>x.id===topic.id);
 assert.equal(after.data.proposalConversion.id,agenda.id);assert.equal(after.data.proposalConversion.meetingId,meeting.data.id);
 const link=await owner.call(proposalPath);assert.equal(link.status,200);assert.equal(link.data.id,agenda.id);assert.equal(link.data.status,'published');
 assert.equal(link.data.my_votes,undefined);
 assert.equal((await family.call(proposalPath)).status,403);
 assert.equal((await family.call('/resident/records/discussions')).data.items.find((x:any)=>x.id===topic.id).data.proposalConversion,undefined);
 assert.equal((await ops.call('/governance/meetings/'+meeting.data.id+'/actions','POST',{key:randomUUID(),version:published.data.version,action:'cancel',reason:'Published meeting cancelled'})).status,200);
 assert.equal((await owner.call(proposalPath)).status,200);
 assert.equal((await owner.call('/governance/meetings/'+meeting.data.id)).status,200);
 assert.ok((await owner.call('/governance/meetings')).data.some((x:any)=>x.id===meeting.data.id));
 assert.equal((await owner.call('/resident/records/discussions')).data.items.find((x:any)=>x.id===topic.id).data.proposalConversion.id,agenda.id);
 const other=(await owner.call('/resident/records/discussions','POST',{title:'Second garden proposal',body:'',category:'building'})).data;
 assert.equal((await ops.call('/resident/records/discussions/'+other.id+'/actions'+query,'POST',{...body,version:1})).status,409);
});
test('cancelling an unpublished draft never discloses its agenda through governance or discussion backlinks',async()=>{
 const topic=(await owner.call('/resident/records/discussions','POST',{title:'Unpublished confidential proposal',body:'',category:'building'})).data;
 const meeting=await ops.call('/governance/meetings','POST',{key:randomUUID(),buildingId,title:'Private draft meeting',description:'',
  startsAt:new Date(Date.now()+3600000).toISOString(),endsAt:new Date(Date.now()+7200000).toISOString(),quorumBasisPoints:5000,
  agenda:[{title:'Private draft agenda',votingType:'yes_no',options:['yes','no','abstain'],passOption:'yes',passBasisPoints:5000}]});
 assert.equal(meeting.status,201);
 const converted=await ops.call('/resident/records/discussions/'+topic.id+'/actions'+query,'POST',
  {action:'proposal',version:1,conversion:{confirmed:true,meetingId:meeting.data.id,meetingVersion:1,passBasisPoints:5000}});
 assert.equal(converted.status,200);
 const cancelled=await ops.call('/governance/meetings/'+meeting.data.id+'/actions','POST',
  {key:randomUUID(),version:2,action:'cancel',reason:'Cancel before publication'});
 assert.equal(cancelled.status,200);assert.equal(cancelled.data.was_published,false);
 assert.equal((await owner.call('/governance/meetings/'+meeting.data.id)).status,404);
 assert.ok(!(await owner.call('/governance/meetings')).data.some((x:any)=>x.id===meeting.data.id));
 const target='/resident/discussions/'+topic.id+'/links/proposal';
 assert.equal((await owner.call(target)).status,404);
 assert.equal((await ops.call(target+query)).status,200);
 assert.equal((await owner.call('/resident/records/discussions')).data.items.find((x:any)=>x.id===topic.id).data.proposalConversion,undefined);
 const action=await owner.call('/resident/records/discussions/'+topic.id+'/actions','POST',{action:'support',version:converted.data.version});
 assert.equal(action.status,200);assert.equal(action.data.data.proposalConversion,undefined);
});
test('conversion requires enabled modules, building opt-in, live permissions, and open discussions',async()=>{
 const topic=(await owner.call('/resident/records/discussions','POST',{title:'Conversion guard checks',body:'',category:'building'})).data;
 const path='/resident/records/discussions/'+topic.id+'/actions'+query;
 const category=(await ops.call('/operations/categories')).data.find((x:any)=>x.active);
 const body={action:'request',version:1,conversion:{confirmed:true,categoryId:category.id}};
 await pool.query('UPDATE resident_building_settings SET discussions=false WHERE building_id=$1',[buildingId]);
 try{assert.equal((await ops.call(path,'POST',body)).status,403)}finally{await pool.query('UPDATE resident_building_settings SET discussions=true WHERE building_id=$1',[buildingId])}
 await pool.query(`INSERT INTO iam_assignment_rules(assignment_id,permission_key,effect,reason,created_by)
  VALUES($1,'requests.assign','deny','QA discussion conversion',$2)`,[ops.contextId,seed.accounts.org_admin.id]);
 try{assert.equal((await ops.call(path,'POST',body)).status,403)}finally{await pool.query("DELETE FROM iam_assignment_rules WHERE assignment_id=$1 AND reason='QA discussion conversion'",[ops.contextId])}
 const org=(await pool.query('SELECT organization_id FROM resident_product_records WHERE id=$1',[topic.id])).rows[0].organization_id;
 for(const module of ['requests','community']){
  const original=(await pool.query('SELECT enabled,override_state FROM module_entitlements WHERE organization_id=$1 AND module=$2',[org,module])).rows[0];
  await pool.query("UPDATE module_entitlements SET enabled=false,override_state='disabled' WHERE organization_id=$1 AND module=$2",[org,module]);
  try{assert.equal((await ops.call(path,'POST',body)).status,403)}finally{await pool.query('UPDATE module_entitlements SET enabled=$3,override_state=$4 WHERE organization_id=$1 AND module=$2',[org,module,original.enabled,original.override_state])}
 }
 await pool.query('UPDATE organizations SET subscription_enforced=true WHERE id=$1',[org]);
 try{assert.equal((await ops.call(path,'POST',body)).status,403)}finally{await pool.query('UPDATE organizations SET subscription_enforced=false WHERE id=$1',[org])}
 assert.equal((await ops.call('/resident/settings'+query,'PUT',{directory:true,discussions:true,chat:true,marketplace:true,services:true})).status,403);
 assert.equal((await ops.call('/resident/records/conversations'+query)).status,403);
 await pool.query("UPDATE resident_product_records SET status='frozen' WHERE id=$1",[topic.id]);
 assert.equal((await ops.call(path,'POST',body)).status,409);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM resident_requests WHERE source_discussion_id=$1',[topic.id])).rows[0].n,0);
});
test('feedback is separate from property requests and contains no spoofed scope',async()=>{
 const count=(await pool.query('SELECT count(*) FROM resident_requests')).rows[0].count;
 assert.equal((await owner.call('/resident/records/feedback','POST',{title:'App idea',body:'Please improve search',category:'idea'})).status,201);
 assert.equal((await pool.query('SELECT count(*) FROM resident_requests')).rows[0].count,count);
 assert.ok((await pool.query("SELECT count(*) FROM audit_events WHERE action LIKE 'resident.%'")).rows[0].count>0);
});
test('Home contains only published building news, current weighted votes and permitted aggregates',async()=>{
 const org=(await pool.query('SELECT organization_id FROM buildings WHERE id=$1',[buildingId])).rows[0].organization_id;
 const published=randomUUID(),draft=randomUUID(),active=randomUUID(),future=randomUUID(),ended=randomUUID();
 await pool.query(`INSERT INTO announcements(id,organization_id,building_id,title,body,published,created_by)
  VALUES($1,$3,$4,'Home published','Visible',true,$5),($2,$3,$4,'Home draft','Private',false,$5)`,
  [published,draft,org,buildingId,seed.accounts.org_admin.id]);
 for(const [id,start,end] of [[active,-1,60],[future,60,120],[ended,-120,-60]]){
  await pool.query(`INSERT INTO meetings(id,organization_id,building_id,title,starts_at,ends_at,created_by,mode,status)
   VALUES($1,$2,$3,'Home voting',now()+$4::int*interval '1 minute',now()+$5::int*interval '1 minute',$6,'weighted','published')`,
   [id,org,buildingId,start,end,seed.accounts.org_admin.id]);
 }
 const response=await owner.call('/resident/workspace');assert.equal(response.status,200);
 const h=response.data.home.summary;
 assert.ok(h.announcements.some((r:any)=>r.id===published));
 assert.ok(!h.announcements.some((r:any)=>r.id===draft));
 assert.ok(h.activeVoting.some((r:any)=>r.id===active));
 assert.ok(!h.activeVoting.some((r:any)=>[future,ended].includes(r.id)));
 assert.ok(h.emergencyContacts.some((r:any)=>r.phone==='112'));
 assert.equal(h.elevatorStatus,'NOT_CONFIGURED');assert.equal(h.serviceInterruptions,'UNAVAILABLE');
 const noFinance=await family.call('/resident/workspace');assert.equal(noFinance.status,200);
 assert.equal(noFinance.data.home.summary.latestPayment,null);
 assert.equal(noFinance.data.home.summary.utilityStatus,'UNAVAILABLE');
 const entitlement=(await pool.query("SELECT override_state FROM module_entitlements WHERE organization_id=$1 AND module='community'",[org])).rows[0];
 try{
  await pool.query("UPDATE module_entitlements SET override_state='disabled' WHERE organization_id=$1 AND module='community'",[org]);
  const off=await owner.call('/resident/workspace');assert.equal(off.status,200);
  assert.equal(off.data.home.summary.announcements,null);assert.equal(off.data.home.summary.activeVoting,null);
  assert.equal(off.data.home.summary.unreadMessages,null);
 }finally{
  await pool.query("UPDATE module_entitlements SET override_state=$2 WHERE organization_id=$1 AND module='community'",[org,entitlement.override_state]);
 }
});
test('Home unread chats are participant scoped and read acknowledgement advances the watermark',async()=>{
 const thread=await owner.call('/resident/records/conversations','POST',{title:'Home private thread',body:''});
 assert.equal(thread.status,201);
 const baseline=(await owner.call('/resident/workspace')).data.home.summary.unreadMessages;
 const familyBaseline=(await family.call('/resident/workspace')).data.home.summary.unreadMessages;
 assert.equal((await admin.call('/resident/records/conversations/'+thread.data.id+'/messages'+query,'POST',{
  body:'Private staff answer',clientId:randomUUID()})).status,201);
 assert.equal((await owner.call('/resident/workspace')).data.home.summary.unreadMessages,baseline+1);
 assert.equal((await family.call('/resident/workspace')).data.home.summary.unreadMessages,familyBaseline);
 const latest=(await owner.call('/resident/records/conversations?recordId='+thread.data.id)).data.items[0];
 assert.equal((await owner.call('/resident/records/conversations/'+thread.data.id+'/actions','POST',{action:'read',version:latest.version})).status,200);
 assert.equal((await owner.call('/resident/workspace')).data.home.summary.unreadMessages,baseline);
});
test('search separates resident kinds and exact record links preserve ownership and feature gates',async()=>{
 const marker='SearchQA-'+randomUUID();
 const contact=await admin.call('/resident/records/contacts'+query,'POST',{title:marker,body:'Visible configured contact',category:'emergency',phone:'112'});
 assert.equal(contact.status,201);
 const found=await owner.call('/workspace-search?q='+marker);assert.equal(found.status,200);
 assert.ok(found.data.groups.find((g:any)=>g.kind==='resident:contacts')?.items.some((r:any)=>r.id===contact.data.id));
 const exact=await owner.call('/resident/records/contacts?recordId='+contact.data.id);
 assert.equal(exact.status,200);assert.equal(exact.data.items.length,1);assert.equal(exact.data.items[0].id,contact.data.id);
 assert.equal((await owner.call('/resident/records/contacts?recordId=invalid')).status,400);
 const privateVehicle=await owner.call('/resident/records/vehicles','POST',{...vehicle,title:marker+' private'});
 assert.equal(privateVehicle.status,201);
 assert.equal((await family.call('/resident/records/vehicles?recordId='+privateVehicle.data.id)).data.items.length,0);
 assert.equal((await owner.call('/resident/records/contacts?recordId='+privateVehicle.data.id)).data.items.length,0);
 const org=(await pool.query('SELECT organization_id FROM buildings WHERE id=$1',[buildingId])).rows[0].organization_id;
 try{
  await pool.query('UPDATE resident_building_settings SET chat=false WHERE building_id=$1',[buildingId]);
  assert.equal((await owner.call('/resident/records/conversations?recordId='+randomUUID())).status,403);
  const after=await owner.call('/workspace-search?q='+marker);
  assert.ok(!after.data.groups.some((g:any)=>g.kind==='resident:conversations'));
 }finally{
  await pool.query('UPDATE resident_building_settings SET chat=true WHERE building_id=$1 AND organization_id=$2',[buildingId,org]);
 }
});
registerResidentContinuityTests(()=>({owner,family,admin,manager:async()=>manager??(manager=await new Client().login('manager')),buildingId,query,seed}));
registerPayerResponsibilityTests(()=>({owner,family,admin,accountant:()=>new Client().login('accountant'),manager:()=>new Client().login('manager'),renter:()=>new Client().login('renter'),buildingId,query,seed}));
