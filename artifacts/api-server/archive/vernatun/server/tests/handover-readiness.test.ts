import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {app} from '../app.js';
import {pool} from '../db.js';
import {config} from '../config.js';
import {readinessStatus} from '../readiness-status.js';
if(config.NODE_ENV!=='test'||!new URL(config.DATABASE_URL).pathname.endsWith('/vernatun_test'))throw Error('Isolated database required');
const seeded=JSON.parse(await readFile('.local/test/demo-accounts.json','utf8'));
const server=app.listen(0,'127.0.0.1');let base='',dev:Client,contractor:Client,unit:any,floorId:string;
class Client{
 cookie='';csrf='';
 async call(path:string,method='GET',body?:unknown){
  const r=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',Cookie:this.cookie,'X-CSRF-Token':this.csrf},
   ...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(r.headers.getSetCookie().length)this.cookie=r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
  const data=await r.json();if(data?.csrf)this.csrf=data.csrf;return {status:r.status,data};
 }
 async login(name:string){
  const a=seeded.accounts[name];await this.call('/auth/session');
  const r=await this.call('/auth/login','POST',{email:a.email,password:a.password});assert.equal(r.status,200);
  assert.equal((await this.call('/auth/context','POST',{id:r.data.contexts.find((c:any)=>c.role_key===a.role).id})).status,200);return this;
 }
}
const list=()=>dev.call('/handover-readiness');
const mapping=(extra={})=>({key:randomUUID(),revision:unit.revision,floorId,...extra});
const assign=(b:any)=>dev.call('/handover-readiness/'+unit.id+'/floor','POST',b);
before(async()=>{
 await pool.query('DELETE FROM auth_rate_limits');
 await new Promise<void>(r=>server.listening?r():server.on('listening',r));base='http://127.0.0.1:'+(server.address() as any).port;
 dev=await new Client().login('developer');contractor=await new Client().login('contractor');
 const data=(await list()).data;unit=data.units.find((u:any)=>u.openDefects>0);assert.ok(unit);
});
after(async()=>{server.close();server.closeAllConnections();await pool.end()});
test('readiness never invents readiness from missing evidence',()=>{
 assert.equal(readinessStatus(null,0,0,0),'unknown');
 assert.equal(readinessStatus('ready',1,0,1),'defects');
 assert.equal(readinessStatus('operational',0,1,1),'inspection');
 assert.equal(readinessStatus('ready',0,0,0),'inspection');
 assert.equal(readinessStatus('inspection',0,0,1),'awaiting_confirmation');
 assert.equal(readinessStatus('ready',0,0,1),'ready');
 assert.equal(readinessStatus('operational',0,0,1),'operational');
});
test('scoped registry, create-floor reuse, idempotency and explicit unassigned units',async()=>{
 assert.equal(unit.floorId,null);assert.equal(unit.revision,0);assert.equal(unit.status,'defects');
 const b={key:randomUUID(),buildingId:unit.buildingId,entrance:'QA entrance',number:2};
 const a=await dev.call('/handover-floors','POST',b);assert.equal(a.status,201);floorId=a.data.id;
 assert.equal((await dev.call('/handover-floors','POST',b)).data.id,floorId);
 assert.equal((await dev.call('/handover-floors','POST',{...b,key:randomUUID()})).data.id,floorId);
 assert.equal((await dev.call('/handover-floors','POST',{...b,number:3})).status,409);
 const data=(await list()).data;assert.ok(data.canManage);assert.ok(data.canCreateFloor);
 assert.ok(data.floors.some((f:any)=>f.id===floorId&&f.number===2&&f.entrance===b.entrance));
});
test('mapping persists, repeats safely, rejects stale concurrent edits and supports unlink',async()=>{
 const b=mapping();const saved=await assign(b);assert.equal(saved.status,200);
 assert.equal((await assign(b)).data.revision,saved.data.revision);
 assert.equal((await assign(mapping())).status,409);
 unit=(await list()).data.units.find((u:any)=>u.id===unit.id);assert.equal(unit.floorId,floorId);
 const r=await Promise.all(Array.from({length:5},()=>assign(mapping({floorId:null}))));
 assert.equal(r.filter(x=>x.status===200).length,1);assert.equal(r.filter(x=>x.status===409).length,4);
 unit=(await list()).data.units.find((u:any)=>u.id===unit.id);assert.equal(unit.floorId,null);assert.equal(unit.revision,2);
 assert.equal((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action='handover.unit.floor' AND entity_id=$1",[unit.id])).rows[0].n,2);
});
test('foreign building/floor, forbidden role, CSRF and invalid values rejected',async()=>{
 const foreign=(await pool.query('SELECT id,organization_id FROM buildings WHERE organization_id<>(SELECT organization_id FROM units WHERE id=$1) LIMIT 1',[unit.id])).rows[0];
 const e=(await pool.query("INSERT INTO entrances(organization_id,building_id,name) VALUES($1,$2,'Other') RETURNING id",[foreign.organization_id,foreign.id])).rows[0];
 const f=(await pool.query('INSERT INTO floors(organization_id,building_id,entrance_id,number) VALUES($1,$2,$3,1) RETURNING id',[foreign.organization_id,foreign.id,e.id])).rows[0];
 assert.equal((await assign(mapping({floorId:f.id}))).status,404);
 assert.equal((await dev.call('/handover-floors','POST',{key:randomUUID(),buildingId:foreign.id,entrance:'No',number:1})).status,404);
 assert.equal((await contractor.call('/handover-readiness')).status,403);
 assert.equal((await contractor.call('/handover-readiness/'+unit.id+'/floor','POST',mapping())).status,403);
 const csrf=dev.csrf;dev.csrf='';try{assert.equal((await assign(mapping())).status,403)}finally{dev.csrf=csrf}
 assert.equal((await dev.call('/handover-floors','POST',{key:randomUUID(),buildingId:unit.buildingId,entrance:' ',number:999})).status,400);
 assert.ok(!(await list()).data.floors.some((x:any)=>x.id===f.id));
});
test('unit-bound manager sees own unit and cannot create shared floors',async()=>{
 const a=(await pool.query("SELECT * FROM role_assignments WHERE user_id=$1 AND role_key='developer' AND active LIMIT 1",[seeded.accounts.developer.id])).rows[0];
 await pool.query('UPDATE role_assignments SET building_id=$2,unit_id=$3 WHERE id=$1',[a.id,unit.buildingId,unit.id]);
 try{
  const r=await list();assert.equal(r.status,200);assert.equal(r.data.units.length,1);assert.equal(r.data.canCreateFloor,false);
  assert.equal((await dev.call('/handover-floors','POST',{key:randomUUID(),buildingId:unit.buildingId,entrance:'No',number:9})).status,403);
  assert.equal((await assign(mapping())).status,200);
 }finally{await pool.query('UPDATE role_assignments SET building_id=$2,unit_id=$3 WHERE id=$1',[a.id,a.building_id,a.unit_id])}
});
test('API derives defect, inspection and handover state without altering workflow',async()=>{
 await pool.query("UPDATE defects SET status='accepted' WHERE unit_id=$1",[unit.id]);
 let h=(await pool.query('SELECT id FROM handover_cases WHERE unit_id=$1',[unit.id])).rows[0];
 if(!h)h=(await pool.query('INSERT INTO handover_cases(organization_id,unit_id,created_by) SELECT organization_id,id,$2 FROM units WHERE id=$1 RETURNING id',[unit.id,seeded.accounts.developer.id])).rows[0];
 await pool.query('DELETE FROM inspections WHERE handover_id=$1',[h.id]);
 await pool.query("UPDATE handover_cases SET status='inspection' WHERE id=$1",[h.id]);
 const status=async()=>((await list()).data.units.find((u:any)=>u.id===unit.id)).status;
 assert.equal(await status(),'inspection');
 await pool.query(`INSERT INTO inspections(handover_id,scheduled_at,checklist,completed_at,completed_by) VALUES($1,now(),'[]',now(),$2)`,[h.id,seeded.accounts.developer.id]);
 assert.equal(await status(),'awaiting_confirmation');
 await pool.query("UPDATE handover_cases SET status='ready' WHERE id=$1",[h.id]);assert.equal(await status(),'ready');
 await pool.query("UPDATE handover_cases SET status='operational' WHERE id=$1",[h.id]);assert.equal(await status(),'operational');
 await pool.query("INSERT INTO inspections(handover_id,scheduled_at,checklist) VALUES($1,now(),'[]')",[h.id]);assert.equal(await status(),'inspection');
 assert.equal((await pool.query('SELECT status FROM handover_cases WHERE id=$1',[h.id])).rows[0].status,'operational');
});
