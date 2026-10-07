import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {readFile} from 'node:fs/promises';
import {app} from '../app.js';
import {pool} from '../db.js';
import {config} from '../config.js';
if(config.NODE_ENV!=='test'||!new URL(config.DATABASE_URL).pathname.endsWith('/vernatun_test'))throw new Error('Isolated test DB required');
const seeded=JSON.parse(await readFile('.local/test/demo-accounts.json','utf8'));
const server=app.listen(0,'127.0.0.1');
let base='',contractor:Client,developer:Client,id:string,original:any,key:string;
class Client{
 cookie='';csrf='';context:any;
 async call(path:string,method='GET',body?:unknown){
  const r=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',Cookie:this.cookie,'X-CSRF-Token':this.csrf},...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(r.headers.getSetCookie().length)this.cookie=r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
  const data=r.status===204?null:await r.json();if(data?.csrf)this.csrf=data.csrf;return {status:r.status,data};
 }
 async login(name:string){
  const a=seeded.accounts[name];await this.call('/auth/session');
  const r=await this.call('/auth/login','POST',{email:a.email,password:a.password});assert.equal(r.status,200);
  this.context=r.data.contexts.find((c:any)=>c.role_key===a.role);
  assert.equal((await this.call('/auth/context','POST',{id:this.context.id})).status,200);return this;
 }
}
const collaboration=()=>'/defects/'+id+'/collaboration';
const messages=()=>'/defects/'+id+'/messages';
before(async()=>{
 await pool.query('DELETE FROM auth_rate_limits');
 await new Promise<void>(r=>server.listening?r():server.on('listening',r));base='http://127.0.0.1:'+(server.address() as {port:number}).port;
 contractor=await new Client().login('contractor');developer=await new Client().login('developer');
 const list=await contractor.call('/defects');assert.equal(list.status,200);id=list.data[0].id;
 original=(await pool.query('SELECT * FROM defects WHERE id=$1',[id])).rows[0];
});
after(async()=>{server.close();server.closeAllConnections();await pool.end()});
test('contractor/developer clarification persists, is idempotent, audited and does not change workflow',async()=>{
 const empty=await contractor.call(collaboration());assert.equal(empty.status,200);assert.equal(empty.data.canWrite,true);
 key=randomUUID();const body={key,body:'Please clarify the finish colour.'};
 const [first,duplicate]=await Promise.all([contractor.call(messages(),'POST',body),contractor.call(messages(),'POST',body)]);
 assert.equal(first.status,201);assert.equal(duplicate.status,201);assert.equal(first.data.id,duplicate.data.id);
 assert.equal(first.data.actor_id,seeded.accounts.contractor.id);
 assert.equal((await contractor.call(messages(),'POST',{...body,body:'Changed payload'})).status,409);
 assert.equal((await developer.call(messages(),'POST',{key:randomUUID(),body:'Use white, according to the specification.'})).status,201);
 const reload=await new Client().login('contractor');
 const saved=await reload.call(collaboration());assert.equal(saved.data.messages.length,2);assert.equal(saved.data.messages[0].body,body.body);
 assert.equal(saved.data.messages[1].actor_id,seeded.accounts.developer.id);
 const current=(await pool.query('SELECT status,version,report FROM defects WHERE id=$1',[id])).rows[0];
 assert.deepEqual(current,{status:original.status,version:original.version,report:original.report});
 const audit=(await pool.query("SELECT details FROM audit_events WHERE action='defect.message' AND entity_id=$1",[id])).rows;
 assert.equal(audit.length,2);assert.ok(!JSON.stringify(audit).includes(body.body));
 assert.equal((await contractor.call(messages(),'POST',{key:randomUUID(),body:'   '})).status,400);
 assert.equal((await contractor.call(messages(),'POST',{key:randomUUID(),body:'x'.repeat(4001)})).status,400);
 assert.equal((await contractor.call(messages(),'POST',{key:randomUUID(),body:'Valid',actor_id:seeded.accounts.developer.id})).status,400);
 const csrf=contractor.csrf;contractor.csrf='';
 try{assert.equal((await contractor.call(messages(),'POST',{key:randomUUID(),body:'No CSRF'})).status,403)}finally{contractor.csrf=csrf}
});
test('messages and evidence obey current assignment, role, tenant, module and account access',async()=>{
 for(const role of ['family','unit_owner','dispatcher','platform_admin','second_org']){
  const denied=await new Client().login(role);
  assert.ok([403,404].includes((await denied.call(collaboration())).status),role);
  assert.ok([403,404].includes((await denied.call(messages(),'POST',{key:randomUUID(),body:'Not permitted'})).status),role);
 }
 try{
  await pool.query('UPDATE defects SET contractor_id=$2 WHERE id=$1',[id,seeded.accounts.developer.id]);
  assert.equal((await contractor.call(collaboration())).status,404);
  assert.equal((await contractor.call(messages(),'POST',{key,body:'Please clarify the finish colour.'})).status,404,'old receipt cannot bypass current assignment');
 }finally{await pool.query('UPDATE defects SET contractor_id=$2 WHERE id=$1',[id,original.contractor_id])}
 const old=(await pool.query("SELECT override_state FROM module_entitlements WHERE organization_id=$1 AND module='handover'",[original.organization_id])).rows[0];
 try{
  await pool.query("UPDATE module_entitlements SET override_state='disabled' WHERE organization_id=$1 AND module='handover'",[original.organization_id]);
  assert.equal((await contractor.call(collaboration())).status,403);
 }finally{await pool.query("UPDATE module_entitlements SET override_state=$2 WHERE organization_id=$1 AND module='handover'",[original.organization_id,old.override_state])}
 try{
  await pool.query('UPDATE users SET blocked=true WHERE id=$1',[seeded.accounts.contractor.id]);
  assert.ok([401,403].includes((await contractor.call(collaboration())).status));
 }finally{await pool.query('UPDATE users SET blocked=false WHERE id=$1',[seeded.accounts.contractor.id])}
 contractor=await new Client().login('contractor');
});
test('conversation pagination is complete and immutable; evidence excludes clarification messages',async()=>{
 await pool.query(`INSERT INTO defect_history(defect_id,actor_id,action,note)
  SELECT $1,$2,'message','Pagination '||n FROM generate_series(1,33) n`,[id,seeded.accounts.developer.id]);
 await pool.query("INSERT INTO defect_history(defect_id,actor_id,action,note) VALUES($1,$2,'report','Evidence report')",[id,seeded.accounts.contractor.id]);
 const latest=await contractor.call(collaboration());assert.equal(latest.data.total,35);assert.equal(latest.data.messages.length,30);assert.ok(latest.data.nextCursor);
 const older=await contractor.call(collaboration()+'?before='+latest.data.nextCursor);assert.equal(older.data.messages.length,5);assert.equal(older.data.nextCursor,null);
 const all=[...older.data.messages,...latest.data.messages];assert.equal(new Set(all.map((m:any)=>m.id)).size,35);
 assert.equal((await contractor.call(collaboration()+'?before='+randomUUID())).status,404);
 assert.ok(latest.data.reports.some((r:any)=>r.note==='Evidence report'));
 assert.ok(latest.data.reports.every((r:any)=>r.action!=='message'));
 assert.ok((await contractor.call('/defects/'+id)).data.history.every((h:any)=>h.action!=='message'));
 await assert.rejects(pool.query("UPDATE defect_history SET note='changed' WHERE id=$1",[all[0].id]));
 await assert.rejects(pool.query('DELETE FROM defect_history WHERE id=$1',[all[0].id]));
});
test('evidence photos keep the protected download boundary after reassignment',async()=>{
 const current=await contractor.call('/defects/'+id);
 if(current.data.status==='assigned')assert.equal((await contractor.call('/defects/'+id+'/transition','POST',{action:'start',version:current.data.version})).status,200);
 const bytes=await sharp({create:{width:12,height:12,channels:3,background:'#eeeeee'}}).png().toBuffer();
 const upload=await fetch(base+'/api/defects/'+id+'/photos',{method:'POST',headers:{Cookie:contractor.cookie,'X-CSRF-Token':contractor.csrf,'Content-Type':'application/octet-stream'},body:new Uint8Array(bytes).buffer});
 assert.equal(upload.status,201);
 const photo=await upload.json();
 const evidence=await contractor.call(collaboration());
 assert.ok(evidence.data.photos.some((p:any)=>p.id===photo.id));
 const download=()=>fetch(base+'/api/defect-photos/'+photo.id,{headers:{Cookie:contractor.cookie}});
 assert.equal((await download()).status,200);
 const outsider=await new Client().login('second_org');
 assert.ok([403,404].includes((await fetch(base+'/api/defect-photos/'+photo.id,{headers:{Cookie:outsider.cookie}})).status));
 try{
  await pool.query('UPDATE defects SET contractor_id=$2 WHERE id=$1',[id,seeded.accounts.developer.id]);
  assert.equal((await download()).status,404);
 }finally{await pool.query('UPDATE defects SET contractor_id=$2 WHERE id=$1',[id,original.contractor_id])}
});
test('concurrent clarification writes complete without losing messages or holding authorization pool slots',async()=>{
 const initial=await contractor.call(collaboration());
 const results=await Promise.all(Array.from({length:12},(_,n)=>contractor.call(messages(),'POST',{key:randomUUID(),body:'Concurrent clarification '+n})));
 assert.ok(results.every(r=>r.status===201));
 assert.equal(new Set(results.map(r=>r.data.id)).size,12);
 const latest=await contractor.call(collaboration());assert.equal(latest.data.total,initial.data.total+12);
});
