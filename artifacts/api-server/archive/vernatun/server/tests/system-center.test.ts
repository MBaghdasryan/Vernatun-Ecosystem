import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {app} from '../app.js';
import {pool} from '../db.js';
import {config} from '../config.js';
import {observedJob,recordSystemEvent,safeCode} from '../system-observability.js';
if(config.NODE_ENV!=='test'||!new URL(config.DATABASE_URL).pathname.endsWith('/vernatun_test'))throw Error('Isolated database required');
const seeded=JSON.parse(await readFile('.local/test/demo-accounts.json','utf8'));
const server=app.listen(0,'127.0.0.1');let base='',admin:Client,support:Client,org:Client;
class Client{
 cookie='';csrf='';assignment='';user='';
 async call(path:string,method='GET',body?:unknown){
  const r=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',Cookie:this.cookie,'X-CSRF-Token':this.csrf},
   ...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(r.headers.getSetCookie().length)this.cookie=r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
  const data=await r.json();if(data?.csrf)this.csrf=data.csrf;return {status:r.status,data,id:r.headers.get('X-Request-ID')};
 }
 async login(role:string){
  const a=Object.values(seeded.accounts).find((x:any)=>x.role===role) as any;
  await this.call('/auth/session');const r=await this.call('/auth/login','POST',{email:a.email,password:a.password});assert.equal(r.status,200);
  this.assignment=r.data.contexts.find((c:any)=>c.role_key===role).id;this.user=r.data.user.id;
  assert.equal((await this.call('/auth/context','POST',{id:this.assignment})).status,200);return this;
 }
}
before(async()=>{
 await pool.query('DELETE FROM auth_rate_limits');
 await new Promise<void>(r=>server.listening?r():server.on('listening',r));base='http://127.0.0.1:'+(server.address() as any).port;
 admin=await new Client().login('platform_admin');support=await new Client().login('support');org=await new Client().login('org_admin');
});
after(async()=>{server.close();server.closeAllConnections();await new Promise(r=>setTimeout(r,100));await pool.end()});
test('platform-only granular rights; tenants, support and anonymous denied',async()=>{
 for(const route of ['/system/overview','/system/health','/system/logs','/system/jobs']){
  assert.equal((await new Client().call(route)).status,401);
  assert.equal((await support.call(route)).status,403);
  assert.equal((await org.call(route)).status,403);
  assert.equal((await admin.call(route)).status,200);
 }
 await pool.query(`INSERT INTO iam_assignment_rules(assignment_id,permission_key,effect,reason,created_by) VALUES($1,'logs.read','deny','QA granular denial',$2)`,[admin.assignment,admin.user]);
 assert.equal((await admin.call('/system/logs')).status,403);
 assert.equal((await admin.call('/system/overview')).status,200);
 await pool.query("DELETE FROM iam_assignment_rules WHERE assignment_id=$1 AND permission_key='logs.read'",[admin.assignment]);
});
test('overview observations real and unavailable values explicit',async()=>{
 const r=await admin.call('/system/overview');assert.equal(r.status,200);
 assert.equal(r.data.metrics.find((x:any)=>x.key==='database').status,'healthy');
 assert.equal(r.data.metrics.find((x:any)=>x.key==='last_backup').value,null);
 assert.equal(r.data.status,'warning');assert.ok(r.id);
 assert.ok(!JSON.stringify(r.data).includes(config.SESSION_SECRET));
});
test('request logs exclude secrets, query tokens and request bodies; filters and paging',async()=>{
 const secret='DO_NOT_LOG_password_test';
 const r=await admin.call('/system/logs?token='+secret);assert.equal(r.status,400);
 await new Promise(r=>setTimeout(r,100));
 const logs=await admin.call('/system/logs?requestId='+r.id);assert.equal(logs.status,200);
 assert.ok(logs.data.items.length);assert.ok(!JSON.stringify(logs.data).includes(secret));
 assert.equal(logs.data.items[0].status,400);
 assert.equal((await admin.call('/system/logs?user=invalid')).status,400);
 assert.equal((await admin.call('/system/logs?page=0')).status,400);
 for(let i=0;i<53;i++)await recordSystemEvent({category:'system',event:'qa_pagination'});
 const page=await admin.call('/system/logs?category=system&q=qa_pagination');assert.equal(page.data.items.length,50);assert.equal(page.data.hasMore,true);
 assert.equal((await admin.call('/system/logs?category=system&q=qa_pagination&page=2')).data.items.length,3);
 assert.equal(safeCode('password='+secret),'internal_error');
});
test('job persistence records success, failure and stale heartbeats without arbitrary execution',async()=>{
 await observedJob('qa_success',async()=>{});
 await assert.rejects(observedJob('qa_failure',async()=>{throw Object.assign(Error('sensitive message'),{code:'EQA'})}));
 await pool.query("INSERT INTO system_job_runs(id,job,status,heartbeat_at) VALUES(gen_random_uuid(),'qa_interrupted','running',now()-interval '3 minutes')");
 const r=await admin.call('/system/jobs');assert.equal(r.status,200);
 assert.equal(r.data.items.find((x:any)=>x.job==='qa_success').status,'completed');
 assert.equal(r.data.items.find((x:any)=>x.job==='qa_failure').status,'failed');
 assert.equal(r.data.items.find((x:any)=>x.job==='qa_interrupted').status,'interrupted');
 assert.ok(!JSON.stringify(r.data).includes('sensitive message'));
 assert.equal((await admin.call('/system/jobs/qa_failure/retry','POST',{})).status,404);
});
