import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {app} from '../app.js';
import {pool} from '../db.js';
import {config} from '../config.js';
import {observedJob,recordSystemEvent,safeCode} from '../system-observability.js';
import {logCsvCell} from '../system-center.js';
import {safeErrorStack,apiBuildId} from '../system-diagnostics.js';
import {emailHealthMetrics} from '../system-email-health.js';
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
 for(const route of ['/system/overview','/system/health','/system/logs','/system/jobs','/system/errors']){
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
test('email health distinguishes retained acceptance, delivery and unknown outcomes without sending',async()=>{
 const empty=await emailHealthMetrics();
 const get=(rows:any[],key:string)=>rows.find(x=>x.key===key);
 assert.equal(get(empty,'email_last_delivered').value,null);
 const scope='system-health-qa';
 const insert=async(message:string,status='accepted',evidence=true)=>{
  await pool.query(`INSERT INTO email_messages(provider,provider_scope,delivery_evidence,business_type,recipient,
   provider_message_id,transport_status,accepted_at)
   VALUES('qa',$1,$2,'other','PRIVATE_RECIPIENT@example.invalid',$3,$4,CASE WHEN $4='accepted' THEN now() ELSE NULL END)`,
  [scope,evidence,message,status]);
 };
 await insert('accepted');await insert('unknown','unknown');await insert('local','local',false);
 const accepted=await emailHealthMetrics();
 assert.ok(get(accepted,'email_last_accepted').value);
 assert.equal(get(accepted,'email_last_delivered').value,null);
 const event=async(id:string,message:string,outcome:string,age='0 hours')=>{
  await pool.query(`INSERT INTO email_delivery_events(provider,provider_scope,event_id,message_id,outcome,occurred_at)
   VALUES('qa',$1,$2,$3,$4,now()-$5::interval)`,[scope,id,message,outcome,age]);
 };
 await event('sent','accepted','sent');await event('delivered','accepted','delivered');
 await event('bounce1','accepted','bounced');await event('bounce2','accepted','bounced');
 await event('failed-old','accepted','failed','25 hours');
 await event('unmatched','not-recorded','failed');await event('local','local','failed');
 await event('complaint','accepted','complained');await event('delay','accepted','delayed');
 const r=await admin.call('/system/health');assert.equal(r.status,200);
 const metrics=r.data.metrics;
 assert.ok(get(metrics,'email_last_sent').value);assert.ok(get(metrics,'email_last_delivered').value);
 assert.equal(get(metrics,'email_bounced_24h').value,'1');
 assert.equal(get(metrics,'email_failed_24h').value,'0');
 assert.equal(get(metrics,'email_complained_24h').value,'1');
 assert.equal(get(metrics,'email_delayed_24h').value,'1');
 assert.equal(get(metrics,'email_unknown_24h').status,'degraded');
 assert.equal(r.data.status,'warning');
 assert.ok(!JSON.stringify(r.data).includes('PRIVATE_RECIPIENT'));
 // Unavailable must never be rendered as zero; this mock cannot send anything.
 const original=pool.query;
 try{
  pool.query=(()=>{throw Error('PRIVATE_DATABASE_ERROR')}) as typeof pool.query;
  assert.ok((await emailHealthMetrics()).every(m=>m.value===null&&m.status==='unavailable'));
 }finally{pool.query=original}
});
test('error groups retain safe evidence, resolve with concurrency guards and reopen on recurrence',async()=>{
 const event={category:'system',event:'qa_error_group',level:'error',error:'QA_FAILURE',endpoint:'/qa/:id',method:'GET',status:500};
 await recordSystemEvent({...event,actor:admin.user,contextId:admin.assignment,requestId:'11111111-1111-4111-8111-111111111111'});
 await recordSystemEvent({...event,actor:org.user,contextId:org.assignment,requestId:'22222222-2222-4222-8222-222222222222'});
 const find=async()=>{const r=await admin.call('/system/errors');assert.equal(r.status,200);return r.data.items.find((g:any)=>g.message==='QA_FAILURE')};
 const group=await find();assert.ok(group);assert.equal(group.occurrences,2);assert.equal(group.status,'open');
 assert.equal(group.affectedUsers,2);assert.equal(group.affectedOrganizations,1);
 assert.equal(group.latestRequestId,'22222222-2222-4222-8222-222222222222');
 const path='/system/errors/'+group.fingerprint;
 assert.equal((await support.call(path)).status,403);assert.equal((await org.call(path)).status,403);
 assert.equal((await admin.call('/system/errors/not-a-fingerprint')).status,400);
 assert.equal((await admin.call('/system/errors/'+ '0'.repeat(32))).status,404);
 const detail=await admin.call(path);assert.equal(detail.status,200);
 assert.equal(detail.data.events.items.length,2);assert.equal(detail.data.stackTrace,null);
 assert.equal(detail.data.applicationVersion,null);assert.equal(detail.data.environment,'test');
 const body=(g:any,status='resolved')=>({status,lastEventId:g.lastEventId,occurrences:g.occurrences,revision:g.revision});
 await pool.query(`INSERT INTO iam_assignment_rules(assignment_id,permission_key,effect,reason,created_by) VALUES($1,'logs.manage','deny','QA resolution denial',$2)`,[admin.assignment,admin.user]);
 assert.equal((await admin.call(path,'PATCH',body(group))).status,403);
 assert.equal((await admin.call(path)).status,200);
 await pool.query("DELETE FROM iam_assignment_rules WHERE assignment_id=$1 AND permission_key='logs.manage'",[admin.assignment]);
 assert.equal((await support.call(path,'PATCH',body(group))).status,403);
 const resolved=await admin.call(path,'PATCH',body(group));assert.equal(resolved.status,200);assert.equal(resolved.data.status,'resolved');
 assert.equal(resolved.data.revision,1);
 assert.ok((await admin.call('/system/errors?status=resolved')).data.items.some((g:any)=>g.fingerprint===group.fingerprint));
 assert.equal((await admin.call(path,'PATCH',body(group))).status,409);
 await recordSystemEvent(event);
 const recurred=await find();assert.equal(recurred.status,'open');assert.equal(recurred.occurrences,3);
 assert.equal((await admin.call(path,'PATCH',body(resolved.data))).status,409);
 const racing=await Promise.all([admin.call(path,'PATCH',body(recurred)),admin.call(path,'PATCH',body(recurred))]);
 assert.deepEqual(racing.map(r=>r.status).sort(),[200,409]);
 const again=await find();assert.equal(again.status,'resolved');
 const reopened=await admin.call(path,'PATCH',body(again,'open'));assert.equal(reopened.status,200);assert.equal(reopened.data.status,'open');
 const audits=await pool.query("SELECT details FROM audit_events WHERE action='system.error.status' AND details->>'fingerprint'=$1",[group.fingerprint]);
 assert.equal(audits.rowCount,3);
 assert.equal((await admin.call('/system/errors?status=other')).status,400);
 // A separate route template has its own fingerprint, and many groups paginate.
 await pool.query(`INSERT INTO system_log_events(category,level,event,endpoint) SELECT 'system','fatal','qa_many','/qa/'||i FROM generate_series(1,52) i`);
 const page=await admin.call('/system/errors');assert.equal(page.data.items.length,50);assert.equal(page.data.hasMore,true);
 assert.ok((await admin.call('/system/errors?page=2')).data.items.length>0);
});
test('event diagnostics strip secrets and preserve historical unknowns',async()=>{
 const secret='PASSWORD_TOKEN_COOKIE_AUTHORIZATION_SECRET';
 const err=new Error(secret);
 err.stack=`Error: ${secret}\n    at ${secret} (/private/${secret}/app.ts:123:4)\n    at x (https://host/${secret}/app.ts:15:4)\n    at x (/private/${secret}.ts:12:1)\n    at x (/root/app.ts?token=${secret}:15:4)\n    at x (/root/app.ts:0:1)\n    at unknown (node:internal/process/task_queues:95:5)`;
 assert.equal(safeErrorStack(err),'app.ts:123:4');
 assert.equal(safeErrorStack({stack:err.stack}),null);
 const throwing=new Error();Object.defineProperty(throwing,'stack',{get(){throw Error(secret)}});
 assert.equal(safeErrorStack(throwing),null);
 const many=new Error();many.stack='Error\n'+Array(30).fill('    at x (/app/app.ts:4:2)').join('\n');
 assert.equal(safeErrorStack(many)?.split('\n').length,12);
 await recordSystemEvent({category:'application',event:'qa_diagnostics',level:'error',error:'DIAGNOSTIC_FAILURE',exception:err});
 const logs=await admin.call('/system/logs?category=application&q=qa_diagnostics');
 const row=logs.data.items[0];assert.equal(row.stackTrace,'app.ts:123:4');assert.equal(row.environment,'test');
 assert.equal(row.applicationVersion,apiBuildId);assert.equal(apiBuildId,null,'unbundled tests must not invent a build ID');
 assert.ok(!JSON.stringify(row).includes(secret));assert.ok(!JSON.stringify(row).includes('/private'));
 const list=await admin.call('/system/errors');
 const group=list.data.items.find((g:any)=>g.message==='DIAGNOSTIC_FAILURE');
 const detail=await admin.call('/system/errors/'+group.fingerprint);
 assert.equal(detail.data.stackTrace,'app.ts:123:4');assert.equal(detail.data.environment,'test');
 // Insert a legacy-shaped row: absent metadata remains unknown, not current runtime.
 await pool.query("INSERT INTO system_log_events(category,level,event,error_code) VALUES('application','error','qa_legacy','LEGACY_DIAGNOSTIC')");
 const oldGroup=(await admin.call('/system/errors')).data.items.find((g:any)=>g.message==='LEGACY_DIAGNOSTIC');
 const legacy=await admin.call('/system/errors/'+oldGroup.fingerprint);
 assert.equal(legacy.data.environment,null);assert.equal(legacy.data.applicationVersion,null);assert.equal(legacy.data.stackTrace,null);
 await observedJob('qa_diagnostic_job',async()=>{throw err}).catch(()=>{});
 const jobLogs=await admin.call('/system/logs?job=qa_diagnostic_job&level=error');
 assert.equal(jobLogs.data.items[0].stackTrace,'app.ts:123:4');
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
test('bounded JSON/CSV exports require both permissions, preserve filters and are audited',async()=>{
 const body={format:'json',from:new Date(Date.now()-86400000).toISOString(),to:new Date(Date.now()+1000).toISOString(),category:'system',q:'qa_pagination'};
 assert.equal((await support.call('/system/log-exports','POST',body)).status,403);
 assert.equal((await org.call('/system/log-exports','POST',body)).status,403);
 const anonymous=new Client();await anonymous.call('/auth/session');
 assert.equal((await anonymous.call('/system/log-exports','POST',body)).status,401);
 for(const permission of ['logs.export','logs.read']){
  await pool.query(`INSERT INTO iam_assignment_rules(assignment_id,permission_key,effect,reason,created_by) VALUES($1,$3,'deny','QA export denial',$2)`,[admin.assignment,admin.user,permission]);
  assert.equal((await admin.call('/system/log-exports','POST',body)).status,403);
  await pool.query('DELETE FROM iam_assignment_rules WHERE assignment_id=$1 AND permission_key=$2',[admin.assignment,permission]);
 }
 // Permission denials do not consume the separate authorized export budget.
 const json=await admin.call('/system/log-exports','POST',body);assert.equal(json.status,200);
 assert.equal(json.data.rows,53);assert.equal(JSON.parse(json.data.content).length,53);
 assert.ok(JSON.parse(json.data.content).every((row:any)=>row.category==='system'&&row.event==='qa_pagination'));
 const csv=await admin.call('/system/log-exports','POST',{...body,format:'csv'});assert.equal(csv.status,200);
 assert.ok(csv.data.content.startsWith('\uFEFF"id","createdAt"'));assert.equal(csv.data.rows,53);
 const a=await pool.query("SELECT details FROM audit_events WHERE actor_user_id=$1 AND action='system.logs.export'",[admin.user]);
 assert.equal(a.rows.length,2);assert.equal(a.rows[0].details.rows,53);
 assert.ok(!JSON.stringify(a.rows).includes('qa_pagination'));
 assert.equal(logCsvCell(' =HYPERLINK("bad")'),'"\' =HYPERLINK(""bad"")"');
 assert.equal(logCsvCell('a,b\n"c"'),'"a,b\n""c"""');
 assert.equal((await admin.call('/system/log-exports','POST',{...body,from:body.to,to:body.from})).status,400);
 assert.equal((await admin.call('/system/log-exports','POST',{...body,from:'2000-01-01T00:00:00Z'})).status,400);
 await pool.query("INSERT INTO system_log_events(category,level,event) SELECT 'system','info','qa_export_limit' FROM generate_series(1,5001)");
 assert.equal((await admin.call('/system/log-exports','POST',{...body,to:new Date(Date.now()+1000).toISOString(),q:'qa_export_limit'})).status,413);
 assert.equal((await admin.call('/system/log-exports','POST',body)).status,429);
 const after=await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE actor_user_id=$1 AND action='system.logs.export'",[admin.user]);assert.equal(after.rows[0].n,2);
});
