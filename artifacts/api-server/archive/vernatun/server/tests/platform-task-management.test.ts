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
  async upload(path:string,body:Buffer,fileName:string){
   return fetch(base+'/api'+path,{method:'POST',headers:{'Content-Type':'application/octet-stream',Cookie:this.cookie,'X-CSRF-Token':this.csrf,'X-File-Name':encodeURIComponent(fileName)},body:new Uint8Array(body)});
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
const platform=new Client(),organization=new Client(),support=new Client();
let organizationId:string,platformUserId:string,platformUserName:string,supportUserId:string;
before(async()=>{
 if(!server.listening)await new Promise<void>(resolve=>server.once('listening',resolve));
 base='http://127.0.0.1:'+(server.address() as any).port;
 await platform.login('platform_admin');await organization.login('org_admin');await support.login('support');
 organizationId=(await pool.query('SELECT id FROM organizations ORDER BY id LIMIT 1')).rows[0].id;
  const platformUser=(await pool.query('SELECT id,name FROM users WHERE email=$1',[account('platform_admin').email])).rows[0];
  platformUserId=platformUser.id;platformUserName=platformUser.name;
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
  const oldAlert=(await pool.query(`SELECT id FROM notifications
   WHERE user_id=$1 AND entity_type='platform_task' AND entity_id=$2 ORDER BY created_at DESC LIMIT 1`,
   [platformUserId,create.data.id])).rows[0];
  assert.ok(oldAlert);
  const archivedAlert=(await platform.call('/notifications')).data.find((item:any)=>item.id===oldAlert.id);
  assert.equal(archivedAlert.access_denied,true);
  assert.equal(archivedAlert.platform_task,null);
  assert.deepEqual(archivedAlert.targets,[]);
  assert.equal((await platform.call(`/notifications/${oldAlert.id}/destination`)).status,403);
  assert.equal((await platform.call('/platform/tasks/'+create.data.id)).status,404);
 const audit=await pool.query(`SELECT action FROM audit_events WHERE entity_type='platform_task' AND entity_id=$1 ORDER BY created_at`,[create.data.id]);
 assert.deepEqual(audit.rows.map((row:any)=>row.action).sort(),['platform.task.archived','platform.task.assigned','platform.task.created','platform.task.updated'].sort());
});

test('platform task alerts honor independent onboarding channel preferences without duplicate intents',async()=>{
 const initialPreferences=(await platform.call('/notifications/preferences')).data;
 let preferenceVersion=initialPreferences.version;
 const updatePreferences=async(inApp:boolean,email:boolean)=>{
  const updated=await platform.call('/notifications/preferences','PUT',{
   email_enabled:true,in_app_enabled:true,version:preferenceVersion,
   categories:{onboarding:{in_app:inApp,email}},
  });
  assert.equal(updated.status,200);
  preferenceVersion=updated.data.version;
 };
 const combinations=[
  {inApp:false,email:false},
  {inApp:false,email:true},
  {inApp:true,email:false},
  {inApp:true,email:true},
 ];

 for(const [index,preference] of combinations.entries()){
  await updatePreferences(preference.inApp,preference.email);
  const create=await platform.call('/platform/tasks','POST',{
   title:`Channel preference check ${index+1}`,assigneeId:platformUserId,dueOn:'2026-12-20',
  });
  assert.equal(create.status,201);
  const deadline=await platform.call(`/platform/tasks/${create.data.id}`,'PATCH',{
   version:1,dueOn:'2026-12-27',
  });
  assert.equal(deadline.status,200);

  const notices=(await pool.query(`SELECT id,event_code,in_app_enabled FROM notifications
   WHERE user_id=$1 AND entity_type='platform_task' AND entity_id=$2 ORDER BY event_code`,
  [platformUserId,create.data.id])).rows;
  assert.deepEqual(notices.map((row:any)=>row.event_code).sort(),[
   'platform_task_assigned','platform_task_deadline_changed',
  ]);
  for(const notice of notices){
   assert.equal(notice.in_app_enabled,preference.inApp,`${notice.event_code} in-app setting`);
   assert.equal(
    (await pool.query('SELECT 1 FROM notification_email_outbox WHERE notification_id=$1',[notice.id])).rowCount>0,
    preference.email,
    `${notice.event_code} email setting`,
   );
  }

  await updatePreferences(!preference.inApp,!preference.email);
  const resaved=await platform.call(`/platform/tasks/${create.data.id}`,'PATCH',{
   version:2,title:create.data.title,assigneeId:platformUserId,dueOn:'2026-12-27',
  });
  assert.equal(resaved.status,200);
  assert.equal(Number((await pool.query(`SELECT count(*) FROM notifications
   WHERE user_id=$1 AND entity_type='platform_task' AND entity_id=$2`,
  [platformUserId,create.data.id])).rows[0].count),2,'Preference changes and a task resave must not duplicate alerts');
  assert.equal(Number((await pool.query(`SELECT count(*) FROM notification_email_outbox o
   JOIN notifications n ON n.id=o.notification_id
   WHERE n.user_id=$1 AND n.entity_type='platform_task' AND n.entity_id=$2`,
  [platformUserId,create.data.id])).rows[0].count),preference.email?2:0,
  'Preference changes must not add or remove email intents for existing alerts');
 }
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
 assert.equal(visible.custom_title,create.data.title);
 assert.equal(visible.custom_body,'Status: todo. Due: 2026-12-20');
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
 const formerNotice=(await platform.call('/notifications')).data.find((item:any)=>item.id===first.id);
 assert.equal(formerNotice.access_denied,true);
 assert.equal(formerNotice.custom_title,null);
 assert.equal(formerNotice.custom_body,null);
 assert.equal(formerNotice.platform_task,null);
 assert.deepEqual(formerNotice.targets,[]);
 assert.equal((await platform.call(`/notifications/${first.id}/destination`)).status,403);
 assert.equal((await platform.call('/platform/tasks/'+create.data.id)).status,404);

 const newNotice=(await support.call('/notifications')).data.find((item:any)=>item.id===supportNotice.id);
 assert.equal(newNotice.access_denied,false);
 assert.equal(newNotice.platform_task.id,create.data.id);
 const newTaskDestination=await support.call(`/notifications/${supportNotice.id}/destination?contextId=${newNotice.targets[0].id}`);
 assert.equal(newTaskDestination.status,200);
 assert.equal(newTaskDestination.data.destination,`/console/tasks?taskId=${create.data.id}`);
 assert.equal((await support.call('/platform/tasks/'+create.data.id)).data.status,'blocked');
 const audit=(await pool.query(`SELECT action,details FROM audit_events
  WHERE entity_type='platform_task' AND entity_id=$1`,[create.data.id])).rows;
 assert.ok(audit.some((row:any)=>row.action==='platform.task.deadline_changed'&&row.details.toDueOn==='2026-12-27'));
 assert.ok(audit.some((row:any)=>row.action==='platform.task.reassigned'&&row.details.newAssigneeId===supportUserId));
 });

test('platform task alerts and direct reads require an active platform membership',async()=>{
 const assignment=(await pool.query(`SELECT id,active,assignment_status,starts_at,expires_at FROM role_assignments
  WHERE user_id=$1 AND organization_id IS NULL AND role_key='platform_admin'`,[platformUserId])).rows[0];
 const accountState=(await pool.query('SELECT account_status FROM users WHERE id=$1',[platformUserId])).rows[0];
 assert.ok(assignment);
 assert.ok(accountState);
 const created=await platform.call('/platform/tasks','POST',{
  title:'Membership access regression',description:'Verify task visibility follows role status.',assigneeId:platformUserId,
 });
 assert.equal(created.status,201);
 const notice=(await pool.query(`SELECT id FROM notifications WHERE user_id=$1 AND entity_type='platform_task' AND entity_id=$2`,
  [platformUserId,created.data.id])).rows[0];
 assert.ok(notice);

 try{
  const active=await platform.call(`/notifications/${notice.id}/destination`);
  assert.equal(active.status,200);
  assert.equal((await platform.call('/platform/tasks/'+created.data.id)).status,200);
   const activeNotice=(await platform.call('/notifications')).data.find((item:any)=>item.id===notice.id);
  assert.equal(activeNotice.platform_task?.id,created.data.id);
  assert.equal(activeNotice.custom_title,created.data.title);
  assert.equal(activeNotice.custom_body,'Status: todo. Due: —');

  await pool.query("UPDATE role_assignments SET starts_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE id=$1",[assignment.id]);
  assert.equal((await platform.call('/platform/tasks/'+created.data.id)).status,404);
  const expired=(await platform.call('/notifications')).data.find((item:any)=>item.id===notice.id);
  assert.equal(expired.access_denied,true);
  assert.equal(expired.custom_title,null);
  assert.equal(expired.custom_body,null);
  assert.equal(expired.platform_task,null);
  assert.deepEqual(expired.targets,[]);
  assert.equal((await platform.call(`/notifications/${notice.id}/destination`)).status,403);

  await pool.query(`UPDATE role_assignments SET starts_at=now()-interval '2 days',expires_at=NULL,assignment_status='suspended' WHERE id=$1`,[assignment.id]);
  assert.equal((await platform.call('/platform/tasks/'+created.data.id)).status,404);
  const suspended=(await platform.call('/notifications')).data.find((item:any)=>item.id===notice.id);
  assert.equal(suspended.access_denied,true);
  assert.equal(suspended.custom_title,null);
  assert.equal(suspended.custom_body,null);
  assert.equal(suspended.platform_task,null);
  assert.deepEqual(suspended.targets,[]);
  assert.equal((await platform.call(`/notifications/${notice.id}/destination`)).status,403);

  await pool.query(`UPDATE role_assignments SET active=$2,assignment_status=$3,starts_at=$4,expires_at=$5 WHERE id=$1`,
   [assignment.id,assignment.active,assignment.assignment_status,assignment.starts_at,assignment.expires_at]);
  await pool.query("UPDATE users SET account_status='disabled' WHERE id=$1",[platformUserId]);
  const disabledTask=await platform.call('/platform/tasks/'+created.data.id);
  assert.equal(disabledTask.status,401);
  assert.deepEqual(disabledTask.data,{error:'unauthenticated'});
  const disabledNotifications=await platform.call('/notifications');
  assert.equal(disabledNotifications.status,401);
  assert.deepEqual(disabledNotifications.data,{error:'unauthenticated'});
  const disabledDestination=await platform.call(`/notifications/${notice.id}/destination`);
  assert.equal(disabledDestination.status,401);
  assert.deepEqual(disabledDestination.data,{error:'unauthenticated'});
 }finally{
  await Promise.all([
   pool.query(`UPDATE role_assignments SET active=$2,assignment_status=$3,starts_at=$4,expires_at=$5 WHERE id=$1`,
    [assignment.id,assignment.active,assignment.assignment_status,assignment.starts_at,assignment.expires_at]),
   pool.query('UPDATE users SET account_status=$2 WHERE id=$1',[platformUserId,accountState.account_status]),
  ]);
   platform.cookie='';
   platform.csrf='';
   await platform.login('platform_admin');
 }
 });

test('platform task discussion and private attachments are authorized and audited',async()=>{
 const created=await platform.call('/platform/tasks','POST',{title:'Discuss private task files'});
 assert.equal(created.status,201);
 const taskId=created.data.id;
 assert.equal((await new Client().call(`/platform/tasks/${taskId}/activity`)).status,401);
 assert.equal((await organization.call(`/platform/tasks/${taskId}/activity`)).status,403);
  assert.equal((await support.call(`/platform/tasks/${taskId}/activity`)).status,403);
 const comment=await platform.call(`/platform/tasks/${taskId}/comments`,'POST',{text:'Review the attached release notes.'});
 assert.equal(comment.status,201);
 assert.equal(comment.data.content,'Review the attached release notes.');
 assert.equal(comment.data.author,platformUserName);
 assert.ok(comment.data.createdAt);

 const pdf=Buffer.from('%PDF-1.4\nTask discussion test\n%%EOF');
 const uploaded=await platform.upload(`/platform/tasks/${taskId}/attachments`,pdf,'release-notes.pdf');
 assert.equal(uploaded.status,201);
 const attachment=await uploaded.json() as any;
 assert.equal(attachment.fileName,'release-notes.pdf');
 assert.equal(attachment.mediaType,'application/pdf');
 assert.equal(Number(attachment.byteSize),pdf.length);
 assert.equal((await organization.upload(`/platform/tasks/${taskId}/attachments`,pdf,'blocked.pdf')).status,403);
  assert.equal((await support.upload(`/platform/tasks/${taskId}/attachments`,pdf,'blocked-support.pdf')).status,403);

 const activity=await platform.call(`/platform/tasks/${taskId}/activity`);
 assert.equal(activity.status,200);
 assert.deepEqual(activity.data.activity.map((item:any)=>item.type),['comment','attachment']);
 assert.ok(new Date(activity.data.activity[0].createdAt)<=new Date(activity.data.activity[1].createdAt));
 assert.deepEqual(activity.data.activity.map((item:any)=>item.author),[platformUserName,platformUserName]);

 const downloadPath=`/platform/tasks/${taskId}/attachments/${attachment.id}`;
 assert.equal((await organization.call(downloadPath)).status,403);
  assert.equal((await support.call(downloadPath)).status,403);
 const downloaded=await fetch(base+'/api'+downloadPath,{headers:{Cookie:platform.cookie}});
 assert.equal(downloaded.status,200);
 assert.equal(downloaded.headers.get('cache-control'),'private, no-store');
 assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),pdf);
 const audit=await pool.query(`SELECT action FROM audit_events WHERE entity_type='platform_task' AND entity_id=$1 ORDER BY created_at`,[taskId]);
 assert.deepEqual(audit.rows.map((row:any)=>row.action),[
  'platform.task.created','platform.task.comment.created','platform.task.attachment.uploaded',
  'platform.task.activity.read','platform.task.attachment.downloaded',
 ]);
 });
