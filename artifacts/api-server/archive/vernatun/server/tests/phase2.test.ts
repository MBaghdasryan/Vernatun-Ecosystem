import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {app} from '../app.js';
import {pool} from '../db.js';
import {config} from '../config.js';
import {runSlaEscalations} from '../sla-jobs.js';
import {storedFiles} from '../file-migration.js';
if(config.NODE_ENV!=='test'||!new URL(config.DATABASE_URL).pathname.endsWith('/vernatun_test'))throw new Error('Isolated database required');
const seeded=JSON.parse(await readFile('.local/test/demo-accounts.json','utf8'));
let base='';const server=app.listen(0,'127.0.0.1');
class Client{
 cookie='';csrf='';
 async call(path:string,method='GET',body?:unknown){
  const r=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',Cookie:this.cookie,...(method!=='GET'?{'X-CSRF-Token':this.csrf}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(r.headers.getSetCookie().length)this.cookie=r.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
  const data=r.status===204?null:await r.json();if(data?.csrf)this.csrf=data.csrf;return {status:r.status,data};
 }
 async login(key:string){const a=seeded.accounts[key];await this.call('/auth/session');const r=await this.call('/auth/login','POST',{email:a.email,password:a.password});assert.equal(r.status,200);if(!r.data.contextId){assert.equal((await this.call('/auth/context','POST',{id:r.data.contexts.find((x:any)=>x.role_key===a.role).id})).status,200)}return this}
 async detail(id:string){const r=await this.call('/requests/'+id);assert.equal(r.status,200);return r.data}
}
let desk:Client,mgr:Client,tech:Client,owner:Client,family:Client,security:Client,other:Client,category:string;
before(async()=>{
 await pool.query('DELETE FROM auth_rate_limits');
 await new Promise<void>(r=>server.listening?r():server.on('listening',r));base='http://127.0.0.1:'+(server.address() as {port:number}).port;
 desk=await new Client().login('dispatcher');mgr=await new Client().login('manager');tech=await new Client().login('technician');owner=await new Client().login('unit_owner');family=await new Client().login('family');security=await new Client().login('security');other=await new Client().login('second_org');
 category=(await desk.call('/operations/categories')).data.find((x:any)=>x.key==='plumbing').id;
});
after(async()=>{server.close();server.closeAllConnections();await pool.end()});
function input(extra={}){return {key:randomUUID(),unitId:seeded.fixtures.ua,subject:'Phase2 isolated request',description:'QA only',categoryId:category,priority:'high',...extra}}
async function create(extra={}){const r=await desk.call('/requests','POST',input(extra));assert.equal(r.status,201,JSON.stringify(r.data));return r.data}
async function step(actor:Client,id:string,action:string,extra={}){const r=await actor.detail(id);return actor.call('/requests/'+id+'/transition','POST',{key:randomUUID(),version:r.version,action,...extra})}
test('Phone intake is scoped, source-derived, atomic and idempotent; legacy creation still works',async()=>{
 const setup=await desk.call('/operations/setup?unitId='+seeded.fixtures.ua);assert.equal(setup.status,200);assert.ok(setup.data.residents.some((x:any)=>x.id===seeded.accounts.unit_owner.id));
 const b=input({reportedForUserId:seeded.accounts.unit_owner.id,technicianId:seeded.accounts.technician.id,contactMethod:'phone'}),first=await desk.call('/requests','POST',b),again=await desk.call('/requests','POST',b);
 assert.equal(first.status,201);assert.equal(again.data.id,first.data.id);assert.equal(first.data.source,'dispatcher_phone');assert.equal(first.data.status,'assigned');
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM work_orders WHERE request_id=$1',[first.data.id])).rows[0].n,1);
 assert.equal((await owner.call('/requests/'+first.data.id)).status,200);assert.equal((await family.call('/requests/'+first.data.id)).status,404);
 assert.equal((await desk.call('/requests','POST',{...b,subject:'Changed intent'})).status,409);
 assert.equal((await desk.call('/requests','POST',input({source:'resident_app'}))).status,400);
 assert.equal((await desk.call('/requests','POST',input({reportedForUserId:seeded.accounts.second_org.id}))).status,403);
 assert.equal((await owner.call('/requests','POST',input({reportedForUserId:seeded.accounts.family.id}))).status,403);
 assert.equal((await desk.call('/requests','POST',input({technicianId:seeded.accounts.family.id}))).status,403);
 assert.equal((await owner.call('/requests','POST',{unitId:seeded.fixtures.ua,subject:'Legacy resident creation'})).status,201);
 const unitOnly=await create();assert.equal((await owner.call('/requests/'+unitOnly.id)).status,200);
});
test('Categories and all five priority policies are configurable, tenant isolated and snapshot-based',async()=>{
 assert.equal((await mgr.call('/operations/sla-policies')).data.length,5);
 assert.equal((await desk.call('/operations/categories','POST',{key:'custom',name:'Custom'})).status,403);
 const custom=await mgr.call('/operations/categories','POST',{key:'custom',name:'Custom category'});assert.equal(custom.status,201);
 assert.equal((await mgr.call('/operations/categories/'+custom.data.id,'PATCH',{version:1,name:'Renamed',active:true})).status,200);
 assert.equal((await mgr.call('/operations/categories/'+custom.data.id,'PATCH',{version:1,name:'Stale',active:false})).status,409);
 const p={categoryId:custom.data.id,priority:'urgent',responseMinutes:2,assignmentMinutes:3,arrivalMinutes:4,resolutionMinutes:5,pauseResolution:true};
 assert.equal((await mgr.call('/operations/sla-policies','POST',p)).status,200);
 const r=await create({categoryId:custom.data.id,priority:'urgent'});
 const before=await desk.detail(r.id);assert.equal(before.sla.length,4);const resolution=before.sla.find((x:any)=>x.kind==='resolution');
 assert.equal(Math.round((Date.parse(resolution.due_at)-Date.parse(r.created_at))/60000),5);
 assert.equal((await mgr.call('/operations/sla-policies','POST',{...p,resolutionMinutes:20,version:1})).status,200);
 assert.equal((await desk.detail(r.id)).sla.find((x:any)=>x.kind==='resolution').due_at,resolution.due_at);
 assert.equal((await other.call('/operations/categories/'+custom.data.id,'PATCH',{version:2,name:'Cross tenant',active:false})).status,404);
 for(const priority of ['low','normal','high','urgent','emergency'])assert.equal((await desk.call('/requests','POST',input({priority}))).status,201);
 assert.equal((await desk.call('/requests','POST',input({priority:'fake'}))).status,400);
 assert.equal((await mgr.call('/operations/categories/'+custom.data.id,'PATCH',{version:2,name:'Renamed',active:false})).status,200);
 assert.equal((await desk.call('/requests','POST',input({categoryId:custom.data.id}))).status,404);
 // Retiring configuration must not erase evidence of an already committed write.
 const replayBody=input({categoryId:category}),committed=await desk.call('/requests','POST',replayBody);
 await pool.query('UPDATE request_categories SET active=false WHERE id=$1',[category]);
 assert.equal((await desk.call('/requests','POST',replayBody)).data.id,committed.data.id);
 await pool.query('UPDATE request_categories SET active=true WHERE id=$1',[category]);
});
test('Assigned technician accepts, pauses/resumes and records structured materials without financial changes',async()=>{
 const r=await create({technicianId:seeded.accounts.technician.id});
 assert.equal((await step(tech,r.id,'start')).status,409);
 const a={key:randomUUID(),version:2,action:'accept'},path='/requests/'+r.id+'/transition';
 assert.equal((await tech.call(path,'POST',a)).status,200);assert.equal((await tech.call(path,'POST',a)).status,200);
 assert.equal((await step(tech,r.id,'start')).status,200);
 assert.equal((await step(tech,r.id,'pause',{note:'Waiting for resident'})).status,200);
 assert.equal((await step(tech,r.id,'report',{note:'Repair completed'})).status,409);
 await pool.query("UPDATE work_orders SET paused_at=now()-interval '1 hour' WHERE request_id=$1",[r.id]);
 const paused=await tech.detail(r.id),due=paused.sla.find((x:any)=>x.kind==='resolution').due_at;
 assert.equal(paused.sla.find((x:any)=>x.kind==='resolution').paused,true);
 assert.equal((await step(tech,r.id,'resume')).status,200);
 const d=await tech.detail(r.id);assert.ok(Date.parse(d.sla.find((x:any)=>x.kind==='resolution').due_at)-Date.parse(due)>3599000);
 const before=(await pool.query('SELECT count(*)::int AS n FROM invoices')).rows[0].n;
 const material={key:randomUUID(),version:d.version,kind:'material',name:'Copper cable',quantity:2.5,unit:'m',unitCostMinor:2500,comment:'Installed'};
 const m=await tech.call('/requests/'+r.id+'/materials','POST',material);assert.equal(m.status,201);
 assert.equal((await tech.call('/requests/'+r.id+'/materials','POST',material)).data.id,m.data.id);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM invoices')).rows[0].n,before);
 assert.equal((await tech.detail(r.id)).materials.length,1);
 assert.equal((await desk.call('/requests/'+r.id+'/materials','POST',{...material,key:randomUUID()})).status,403);
 assert.equal((await step(tech,r.id,'cannot_perform',{reason:'other',note:''})).status,400);
 assert.equal((await step(tech,r.id,'cannot_perform',{reason:'missing_material'})).status,200);
 assert.equal((await step(tech,r.id,'start')).status,409);
 assert.equal((await step(desk,r.id,'assign',{technicianId:seeded.accounts.technician.id})).status,200);
 assert.equal((await tech.detail(r.id)).blocked_reason,null);
});
test('Visits require independent confirmations, rescheduling resets them and history survives cancellation',async()=>{
 const r=await create({technicianId:seeded.accounts.technician.id,reportedForUserId:seeded.accounts.unit_owner.id});
 const start=new Date(Date.now()+86400000).toISOString(),end=new Date(Date.now()+90000000).toISOString();
 const b={key:randomUUID(),version:r.version,startsAt:start,endsAt:end},url='/requests/'+r.id+'/visits';
 const v=await desk.call(url,'POST',b);assert.equal(v.status,200);assert.equal((await desk.call(url,'POST',b)).data.id,v.data.id);
 const schedule=await desk.call('/operations/visits?'+new URLSearchParams({from:start,to:end}));
 assert.equal(schedule.status,200);
 const scheduled=schedule.data.find((x:any)=>x.id===v.data.id);
 assert.equal(scheduled.technician_id,seeded.accounts.technician.id);
 assert.ok(scheduled.technician_name);assert.ok(scheduled.building_id);
 const isolated=await other.call('/operations/visits?'+new URLSearchParams({from:start,to:end}));
 assert.ok(isolated.status===403||isolated.status===200&&!isolated.data.some((x:any)=>x.id===v.data.id));
 const confirm=async(actor:Client)=>{const d=await actor.detail(r.id),visit=d.visits.find((x:any)=>x.id===v.data.id);return actor.call(url+'/'+visit.id,'POST',{key:randomUUID(),version:d.version,visitVersion:visit.version,action:'confirm'})};
 assert.equal((await confirm(desk)).status,403);assert.equal((await confirm(owner)).data.status,'proposed');assert.equal((await confirm(tech)).data.status,'confirmed');
 const d=await desk.detail(r.id),next=await desk.call(url,'POST',{...b,key:randomUUID(),version:d.version});assert.equal(next.status,200);
 assert.equal(next.data.resident_confirmed_at,null);assert.equal(next.data.technician_confirmed_at,null);
 const updated=await owner.detail(r.id);assert.equal(updated.visits.length,2);assert.equal(updated.visits.find((x:any)=>x.id===v.data.id).status,'superseded');
 assert.equal((await owner.call(url+'/'+next.data.id,'POST',{key:randomUUID(),version:updated.version,visitVersion:1,action:'cancel',note:'Not available'})).status,200);
 assert.ok((await desk.detail(r.id)).visitHistory.length>=6);
 const calendar=await owner.call('/operations/visits?from='+encodeURIComponent(start)+'&to='+encodeURIComponent(new Date(Date.now()+2*86400000).toISOString()));assert.equal(calendar.status,200);assert.ok(!calendar.data.some((x:any)=>x.request_id===r.id));
 await assert.rejects(pool.query('UPDATE visit_history SET action=action'));
});
test('SLA worker is concurrent/idempotent and never invents satisfaction or repeatedly notifies',async()=>{
 const r=await create();
 await pool.query("UPDATE request_sla_deadlines SET due_at=now()-interval '1 hour' WHERE request_id=$1",[r.id]);
 await Promise.all([runSlaEscalations(),runSlaEscalations()]);
 const count=async()=>(await pool.query('SELECT count(*)::int AS n FROM request_escalations WHERE request_id=$1',[r.id])).rows[0].n;
 assert.equal(await count(),4);await runSlaEscalations();assert.equal(await count(),4);
 const detail=await desk.detail(r.id);assert.equal(detail.overdue,true);assert.equal(detail.escalation_level,2);
 assert.ok(detail.sla.every((x:any)=>x.satisfied_at===null));
 assert.ok((await pool.query("SELECT id FROM notifications WHERE entity_id=$1 AND kind LIKE 'sla.%'",[r.id])).rowCount);
 await assert.rejects(pool.query('DELETE FROM request_escalations WHERE request_id=$1',[r.id]));
});
test('Equipment identifiers/QR never bypass permission; linked work uses the same workflow',async()=>{
 const asset=(await pool.query('SELECT * FROM assets WHERE organization_id=(SELECT organization_id FROM units WHERE id=$1) LIMIT 1',[seeded.fixtures.ua])).rows[0];
 const found=await tech.call('/assets/lookup?identifier='+asset.id);assert.equal(found.status,200);
 assert.equal((await owner.call('/assets/lookup?identifier='+asset.id)).status,403);
 assert.equal((await other.call('/assets/lookup?identifier='+asset.id)).status,403);
 const qr=await fetch(base+'/api/assets/'+asset.id+'/qr',{headers:{Cookie:tech.cookie}});assert.equal(qr.status,200);assert.equal(qr.headers.get('content-type'),'image/png');
 const created=await tech.call('/requests','POST',input({assetId:asset.id}));assert.equal(created.status,201);assert.equal(created.data.source,'system');assert.equal((await tech.detail(created.data.id)).technician_id,seeded.accounts.technician.id);
 const queue=await tech.call('/hayat/queue?priority=high&sort=due');assert.equal(queue.status,200);assert.ok(queue.data.rows.every((x:any)=>x.priority==='high'));
 assert.equal(queue.data.stats.reduce((n:number,x:any)=>n+x.count,0),queue.data.total);
 assert.equal((await tech.call('/hayat/queue?priority=invalid')).status,400);
});
test('Incident lifecycle, typed evidence and sanitized private attachments stay scoped and backed up',async()=>{
 const building=(await pool.query('SELECT building_id FROM units WHERE id=$1',[seeded.fixtures.ua])).rows[0].building_id;
 const b={key:randomUUID(),buildingId:building,description:'Isolated incident verification',severity:'critical'};
 const created=await security.call('/incidents','POST',b);assert.equal(created.status,201);const id=created.data.id;
 assert.equal((await security.call('/incidents','POST',b)).data.id,id);
 assert.equal((await owner.call('/incidents/'+id)).status,403);
 assert.equal((await security.call('/incidents/'+id+'/transition','POST',{key:randomUUID(),version:1,status:'closed',note:'Skip progression'})).status,409);
 for(const [n,s] of ['investigating','resolved','closed','open'].entries())assert.equal((await security.call('/incidents/'+id+'/transition','POST',{key:randomUUID(),version:n+1,status:s,note:'Verified lifecycle'})).status,200);
 const image=await sharp({create:{width:8,height:8,channels:3,background:'#ff680a'}}).png().toBuffer();
 const uploaded=await fetch(base+'/api/incidents/'+id+'/attachments',{method:'POST',headers:{Cookie:security.cookie,'X-CSRF-Token':security.csrf,'Content-Type':'application/octet-stream'},body:image});assert.equal(uploaded.status,201);const attachment:any=await uploaded.json();
 const read=await fetch(base+'/api/incident-attachments/'+attachment.id,{headers:{Cookie:mgr.cookie}});assert.equal(read.status,200);assert.equal(read.headers.get('content-type'),'image/jpeg');
 assert.equal((await fetch(base+'/api/incident-attachments/'+attachment.id,{headers:{Cookie:owner.cookie}})).status,403);
 const key=(await pool.query('SELECT storage_key FROM incident_attachments WHERE id=$1',[attachment.id])).rows[0].storage_key;assert.ok((await storedFiles()).some(x=>x.key===key));
 assert.equal((await security.call('/incidents/'+id)).data.history.length,5);await assert.rejects(pool.query('TRUNCATE incident_history'));
 const r=await create({technicianId:seeded.accounts.technician.id});
 const op=randomUUID(),url=base+'/api/requests/'+r.id+'/photos?photoType=before',headers={Cookie:tech.cookie,'X-CSRF-Token':tech.csrf,'Content-Type':'application/octet-stream','X-Operation-Key':op,'X-Work-Version':String(r.version)};
 const p=await fetch(url,{method:'POST',headers,body:image});assert.equal(p.status,201);const photo:any=await p.json();assert.equal(photo.photo_type,'before');
 assert.equal((await fetch(base+'/api/requests/'+r.id+'/photos?photoType=after',{method:'POST',headers,body:image})).status,409);
 assert.equal((await tech.detail(r.id)).photos[0].photo_type,'before');
});
