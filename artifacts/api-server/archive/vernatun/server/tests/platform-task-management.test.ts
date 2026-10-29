import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {app} from '../app.js';
import {pool} from '../db.js';
import {config} from '../config.js';
if(config.NODE_ENV!=='test'||new URL(config.DATABASE_URL).pathname!=='/vernatun_test')throw new Error('Isolated database required');
const seed=JSON.parse(await readFile('.local/test/demo-accounts.json','utf8'));
const account=(role:string)=>Object.values(seed.accounts as Record<string,any>).find((a:any)=>a.role===role)!;
const server=app.listen(0,'127.0.0.1');let base:string;
class Client{
 cookie='';csrf='';
 async call(path:string,method='GET',body?:unknown){
  const response=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',Cookie:this.cookie,...(method==='GET'?{}:{'X-CSRF-Token':this.csrf})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(response.headers.getSetCookie().length)this.cookie=response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
  const data=response.headers.get('content-type')?.includes('json')?await response.json():undefined;
  if(data?.csrf)this.csrf=data.csrf;
  return {status:response.status,data};
 }
 async login(role:string){
  const user=account(role);await this.call('/auth/session');
  const result=await this.call('/auth/login','POST',{email:user.email,password:user.password});
  assert.equal(result.status,200,role);
  if(!result.data.contextId){
   const selected=result.data.contexts.find((item:any)=>item.role_key===role);
   assert.ok(selected,role);
   assert.equal((await this.call('/auth/context','POST',{id:selected.id})).status,200);
  }
  return this;
 }
}
const platform=new Client(),organization=new Client(),support=new Client();let organizationId:string,platformUserId:string,supportUserId:string;
before(async()=>{
 if(!server.listening)await new Promise<void>(resolve=>server.once('listening',resolve));
 base='http://127.0.0.1:'+(server.address() as any).port;
 await platform.login('platform_admin');await organization.login('org_admin');await support.login('support');
 organizationId=(await pool.query('SELECT id FROM organizations ORDER BY id LIMIT 1')).rows[0].id;
 platformUserId=(await pool.query('SELECT id FROM users WHERE email=$1',[account('platform_admin').email])).rows[0].id;
 supportUserId=(await pool.query('SELECT id FROM users WHERE email=$1',[account('support').email])).rows[0].id;
});
after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));await pool.end()});

test('platform task board is protected, searchable, versioned and audited',async()=>{
 assert.equal((await new Client().call('/platform/tasks')).status,401);
 assert.equal((await organization.call('/platform/tasks')).status,403);
 const invalidAssignee=await platform.call('/platform/tasks','POST',{title:'Invalid assignee task',assigneeId:(await pool.query('SELECT id FROM users WHERE email=$1',[account('org_admin').email])).rows[0].id});
 assert.equal(invalidAssignee.status,400);
 const create=await platform.call('/platform/tasks','POST',{
  title:'Prepare release checklist',description:'Verify platform operations and record results.',
  priority:'high',organizationId,dueOn:'2026-12-15',assigneeId:platformUserId,
 });
 assert.equal(create.status,201);
 assert.equal(create.data.status,'todo');
 assert.equal(create.data.version,1);
 assert.equal(create.data.organizationId,organizationId);
 assert.equal(create.data.assigneeId,platformUserId);
 const search=await platform.call('/platform/tasks?q=release&status=todo&priority=high');
 assert.equal(search.status,200);
 assert.deepEqual(search.data.tasks.map((task:any)=>task.id),[create.data.id]);
 const moved=await platform.call('/platform/tasks/'+create.data.id,'PATCH',{version:1,status:'in_progress'});
 assert.equal(moved.status,200);
 assert.equal(moved.data.status,'in_progress');
 assert.equal(moved.data.version,2);
 const stale=await platform.call('/platform/tasks/'+create.data.id,'PATCH',{version:1,status:'done'});
 assert.equal(stale.status,409);
 const filtered=await platform.call('/platform/tasks?organizationId='+organizationId+'&assigneeId='+platformUserId+'&dueFrom=2026-12-01&dueTo=2026-12-31');
 assert.equal(filtered.status,200);
 assert.equal(filtered.data.tasks.length,1);
 const archived=await platform.call('/platform/tasks/'+create.data.id+'/archive','POST',{version:2});
 assert.equal(archived.status,200);
 const afterArchive=await platform.call('/platform/tasks?q=release');
 assert.equal(afterArchive.status,200);
 assert.equal(afterArchive.data.tasks.length,0);
 const audit=await pool.query(`SELECT action FROM audit_events WHERE entity_type='platform_task' AND entity_id=$1 ORDER BY created_at`,[create.data.id]);
 assert.deepEqual(audit.rows.map((row:any)=>row.action).sort(),['platform.task.archived','platform.task.assigned','platform.task.created','platform.task.updated'].sort());
});

test('platform task assignment, reassignment, deadline notices use channel preferences and live task details',async()=>{
 await pool.query(`INSERT INTO notification_preferences(user_id,email_enabled,in_app_enabled,categories)
  VALUES($1,false,true,'{}') ON CONFLICT(user_id) DO UPDATE SET email_enabled=false,in_app_enabled=true,categories='{}'`,[platformUserId]);
 const create=await platform.call('/platform/tasks','POST',{
  title:'Review incident timeline',description:'Document the confirmed sequence.',
  assigneeId:platformUserId,dueOn:'2026-12-20',
 });
 assert.equal(create.status,201);
 const first=(await pool.query(`SELECT id,event_code,organization_id,in_app_enabled FROM notifications
  WHERE user_id=$1 AND entity_type='platform_task' AND entity_id=$2`,[platformUserId,create.data.id])).rows[0];
 assert.equal(first.event_code,'platform_task_assigned');
 assert.equal(first.organization_id,null);
 assert.equal(first.in_app_enabled,true);
 assert.equal((await pool.query('SELECT 1 FROM notification_email_outbox WHERE notification_id=$1',[first.id])).rowCount,0);

 const notices=await platform.call('/notifications');
 const visible=notices.data.find((item:any)=>item.id===first.id);
 assert.equal(visible.platform_task.status,'todo');
 assert.equal(visible.platform_task.dueOn,'2026-12-20');
 const destination=await platform.call(`/notifications/${first.id}/destination?contextId=${platformUserId}`);
 assert.equal(destination.status,403);
 const target=visible.targets[0];
 const taskDestination=await platform.call(`/notifications/${first.id}/destination?contextId=${target.id}`);
 assert.equal(taskDestination.status,200);
 assert.equal(taskDestination.data.destination,`/console/tasks?taskId=${create.data.id}`);
 assert.equal((await organization.call('/platform/tasks/'+create.data.id)).status,404);
 assert.equal((await platform.call('/platform/tasks/'+create.data.id)).status,200);

 const unchanged=await platform.call('/platform/tasks/'+create.data.id,'PATCH',{
  version:1,title:create.data.title,description:create.data.description,status:create.data.status,
  priority:create.data.priority,organizationId:null,assigneeId:platformUserId,dueOn:'2026-12-20',
 });
 assert.equal(unchanged.status,200);
 assert.equal(Number((await pool.query(`SELECT count(*) FROM notifications WHERE user_id=$1 AND entity_type='platform_task' AND entity_id=$2`,[platformUserId,create.data.id])).rows[0].count),1);
 const deadline=await platform.call('/platform/tasks/'+create.data.id,'PATCH',{version:2,dueOn:'2026-12-27'});
 assert.equal(deadline.status,200);
 const status=await platform.call('/platform/tasks/'+create.data.id,'PATCH',{version:3,status:'blocked'});
 assert.equal(status.status,200);
 const current=(await platform.call('/notifications')).data.filter((item:any)=>item.platform_task?.id===create.data.id);
 assert.equal(current.length,2);
 assert.ok(current.every((item:any)=>item.platform_task.status==='blocked'&&item.platform_task.dueOn==='2026-12-27'));

 const reassigned=await platform.call('/platform/tasks/'+create.data.id,'PATCH',{version:4,assigneeId:supportUserId});
 assert.equal(reassigned.status,200);
 const supportNotice=(await pool.query(`SELECT id,event_code FROM notifications
  WHERE user_id=$1 AND entity_type='platform_task' AND entity_id=$2`,[supportUserId,create.data.id])).rows[0];
 assert.equal(supportNotice.event_code,'platform_task_assigned');
 assert.equal((await support.call('/platform/tasks/'+create.data.id)).data.status,'blocked');
 const audit=(await pool.query(`SELECT action,details FROM audit_events
  WHERE entity_type='platform_task' AND entity_id=$1`,[create.data.id])).rows;
 assert.ok(audit.some((row:any)=>row.action==='platform.task.deadline_changed'&&row.details.toDueOn==='2026-12-27'));
 assert.ok(audit.some((row:any)=>row.action==='platform.task.reassigned'&&row.details.newAssigneeId===supportUserId));
});
