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

test('Dispatcher queue KPIs respect SLA time, executor and organization/building/unit scopes',async()=>{
 const f=seeded.fixtures,token='HAYAT KPI '+randomUUID();
 const otherUnit=(await pool.query(
  'INSERT INTO units(organization_id,building_id,number,area,is_demo) VALUES($1,$2,$3,42,true) RETURNING id',
  [f.orgA,f.ba,'KPI-'+randomUUID().slice(0,8)]
 )).rows[0].id;
 async function add(label:string,unitId:string,status:string,dueOffset:string,technicianId?:string){
  const request=(await pool.query(`INSERT INTO resident_requests(organization_id,unit_id,author_user_id,subject,description,status)
   VALUES($1,$2,$3,$4,'Queue KPI isolation',$5) RETURNING id`,
   [f.orgA,unitId,seeded.accounts.unit_owner.id,token+' '+label,status])).rows[0];
  if(technicianId)await pool.query(`INSERT INTO work_orders(request_id,technician_id,assigned_by,status)
   VALUES($1,$2,$3,$4)`,[request.id,technicianId,seeded.accounts.dispatcher.id,status]);
  await pool.query(`INSERT INTO request_sla_deadlines(request_id,kind,due_at)
   VALUES($1,'assignment',now()+$2::interval)`,[request.id,dueOffset]);
  return request.id;
 }
 await add('assigned-state-without-executor',f.ua,'assigned','-1 hour');
 await add('overdue-assigned',f.ua,'in_progress','-1 hour',seeded.accounts.technician.id);
 await add('future-unassigned',f.ua,'new','+1 hour');
 await add('other-unit-overdue',otherUnit,'new','-1 hour');
 await add('closed-past-deadline',f.ua,'closed','-1 hour');

 const query='/hayat/queue?search='+encodeURIComponent(token);
 const dispatcher=await clients.dispatcher.call(query);
 assert.equal(dispatcher.status,200);
 assert.deepEqual(dispatcher.data.metrics,{unassigned:3,overdue:3});
 assert.equal(dispatcher.data.total,5);
 const unassigned=await clients.dispatcher.call(query+'&focus=unassigned');
 assert.equal(unassigned.data.total,3);
 assert.ok(unassigned.data.rows.every((r:any)=>r.unassigned));
 const overdue=await clients.dispatcher.call(query+'&focus=overdue');
 assert.equal(overdue.data.total,3);
 assert.ok(overdue.data.rows.every((r:any)=>r.overdue));
 const allRows=dispatcher.data.rows;
 assert.equal(allRows.find((r:any)=>r.subject.endsWith('assigned-state-without-executor')).unassigned,true);
 assert.equal(allRows.find((r:any)=>r.subject.endsWith('future-unassigned')).overdue,false);
 assert.equal(allRows.find((r:any)=>r.subject.endsWith('overdue-assigned')).unassigned,false);
 assert.equal(allRows.find((r:any)=>r.subject.endsWith('closed-past-deadline')).overdue,false);
 assert.equal((await clients.dispatcher.call(query+'&status=closed')).data.total,1);

 const sameBuilding=await clients.dispatcher.call(query+'&building='+f.ba);
 assert.deepEqual(sameBuilding.data.metrics,{unassigned:3,overdue:3});
 const foreignBuilding=await clients.dispatcher.call(query+'&building='+f.bb);
 assert.equal(foreignBuilding.data.total,0);
 assert.deepEqual(foreignBuilding.data.metrics,{unassigned:0,overdue:0});

 const manager=await clients.manager.call(query);
 assert.deepEqual(manager.data.metrics,{unassigned:3,overdue:3});
 const technician=await clients.technician.call(query);
 assert.equal(technician.data.total,1);
 assert.deepEqual(technician.data.metrics,{unassigned:0,overdue:1,urgent:0,upcoming:0,checklist:{done:0,total:0,percent:null}});
 assert.equal((await clients.unit_owner.call(query)).status,403);

 const assignment=(await pool.query(`INSERT INTO role_assignments(user_id,organization_id,role_key,building_id,unit_id)
  VALUES($1,$2,'dispatcher',$3,$4) RETURNING id`,
  [seeded.accounts.dispatcher.id,f.orgA,f.ba,f.ua])).rows[0].id;
 try{
  const unitScoped=await new Client().login('dispatcher');
  const session=await unitScoped.call('/auth/session');
  const scopedContext=session.data.contexts.find((c:any)=>c.id===assignment);
  assert.ok(scopedContext);
  assert.equal((await unitScoped.call('/auth/context','POST',{id:assignment})).status,200);
  const scopedQueue=await unitScoped.call(query);
  assert.equal(scopedQueue.data.total,4);
  assert.deepEqual(scopedQueue.data.metrics,{unassigned:2,overdue:2});
  assert.equal((await unitScoped.call(query+'&focus=unassigned')).data.total,2);
 }finally{
  await pool.query('DELETE FROM role_assignments WHERE id=$1',[assignment]);
 }
});

test('Technician urgency, checklist and upcoming KPIs stay within assignee and active context scopes',async()=>{
 const f=seeded.fixtures,token='HAYAT technician KPI '+randomUUID(),ids:string[]=[],users:string[]=[],assignments:string[]=[];
 const otherUnit=(await pool.query(
  'INSERT INTO units(organization_id,building_id,number,area,is_demo) VALUES($1,$2,$3,42,true) RETURNING id',
  [f.orgA,f.ba,'TECH-'+randomUUID().slice(0,8)]
 )).rows[0].id;
 async function addTech(orgId:string,buildingId:string,unitId:string|undefined,label:string){
  const id=randomUUID();
  await pool.query('INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)',
   [id,`test-tech-${randomUUID()}@vernatun.test`,`Test technician ${label}`,'test-only-not-login']);
  users.push(id);
  await pool.query('INSERT INTO memberships(user_id,organization_id) VALUES($1,$2)',[id,orgId]);
  const assignment=(await pool.query(`INSERT INTO role_assignments(user_id,organization_id,role_key,building_id,unit_id)
   VALUES($1,$2,'technician',$3,$4) RETURNING id`,[id,orgId,buildingId,unitId??null])).rows[0].id;
  assignments.push(assignment);
  return id;
 }
 async function addWork(label:string,unitId:string,technicianId:string,priority:string,status:string,checklist:unknown[],dueOffset?:string){
  const request=(await pool.query(`INSERT INTO resident_requests(organization_id,unit_id,author_user_id,subject,description,priority)
   VALUES($1,$2,$3,$4,'Technician KPI verification',$5) RETURNING id`,
   [f.orgA,unitId,seeded.accounts.unit_owner.id,token+' '+label,priority])).rows[0].id;
  ids.push(request);
  await pool.query(`INSERT INTO work_orders(request_id,technician_id,assigned_by,status,checklist)
   VALUES($1,$2,$3,$4,$5::jsonb)`,[request,technicianId,seeded.accounts.dispatcher.id,status,JSON.stringify(checklist)]);
  if(dueOffset)await pool.query(`INSERT INTO request_sla_deadlines(request_id,kind,due_at)
   VALUES($1,'assignment',now()+$2::interval)`,[request,dueOffset]);
  return request;
 }
 const own=seeded.accounts.technician.id;
 const otherTech=await addTech(f.orgA,f.ba,f.ua,'same organization');
 const foreignTech=await addTech(f.orgB,f.bb,f.ub,'other organization');
 const unitContext=(await pool.query(`INSERT INTO role_assignments(user_id,organization_id,role_key,building_id,unit_id)
  VALUES($1,$2,'technician',$3,$4) RETURNING id`,[own,f.orgA,f.ba,f.ua])).rows[0].id;
 assignments.push(unitContext);
 try{
  await addWork('own urgent',f.ua,own,'urgent','assigned',[{text:'Inspect',done:true},{text:'Record finding',done:false}],'+1 hour');
  await addWork('own in progress',f.ua,own,'high','in_progress',[{text:'Repair',done:false},{text:'Photo',done:false}],'+2 hours');
  await addWork('other technician urgent',f.ua,otherTech,'emergency','assigned',[{text:'Private checklist',done:false}],'+1 hour');
  const otherOrgRequest=(await pool.query(`INSERT INTO resident_requests(organization_id,unit_id,author_user_id,subject,description,priority)
   VALUES($1,$2,$3,$4,'Other organization assignment','emergency') RETURNING id`,
   [f.orgB,f.ub,seeded.accounts.second_org.id,token+' other organization'])).rows[0].id;
  ids.push(otherOrgRequest);
  await pool.query(`INSERT INTO work_orders(request_id,technician_id,assigned_by,status,checklist)
   VALUES($1,$2,$3,'assigned',$4::jsonb)`,
   [otherOrgRequest,foreignTech,seeded.accounts.second_org.id,JSON.stringify([{text:'Other site',done:false}])]);

  const query='/hayat/queue?search='+encodeURIComponent(token);
  const queue=await clients.technician.call(query);
  assert.equal(queue.status,200);
  assert.equal(queue.data.total,2,'only the signed-in technician’s assignments are visible');
  assert.deepEqual(queue.data.metrics,{unassigned:0,overdue:0,urgent:1,upcoming:2,checklist:{done:1,total:4,percent:25}});
  assert.ok(queue.data.rows.every((row:any)=>row.subject.includes('own ')));
  const urgent=await clients.technician.call(query+'&focus=urgent');
  assert.equal(urgent.data.total,1);
  assert.ok(urgent.data.rows[0].subject.endsWith('own urgent'));
  const incomplete=await clients.technician.call(query+'&focus=checklist');
  assert.equal(incomplete.data.total,2);
  const upcoming=await clients.technician.call(query+'&focus=upcoming');
  assert.equal(upcoming.data.total,2);
  assert.ok(upcoming.data.rows[0].subject.endsWith('own urgent'),'upcoming work is ordered by the nearest future deadline');
  assert.equal((await clients.manager.call(query+'&focus=urgent')).status,400,'technician-only focus filters do not alter other role queues');

  const emptyChecklistToken='HAYAT technician no checklist '+randomUUID();
  const emptyRequest=(await pool.query(`INSERT INTO resident_requests(organization_id,unit_id,author_user_id,subject,description,priority)
   VALUES($1,$2,$3,$4,'No checklist data','normal') RETURNING id`,
   [f.orgA,f.ua,seeded.accounts.unit_owner.id,emptyChecklistToken])).rows[0].id;
  ids.push(emptyRequest);
  await pool.query(`INSERT INTO work_orders(request_id,technician_id,assigned_by,status,checklist)
   VALUES($1,$2,$3,'assigned','[]'::jsonb)`,[emptyRequest,own,seeded.accounts.dispatcher.id]);
  const noChecklist=await clients.technician.call('/hayat/queue?search='+encodeURIComponent(emptyChecklistToken));
  assert.equal(noChecklist.data.total,1);
  assert.deepEqual(noChecklist.data.metrics,{unassigned:0,overdue:0,urgent:0,upcoming:0,checklist:{done:0,total:0,percent:null}},
   'zero counts are measured; a missing checklist is represented by null percent, not 0%');

  const scopeToken='HAYAT technician unit scope '+randomUUID();
  const unitRequest=(await pool.query(`INSERT INTO resident_requests(organization_id,unit_id,author_user_id,subject,description,priority)
   VALUES($1,$2,$3,$4,'Unit scoped assigned task','urgent') RETURNING id`,
   [f.orgA,f.ua,seeded.accounts.unit_owner.id,scopeToken+' only ua'])).rows[0].id;
  ids.push(unitRequest);
  await pool.query(`INSERT INTO work_orders(request_id,technician_id,assigned_by,status,checklist)
   VALUES($1,$2,$3,'assigned','[{"text":"Check","done":false}]'::jsonb)`,
   [unitRequest,own,seeded.accounts.dispatcher.id]);
  await pool.query(`INSERT INTO request_sla_deadlines(request_id,kind,due_at) VALUES($1,'assignment',now()+interval '1 hour')`,[unitRequest]);
  const otherUnitRequest=(await pool.query(`INSERT INTO resident_requests(organization_id,unit_id,author_user_id,subject,description,priority)
   VALUES($1,$2,$3,$4,'Out-of-unit assigned task','emergency') RETURNING id`,
   [f.orgA,otherUnit,seeded.accounts.unit_owner.id,scopeToken+' other unit'])).rows[0].id;
  ids.push(otherUnitRequest);
  await pool.query(`INSERT INTO work_orders(request_id,technician_id,assigned_by,status,checklist)
   VALUES($1,$2,$3,'assigned','[{"text":"Check","done":false}]'::jsonb)`,
   [otherUnitRequest,own,seeded.accounts.dispatcher.id]);
  await pool.query(`INSERT INTO request_sla_deadlines(request_id,kind,due_at) VALUES($1,'assignment',now()+interval '1 hour')`,[otherUnitRequest]);
  const unitScoped=await new Client().login('technician');
  const contexts=await unitScoped.call('/auth/session');
  assert.ok(contexts.data.contexts.some((context:any)=>context.id===unitContext));
  assert.equal((await unitScoped.call('/auth/context','POST',{id:unitContext})).status,200);
  const scoped=await unitScoped.call('/hayat/queue?search='+encodeURIComponent(scopeToken));
  assert.equal(scoped.data.total,1);
  assert.equal(scoped.data.rows[0].subject,scopeToken+' only ua');
  assert.deepEqual(scoped.data.metrics,{unassigned:0,overdue:0,urgent:1,upcoming:1,checklist:{done:0,total:1,percent:0}});
 }finally{
  await pool.query('DELETE FROM request_visits WHERE request_id=ANY($1::uuid[])',[ids]);
  await pool.query('DELETE FROM request_sla_deadlines WHERE request_id=ANY($1::uuid[])',[ids]);
  await pool.query('DELETE FROM work_orders WHERE request_id=ANY($1::uuid[])',[ids]);
  await pool.query('DELETE FROM resident_requests WHERE id=ANY($1::uuid[])',[ids]);
  await pool.query('DELETE FROM role_assignments WHERE id=ANY($1::uuid[])',[assignments]);
  for(const userId of users){
   await pool.query('DELETE FROM memberships WHERE user_id=$1',[userId]);
   await pool.query('DELETE FROM users WHERE id=$1',[userId]);
  }
  await pool.query('DELETE FROM units WHERE id=$1',[otherUnit]);
 }
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
