import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {app} from '../app.js';
import {pool} from '../db.js';
import {config} from '../config.js';

if(config.NODE_ENV!=='test'||!new URL(config.DATABASE_URL).pathname.endsWith('/vernatun_test'))
 throw new Error('HAYAT tests require the isolated test database');
const seeded=JSON.parse(await readFile('.local/test/demo-accounts.json','utf8'));
const server=app.listen(0,'127.0.0.1');
let base='';
class Client{
 cookie='';csrf='';contextId='';
 async call(path:string,method='GET',body?:unknown){
  const response=await fetch(base+'/api'+path,{method,headers:{
   'Content-Type':'application/json',...(this.cookie?{Cookie:this.cookie}:{}),
   ...(method==='GET'?{}:{'X-CSRF-Token':this.csrf})
  },...(body===undefined?{}:{body:JSON.stringify(body)})});
  const cookies=response.headers.getSetCookie();
  if(cookies.length)this.cookie=cookies.map(s=>s.split(';')[0]).join('; ');
  const data=await response.json();
  if(data?.csrf)this.csrf=data.csrf;
  return {status:response.status,data};
 }
 async login(key:string){
  await this.call('/auth/session');
  const a=seeded.accounts[key];
  const result=await this.call('/auth/login','POST',{email:a.email,password:a.password});
  assert.equal(result.status,200);
  const c=result.data.contexts.find((c:any)=>c.role_key===a.role);
  assert.ok(c);
  assert.equal((await this.call('/auth/context','POST',{id:c.id})).status,200);
  this.contextId=c.id;
  return this;
 }
}
const clients:Record<string,Client>={};
before(async()=>{
 await new Promise<void>(resolve=>server.listening?resolve():server.on('listening',resolve));
 base='http://127.0.0.1:'+(server.address() as {port:number}).port;
 await pool.query('DELETE FROM auth_rate_limits');
 for(const key of ['manager','dispatcher','technician','contractor','security','unit_owner','second_org'])
  clients[key]=await new Client().login(key);
});
after(async()=>{server.close();server.closeAllConnections();await pool.end()});

test('HAYAT requires authentication and a workforce role from the active server context',async()=>{
 assert.equal((await new Client().call('/hayat/queue')).status,401);
 assert.equal((await clients.unit_owner.call('/hayat/queue?role_key=manager')).status,403);
 assert.equal((await clients.second_org.call('/hayat/queue')).status,403);
 assert.equal((await clients.manager.call('/hayat/queue?page=-1')).status,400);
 assert.equal((await clients.manager.call('/hayat/queue?building=not-a-uuid')).status,400);
});

test('Queue search, status counts, building filters and pagination preserve organization scope',async()=>{
 const f=seeded.fixtures;
 await pool.query(`INSERT INTO resident_requests(organization_id,unit_id,author_user_id,subject,description)
  SELECT $1,$2,$3,'HAYAT restoration page '||n,'Queue verification'
  FROM generate_series(1,27) n`,[f.orgA,f.ua,seeded.accounts.unit_owner.id]);
 await pool.query(`INSERT INTO resident_requests(organization_id,unit_id,author_user_id,subject,description)
  VALUES($1,$2,$3,'HAYAT restoration foreign row','Must not leak')`,[f.orgB,f.ub,seeded.accounts.second_org.id]);
 const first=await clients.manager.call('/hayat/queue?search=HAYAT%20restoration');
 assert.equal(first.status,200);
 assert.equal(first.data.pageSize,24);
 assert.equal(first.data.total,27);
 assert.equal(first.data.rows.length,24);
 assert.deepEqual(first.data.stats,[{status:'new',count:27}]);
 assert.ok(first.data.rows.every((r:any)=>r.building_id===f.ba));
 assert.ok(first.data.buildings.every((b:any)=>b.id!==f.bb));
 const second=await clients.manager.call('/hayat/queue?search=HAYAT%20restoration&page=1');
 assert.equal(second.data.rows.length,3);
 assert.equal(new Set([...first.data.rows,...second.data.rows].map(r=>r.id)).size,27);
 const id=first.data.rows[0].id;
 assert.equal((await clients.dispatcher.call('/hayat/queue?search='+id)).data.total,1);
 assert.equal((await clients.manager.call('/hayat/queue?search=R-'+id.slice(0,8))).data.rows[0].id,id);
 assert.equal((await clients.manager.call('/hayat/queue?search='+encodeURIComponent('#-'+id.slice(0,8)))).data.rows[0].id,id);
 const blocked=await clients.manager.call('/hayat/queue?search=HAYAT%20restoration&building='+f.bb);
 assert.equal(blocked.data.total,0);
 const filtered=await clients.manager.call('/hayat/queue?search=HAYAT%20restoration&status=closed');
 assert.equal(filtered.data.total,0);
 assert.deepEqual(filtered.data.stats,[{status:'new',count:27}]);
});

test('Technicians and contractors see only personally assigned scoped records',async()=>{
 for(const role of ['technician','contractor']){
  const result=await clients[role].call('/hayat/queue');
  assert.equal(result.status,200);
  assert.ok(result.data.rows.length>0,'Seeded personal assignments must be present');
  if(role==='technician'){
   const work=result.data.rows[0];
   const shortId='WO-'+work.work_order_id.slice(0,8);
   const searched=await clients[role].call('/hayat/queue?search='+shortId);
   assert.equal(searched.status,200);
   assert.equal(searched.data.rows[0].id,work.id);
  }
  for(const row of result.data.rows){
   const own=role==='technician'
    ? await pool.query('SELECT technician_id AS user_id FROM work_orders WHERE request_id=$1',[row.id])
    : await pool.query('SELECT contractor_id AS user_id FROM defects WHERE id=$1',[row.id]);
   assert.equal(own.rows[0].user_id,seeded.accounts[role].id);
   assert.equal(row.building_id,seeded.fixtures.ba);
  }
 }
 const tech=clients.technician;
 try{
  await pool.query('UPDATE role_assignments SET active=false WHERE id=$1',[tech.contextId]);
  assert.equal((await tech.call('/hayat/queue')).status,403);
 }finally{await pool.query('UPDATE role_assignments SET active=true WHERE id=$1',[tech.contextId])}
 try{
  await pool.query("UPDATE module_entitlements SET enabled=false WHERE organization_id=$1 AND module='requests'",[seeded.fixtures.orgA]);
  assert.equal((await clients.manager.call('/hayat/queue')).status,403);
  assert.equal((await tech.call('/hayat/queue')).status,403);
 }finally{await pool.query("UPDATE module_entitlements SET enabled=true WHERE organization_id=$1 AND module='requests'",[seeded.fixtures.orgA])}
});

test('Security queue derives expiry/revocation/not-yet-valid statuses and never returns pass tokens',async()=>{
 const f=seeded.fixtures;
 for(const [name,from,until,revoked] of [
  ['expired',-120000,-60000,null],
  ['waiting',60000,120000,null],
  ['revoked',-60000,120000,new Date()]
 ] as const){
  await pool.query(`INSERT INTO visitor_passes(organization_id,unit_id,created_by,visitor,token_hash,valid_from,valid_until,revoked_at)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[
   f.orgA,f.ua,seeded.accounts.unit_owner.id,'HAYAT status '+name,
   createHash('sha256').update(randomUUID()).digest('hex'),
   new Date(Date.now()+from),new Date(Date.now()+until),revoked
  ]);
 }
 const result=await clients.security.call('/hayat/queue?search=HAYAT%20status');
 assert.equal(result.status,200);
 assert.equal(result.data.total,3);
 for(const row of result.data.rows){
  assert.equal(row.status,row.subject.split(' ').at(-1));
  assert.equal('token' in row,false);
  assert.equal('token_hash' in row,false);
  assert.equal(row.building_id,f.ba);
 }
});
