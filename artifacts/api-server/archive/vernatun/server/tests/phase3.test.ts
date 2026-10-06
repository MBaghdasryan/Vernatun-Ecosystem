import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {app} from '../app.js';
import {pool} from '../db.js';
import {config} from '../config.js';
import {contexts} from '../access.js';
import {runMaintenanceGeneration,finishMaintenance} from '../maintenance.js';
import {transaction} from '../operations.js';
if(config.NODE_ENV!=='test'||!new URL(config.DATABASE_URL).pathname.endsWith('/vernatun_test'))throw new Error('Isolated database required');
const seeded=JSON.parse(await readFile('.local/test/demo-accounts.json','utf8'));
const server=app.listen(0,'127.0.0.1');let base='';
class Client{
 cookie='';csrf='';
 async call(path:string,method='GET',body?:unknown){
  const r=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',Cookie:this.cookie,...(method==='GET'?{}:{'X-CSRF-Token':this.csrf})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(r.headers.getSetCookie().length)this.cookie=r.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
  const data=r.status===204?null:await r.json();if(data?.csrf)this.csrf=data.csrf;return {status:r.status,data};
 }
 async login(key:string){const a=seeded.accounts[key];await this.call('/auth/session');const r=await this.call('/auth/login','POST',{email:a.email,password:a.password});assert.equal(r.status,200);if(!r.data.contextId){const c=r.data.contexts.find((c:any)=>c.role_key===a.role);assert.equal((await this.call('/auth/context','POST',{id:c.id})).status,200)}return this}
 async detail(id:string){const r=await this.call('/requests/'+id);assert.equal(r.status,200,JSON.stringify(r.data));return r.data}
}
let manager:Client,tech:Client,owner:Client,other:Client,desk:Client,renter:Client,family:Client,category:string;
before(async()=>{
 await pool.query('DELETE FROM auth_rate_limits');
 await new Promise<void>(r=>server.listening?r():server.on('listening',r));base='http://127.0.0.1:'+(server.address() as {port:number}).port;
 manager=await new Client().login('manager');tech=await new Client().login('technician');owner=await new Client().login('unit_owner');other=await new Client().login('second_org');desk=await new Client().login('dispatcher');renter=await new Client().login('renter');family=await new Client().login('family');
 const foreignOrg=(await pool.query('SELECT organization_id FROM role_assignments WHERE user_id=$1 AND organization_id IS NOT NULL LIMIT 1',[seeded.accounts.second_org.id])).rows[0].organization_id;
 const foreignManager=(await pool.query("INSERT INTO role_assignments(user_id,organization_id,role_key) VALUES($1,$2,'manager') RETURNING id",[seeded.accounts.second_org.id,foreignOrg])).rows[0].id;
 assert.equal((await other.call('/auth/context','POST',{id:foreignManager})).status,200);
 category=(await manager.call('/operations/categories')).data.find((c:any)=>c.key==='plumbing').id;
});
after(async()=>{server.close();server.closeAllConnections();await pool.end()});
async function step(c:Client,id:string,action:string,body={}){
 const r=await c.detail(id);return c.call('/requests/'+id+'/transition','POST',{key:randomUUID(),version:r.version,action,...body});
}
test('Maintenance generation is inactive by default, scoped, concurrent-idempotent and uses real queued common-area WorkOrder',async()=>{
 const a=await manager.call('/assets','POST',{buildingId:seeded.fixtures.ba,name:'Phase3 isolated pump',serialNumber:'P3-'+randomUUID()});assert.equal(a.status,201);
 const p=await manager.call('/maintenance','POST',{assetId:a.data.id,title:'Pump scheduled service',dueOn:'2026-01-31',frequency:'monthly',categoryId:category,checklist:['Check pressure','Check seals']});assert.equal(p.status,201,JSON.stringify(p.data));assert.equal(p.data.active,false);
 const path='/maintenance/'+p.data.id;
 assert.equal((await manager.call(path+'/generate','POST',{})).status,409);
 assert.equal((await other.call(path+'/configure','POST',{version:1,active:true,automatic:false})).status,404);
 assert.equal((await manager.call(path+'/configure','POST',{version:1,active:true,automatic:false})).status,200);
 assert.equal((await manager.call(path+'/configure','POST',{version:1,active:true,automatic:false})).status,409);
 const generated=await Promise.all([manager.call(path+'/generate','POST',{}),manager.call(path+'/generate','POST',{})]);assert.ok(generated.every(r=>r.status===200),JSON.stringify(generated));assert.equal(generated[0].data.request_id,generated[1].data.request_id);
 const event=generated[0].data,id=event.request_id;
 let detail=await manager.detail(id);assert.equal(detail.source,'system');assert.equal(detail.unit_id,null);assert.equal(detail.author_user_id,null);assert.equal(detail.work_status,'queued');assert.equal(detail.history[0].actor,'System');
 assert.equal((await owner.call('/requests/'+id)).status,404);assert.equal((await other.call(path+'/events')).status,404);
 assert.equal((await step(manager,id,'assign',{technicianId:seeded.accounts.technician.id,checklist:[{text:'Do not replace plan checklist',done:false}]})).status,200);
 detail=await tech.detail(id);assert.equal(detail.checklist[0].text,'Check pressure');
 assert.equal((await step(tech,id,'accept')).status,200);assert.equal((await step(tech,id,'start')).status,200);
 const checks=detail.checklist.map((x:any)=>({...x,done:true}));
 assert.equal((await step(tech,id,'report',{note:'Pressure and seals verified',checklist:checks})).data.error,'maintenance_photo_required');
 const image=await sharp({create:{width:4,height:4,channels:3,background:'#ffffff'}}).png().toBuffer();detail=await tech.detail(id);
 const photo=await fetch(base+'/api/requests/'+id+'/photos?photoType=after',{method:'POST',headers:{Cookie:tech.cookie,'X-CSRF-Token':tech.csrf,'Content-Type':'application/octet-stream','X-Operation-Key':randomUUID(),'X-Work-Version':String(detail.version)},body:image});assert.equal(photo.status,201,JSON.stringify(await photo.json()));
 assert.equal((await step(tech,id,'report',{note:'Pressure and seals verified',checklist:checks})).status,200);
 assert.equal((await step(manager,id,'reject',{note:'Please verify valve as well'})).status,200);
 assert.equal((await step(tech,id,'report',{note:'Valve also verified and safe',checklist:checks})).status,200);
 assert.equal((await step(manager,id,'approve')).data.work_status,'closed');
 const history=(await manager.call(path+'/events')).data;assert.equal(history.length,1);assert.ok(history[0].completed_at);assert.equal(history[0].report,'Valve also verified and safe');assert.equal(history[0].photos.length,1);
 const plan=(await pool.query('SELECT due_on::text,cycle_no FROM maintenance_plans WHERE id=$1',[p.data.id])).rows[0];assert.equal(plan.due_on,'2026-02-28');assert.equal(plan.cycle_no,1);
 const replay=await manager.call(path+'/generate','POST',{cycleNo:0});assert.equal(replay.data.request_id,id);assert.equal(replay.data.replayed,true);
 const next=await manager.call(path+'/generate','POST',{});assert.equal(next.status,200);assert.notEqual(next.data.request_id,id);assert.equal((await manager.call(path+'/complete','POST',{report:'Cannot bypass verification'})).data.error,'work_order_verification_required');
});
test('Automatic recurring generation shares the same idempotent event lock; restored plans never auto-activate',async()=>{
 const a=(await manager.call('/assets','POST',{buildingId:seeded.fixtures.ba,name:'Automatic isolated asset',serialNumber:randomUUID()})).data;
 const p=(await manager.call('/maintenance','POST',{assetId:a.id,title:'One-off automatic work',dueOn:'2026-01-01',categoryId:category,active:true,automatic:true})).data;
 await Promise.all([runMaintenanceGeneration('2026-10-06'),runMaintenanceGeneration('2026-10-06')]);
 assert.equal((await pool.query('SELECT id FROM maintenance_events WHERE plan_id=$1',[p.id])).rowCount,1);
 const event=(await pool.query('SELECT * FROM maintenance_events WHERE plan_id=$1',[p.id])).rows[0];
 // The completion hook itself is idempotent and one-off plans cannot restart.
 await transaction(db=>finishMaintenance(db,event.request_id,seeded.accounts.manager.id));
 await transaction(db=>finishMaintenance(db,event.request_id,seeded.accounts.manager.id));
 const closed=(await pool.query('SELECT * FROM maintenance_plans WHERE id=$1',[p.id])).rows[0];
 assert.equal(closed.cycle_no,1);assert.equal(closed.active,false);assert.ok(closed.completed_at);
 assert.equal((await manager.call('/maintenance/'+p.id+'/configure','POST',{version:closed.version,active:true,automatic:true})).status,409);
 const future=(await manager.call('/maintenance','POST',{assetId:a.id,title:'Future isolated work',dueOn:'2099-01-01',categoryId:category,active:true})).data;
 assert.equal((await manager.call('/maintenance/'+future.id+'/generate','POST',{})).status,409);
});
test('Lease access is centralized, retains legacy renters and history, and follows expiry, extension, cancellation and future dates',async()=>{
 const orgId=(await pool.query('SELECT organization_id FROM units WHERE id=$1',[seeded.fixtures.ua])).rows[0].organization_id;
 const unit=(await pool.query('INSERT INTO units(organization_id,building_id,number,area) VALUES($1,$2,$3,42) RETURNING id',[orgId,seeded.fixtures.ba,'L-'+randomUUID()])).rows[0].id;
 const assignment=(await pool.query("INSERT INTO role_assignments(user_id,organization_id,building_id,unit_id,role_key) VALUES($1,$2,$3,$4,'renter') RETURNING id",[seeded.accounts.renter.id,orgId,seeded.fixtures.ba,unit])).rows[0].id;
 assert.ok((await contexts(seeded.accounts.renter.id)).some(c=>c.id===assignment));
 const l=await manager.call('/leases','POST',{unitId:unit,renterId:seeded.accounts.renter.id,startsOn:'2025-01-01',endsOn:'2025-12-31',amountMinor:'10000',currency:'AMD'});assert.equal(l.status,201,JSON.stringify(l.data));
 assert.ok(!(await contexts(seeded.accounts.renter.id)).some(c=>c.id===assignment));
 assert.equal((await renter.call('/auth/context','POST',{id:assignment})).status,403);
 assert.equal((await other.call('/leases/'+l.data.id+'/extend','POST',{version:1,endsOn:'2099-12-31'})).status,404);
 assert.equal((await manager.call('/leases/'+l.data.id+'/extend','POST',{version:1,endsOn:'2099-12-31'})).status,200);
 assert.ok((await contexts(seeded.accounts.renter.id)).some(c=>c.id===assignment));
 assert.equal((await renter.call('/auth/context','POST',{id:assignment})).status,200);
 assert.equal((await renter.call('/leases')).status,200);
 assert.equal((await manager.call('/leases/'+l.data.id+'/cancel','POST',{version:1,reason:'Stale operation'})).status,409);
 assert.equal((await manager.call('/leases/'+l.data.id+'/cancel','POST',{version:2,reason:'Tenant moved out'})).status,200);
 assert.equal((await renter.call('/requests','POST',{unitId:unit,subject:'Denied expired access'})).status,403);
 assert.equal((await pool.query('SELECT id FROM leases WHERE id=$1',[l.data.id])).rowCount,1);
 const future=await manager.call('/leases','POST',{unitId:unit,renterId:seeded.accounts.renter.id,startsOn:'2099-01-01',endsOn:'2099-12-31',amountMinor:'10000',currency:'AMD'});assert.equal(future.status,201);
 assert.ok(!(await contexts(seeded.accounts.renter.id)).some(c=>c.id===assignment));
});
test('Delegation expiration and resend are owner-scoped, rotate pending tokens, enforce recent authentication and revoke without erasing history',async()=>{
 const create=await owner.call('/delegations','POST',{email:'phase3-'+randomUUID()+'@example.test',phone:'+374 00 000000',expiresAt:new Date(Date.now()+86400000).toISOString(),permissions:['requests.own']});assert.equal(create.status,201,JSON.stringify(create.data));assert.equal(create.data.delivery,'local_only');
 const id=create.data.id;
 assert.equal((await family.call('/delegations/'+id+'/expiration','POST',{version:1,expiresAt:new Date(Date.now()+172800000).toISOString()})).status,403);
 assert.equal((await owner.call('/delegations/'+id+'/expiration','POST',{version:1,expiresAt:new Date(Date.now()+172800000).toISOString()})).status,200);
 assert.equal((await owner.call('/delegations/'+id+'/expiration','POST',{version:1,expiresAt:new Date(Date.now()+172800000).toISOString()})).status,409);
 const old=(await pool.query('SELECT token_hash FROM invitations WHERE delegation_id=$1',[id])).rows[0].token_hash;
 assert.equal((await owner.call('/delegations/'+id+'/resend','POST',{version:2})).status,200);
 assert.notEqual((await pool.query('SELECT token_hash FROM invitations WHERE delegation_id=$1',[id])).rows[0].token_hash,old);
 await pool.query("UPDATE session SET sess=jsonb_set(sess::jsonb,'{createdAt}',to_jsonb('2000-01-01T00:00:00Z'::text)) WHERE sess->'passport'->>'user'=$1",[seeded.accounts.unit_owner.id]);
 assert.equal((await owner.call('/delegations/'+id+'/revoke','POST',{})).data.error,'recent_authentication_required');
 assert.equal((await owner.call('/auth/reauthenticate','POST',{password:'not-the-password'})).status,401);
 assert.equal((await owner.call('/auth/reauthenticate','POST',{password:seeded.accounts.unit_owner.password})).status,200);
 assert.equal((await owner.call('/delegations/'+id+'/revoke','POST',{})).status,200);
 assert.ok((await pool.query('SELECT revoked_at FROM resident_delegations WHERE id=$1',[id])).rows[0].revoked_at);
 assert.equal((await owner.call('/delegations/'+id+'/resend','POST',{version:3})).status,409);
});
test('Notification destinations require explicit current assignment and do not union permissions; tech-proposed visits support resident alternatives',async()=>{
 const r=(await desk.call('/requests','POST',{key:randomUUID(),unitId:seeded.fixtures.ua,subject:'Phase3 visit fixture',categoryId:category,technicianId:seeded.accounts.technician.id})).data;
 const n=(await pool.query("INSERT INTO notifications(user_id,organization_id,kind,entity_id) VALUES($1,$2,'request.updated',$3) RETURNING id",[seeded.accounts.unit_owner.id,r.organization_id,r.id])).rows[0].id;
 const destination=await owner.call('/notifications/'+n+'/destination');assert.equal(destination.status,200);assert.equal(destination.data.destination,'/imtun/requests?requestId='+r.id);
 assert.equal((await other.call('/notifications/'+n+'/destination')).status,404);
 const unrelated=(await contexts(seeded.accounts.manager.id))[0].id;
 assert.equal((await owner.call('/notifications/'+n+'/destination?contextId='+unrelated)).status,403);
 let detail=await tech.detail(r.id);const visit=await tech.call('/requests/'+r.id+'/visits','POST',{key:randomUUID(),version:detail.version,startsAt:new Date(Date.now()+3600000).toISOString(),endsAt:new Date(Date.now()+7200000).toISOString()});assert.equal(visit.status,200,JSON.stringify(visit.data));
 detail=await owner.detail(r.id);
 const body={key:randomUUID(),version:detail.version,visitVersion:visit.data.version,action:'request_another_time',note:'Please visit tomorrow',suggestedStart:new Date(Date.now()+86400000).toISOString(),suggestedEnd:new Date(Date.now()+90000000).toISOString()};
 const moved=await owner.call('/requests/'+r.id+'/visits/'+visit.data.id,'POST',body);assert.equal(moved.status,200);assert.equal(moved.data.status,'cancelled');
 assert.equal((await owner.call('/requests/'+r.id+'/visits/'+visit.data.id,'POST',body)).status,200);
 assert.ok((await owner.detail(r.id)).history.some((h:any)=>h.action==='visit_request_another_time'));
 assert.equal((await pool.query("SELECT id FROM visit_history WHERE visit_id=$1 AND action='reschedule_requested'",[visit.data.id])).rowCount,1);
});
