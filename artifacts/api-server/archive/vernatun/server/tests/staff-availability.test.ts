import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {app} from '../app.js';
import {pool} from '../db.js';
import {config} from '../config.js';
import {intervalCovered} from '../availability-logic.js';
import {assertOpenApiOperation} from './openapi-contract-assertions.js';
if(config.NODE_ENV!=='test'||!new URL(config.DATABASE_URL).pathname.endsWith('/vernatun_test'))throw Error('Isolated database required');
const seeded=JSON.parse(await readFile('.local/test/demo-accounts.json','utf8'));
let base='';const server=app.listen(0,'127.0.0.1');
class Client{
 cookie='';csrf='';
 async call(path:string,method='GET',body?:unknown){
  const r=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',Cookie:this.cookie,...(method!=='GET'?{'X-CSRF-Token':this.csrf}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(r.headers.getSetCookie().length)this.cookie=r.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
  const data=await r.json();if(data?.csrf)this.csrf=data.csrf;return {status:r.status,data};
 }
 async login(key:string){
  const a=seeded.accounts[key];await this.call('/auth/session');
  const r=await this.call('/auth/login','POST',{email:a.email,password:a.password});assert.equal(r.status,200);
  if(!r.data.contextId)assert.equal((await this.call('/auth/context','POST',{id:r.data.contexts.find((x:any)=>x.role_key===a.role).id})).status,200);
  return this;
 }
}
let desk:Client,tech:Client,other:Client,owner:Client;
const from=new Date(Date.now()+864e5).toISOString(),to=new Date(Date.now()+864e5+36e5).toISOString();
const input=(extra={})=>({key:randomUUID(),unitId:seeded.fixtures.ua,technicianId:seeded.accounts.technician.id,scope:'building',kind:'shift',startsAt:from,endsAt:to,...extra});
const query=()=>'/operations/availability?'+new URLSearchParams({unitId:seeded.fixtures.ua,from,to});
before(async()=>{
 await pool.query('DELETE FROM auth_rate_limits');
 await new Promise<void>(r=>server.listening?r():server.on('listening',r));base='http://127.0.0.1:'+(server.address() as {port:number}).port;
 desk=await new Client().login('dispatcher');tech=await new Client().login('technician');other=await new Client().login('second_org');owner=await new Client().login('unit_owner');
});
after(async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await pool.end()});
test('Availability and visit planning routes expose scoped request and response contracts',()=>{
 assertOpenApiOperation('/operations/availability/options','get',{responseStatus:'200'});
 assertOpenApiOperation('/operations/availability','get',{responseStatus:'200'});
 assertOpenApiOperation('/operations/availability','post',{requestSchema:'AvailabilityCreate',responseStatus:'201',responseSchema:'AvailabilityBlock'});
 assertOpenApiOperation('/operations/availability/{id}/change','post',{requestSchema:'AvailabilityChange',responseStatus:'200',responseSchema:'AvailabilityBlock'});
 assertOpenApiOperation('/operations/visits','get',{responseStatus:'200'});
});
test('coverage merges adjacent shifts, never gaps or absent planning',()=>{
 assert.equal(intervalCovered(0,100,[]),false);
 assert.equal(intervalCovered(0,100,[{starts_at:new Date(0),ends_at:new Date(50)},{starts_at:new Date(50),ends_at:new Date(100)}]),true);
 assert.equal(intervalCovered(0,100,[{starts_at:new Date(0),ends_at:new Date(49)},{starts_at:new Date(50),ends_at:new Date(100)}]),false);
});
test('unknown becomes available in scope; idempotent creation, absence and cancellation restore it',async()=>{
 let state=await desk.call(query());assert.equal(state.status,200,JSON.stringify(state.data));
 assert.equal(state.data.people.find((p:any)=>p.id===seeded.accounts.technician.id).status,'unknown');
 const b=input(),first=await desk.call('/operations/availability','POST',b);assert.equal(first.status,201,JSON.stringify(first.data));
 assert.equal((await desk.call('/operations/availability','POST',b)).data.id,first.data.id);
 assert.equal((await desk.call(query())).data.people.find((p:any)=>p.id===b.technicianId).status,'available_in_scope');
 const absence=await desk.call('/operations/availability','POST',input({kind:'absence'}));assert.equal(absence.status,201);
 assert.equal((await desk.call(query())).data.people.find((p:any)=>p.id===b.technicianId).status,'absent');
 const cancel={key:randomUUID(),version:absence.data.version,action:'cancel'};
 assert.equal((await desk.call('/operations/availability/'+absence.data.id+'/change','POST',cancel)).status,200);
 assert.equal((await desk.call('/operations/availability/'+absence.data.id+'/change','POST',cancel)).status,200);
 assert.equal((await desk.call(query())).data.people.find((p:any)=>p.id===b.technicianId).status,'available_in_scope');
 const persisted=(await pool.query('SELECT cancelled_at FROM staff_availability WHERE id=$1',[absence.data.id])).rows[0];
 assert.ok(persisted.cancelled_at);
});
test('edit uses compare-and-swap and keeps audit evidence; concurrent edits cannot lose updates',async()=>{
 const created=await desk.call('/operations/availability','POST',input({kind:'absence'}));assert.equal(created.status,201);
 const change={key:randomUUID(),action:'update',version:1,kind:'shift',startsAt:from,endsAt:to};
 const changed=await desk.call('/operations/availability/'+created.data.id+'/change','POST',change);
 assert.equal(changed.status,200);assert.equal(changed.data.version,2);
 assert.equal((await desk.call('/operations/availability/'+created.data.id+'/change','POST',change)).data.version,2);
 assert.equal((await desk.call('/operations/availability/'+created.data.id+'/change','POST',{...change,key:randomUUID()})).status,409);
 const outcomes=await Promise.all(Array.from({length:12},()=>desk.call('/operations/availability/'+created.data.id+'/change','POST',{key:randomUUID(),action:'cancel',version:2})));
 assert.equal(outcomes.filter(x=>x.status===200).length,1);assert.equal(outcomes.filter(x=>x.status===409).length,11);
 const audit=(await pool.query("SELECT details FROM audit_events WHERE entity_type='staff_availability' AND entity_id=$1 AND action='availability.update'",[created.data.id])).rows;
 assert.equal(audit.length,1);assert.equal(audit[0].details.before.kind,'absence');assert.equal(audit[0].details.after.kind,'shift');
});
test('tenant, role, eligibility, invalid dates and technician-only reads are enforced',async()=>{
 assert.equal((await owner.call(query())).status,403);
 const outsider=await other.call(query());assert.ok([403,404].includes(outsider.status));
 const state=await tech.call(query());assert.equal(state.status,200);
 assert.ok(state.data.people.every((p:any)=>p.id===seeded.accounts.technician.id));
 assert.equal(state.data.canManage,false);
 assert.equal((await tech.call('/operations/availability','POST',input())).status,403);
 assert.equal((await desk.call('/operations/availability','POST',input({technicianId:seeded.accounts.unit_owner.id}))).status,403);
 assert.equal((await desk.call('/operations/availability','POST',input({endsAt:from}))).status,400);
 assert.equal((await desk.call('/operations/availability','POST',input({endsAt:new Date(Date.parse(from)+25*36e5).toISOString()}))).status,400);
 assert.equal((await desk.call('/operations/availability','POST',input({kind:'absence',endsAt:new Date(Date.parse(from)+63*864e5).toISOString()}))).status,400);
 const options=await desk.call('/operations/availability/options');assert.equal(options.status,200);
 assert.ok(options.data.some((u:any)=>u.id===seeded.fixtures.ua));
});
test('active visits block availability; cancellation stops counting the visit',async()=>{
 const request=(await pool.query('SELECT r.id,r.version FROM resident_requests r JOIN work_orders w ON w.request_id=r.id WHERE r.unit_id=$1 AND w.technician_id=$2 AND r.status<>$3 LIMIT 1',[seeded.fixtures.ua,seeded.accounts.technician.id,'closed'])).rows[0];
 assert.ok(request);
 const planned=await desk.call('/requests/'+request.id+'/visits','POST',{key:randomUUID(),version:request.version,startsAt:from,endsAt:to});
 assert.equal(planned.status,200,JSON.stringify(planned.data));
 const busy=(await desk.call(query())).data.people.find((p:any)=>p.id===seeded.accounts.technician.id);
 assert.equal(busy.status,'busy');assert.ok(busy.visitCount>0);
 // Fixture transition only; visit lifecycle itself is covered by phase2.
 await pool.query("UPDATE request_visits SET status='cancelled' WHERE request_id=$1",[request.id]);
 assert.equal((await desk.call(query())).data.people.find((p:any)=>p.id===seeded.accounts.technician.id).status,'available_in_scope');
});
test('unit-bound manager cannot edit building plans; role expiry prevents claiming or extending availability',async()=>{
 const row=(await desk.call(query())).data.blocks.find((b:any)=>b.unit_id===null);
 const actor=(await pool.query("SELECT id,unit_id,building_id FROM role_assignments WHERE user_id=$1 AND role_key='dispatcher'",[seeded.accounts.dispatcher.id])).rows[0];
 await pool.query('UPDATE role_assignments SET unit_id=$2,building_id=(SELECT building_id FROM units WHERE id=$2) WHERE id=$1',[actor.id,seeded.fixtures.ua]);
 try{
  const state=await desk.call(query());assert.equal(state.status,200);
  assert.equal(state.data.canManageBuilding,false);assert.equal(state.data.blocks.find((b:any)=>b.id===row.id).canEdit,false);
  assert.equal((await desk.call('/operations/availability','POST',input())).status,403);
  assert.equal((await desk.call('/operations/availability','POST',input({scope:'unit'}))).status,201);
  assert.equal((await desk.call('/operations/availability/'+row.id+'/change','POST',{key:randomUUID(),action:'cancel',version:row.version})).status,404);
 }finally{await pool.query('UPDATE role_assignments SET unit_id=$2,building_id=$3 WHERE id=$1',[actor.id,actor.unit_id,actor.building_id])}
 const assignment=(await pool.query("SELECT id,expires_at FROM role_assignments WHERE user_id=$1 AND role_key='technician'",[seeded.accounts.technician.id])).rows[0];
 await pool.query('UPDATE role_assignments SET expires_at=$2 WHERE id=$1',[assignment.id,new Date(Date.parse(from)+1800e3)]);
 try{
  assert.equal((await desk.call(query())).data.people.find((p:any)=>p.id===seeded.accounts.technician.id).status,'unknown');
  assert.equal((await desk.call('/operations/availability','POST',input())).status,403);
  assert.equal((await desk.call('/operations/availability/'+row.id+'/change','POST',{key:randomUUID(),version:row.version,action:'update',kind:'shift',startsAt:from,endsAt:to})).status,403);
 }finally{await pool.query('UPDATE role_assignments SET expires_at=$2 WHERE id=$1',[assignment.id,assignment.expires_at])}
});
