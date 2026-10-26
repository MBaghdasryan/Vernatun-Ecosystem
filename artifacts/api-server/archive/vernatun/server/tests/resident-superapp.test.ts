import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {app} from '../app.js';
import {pool} from '../db.js';
import {config} from '../config.js';
if(config.NODE_ENV!=='test'||!new URL(config.DATABASE_URL).pathname.endsWith('/vernatun_test'))throw new Error('Isolated database required');
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
}
let owner:Client,family:Client,admin:Client,buildingId:string,query:string;
before(async()=>{
 await new Promise<void>(r=>server.listening?r():server.on('listening',r));
 base='http://127.0.0.1:'+(server.address() as {port:number}).port;
 await pool.query('DELETE FROM auth_rate_limits');
 owner=await new Client().login('unit_owner');family=await new Client().login('family');admin=await new Client().login('org_admin');
 buildingId=seed.fixtures.ba;query='?buildingId='+buildingId;
});
after(async()=>{server.close();server.closeAllConnections();await pool.end()});
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
