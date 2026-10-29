import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {app} from '../app.js';
import {pool} from '../db.js';
import {config} from '../config.js';

if(config.NODE_ENV!=='test'||new URL(config.DATABASE_URL).pathname!=='/vernatun_test')
 throw new Error('Isolated database required');
const seed=JSON.parse(await readFile('.local/test/demo-accounts.json','utf8'));
const server=app.listen(0,'127.0.0.1');let base:string;

class Client{
 cookie='';csrf='';
 async call(path:string,method='GET',body?:unknown){
  const response=await fetch(base+'/api'+path,{
   method,headers:{'Content-Type':'application/json',Cookie:this.cookie,
    ...(method==='GET'?{}:{'X-CSRF-Token':this.csrf})},
   ...(body===undefined?{}:{body:JSON.stringify(body)}),
  });
  if(response.headers.getSetCookie().length)
   this.cookie=response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
  const data=response.headers.get('content-type')?.includes('json')?await response.json():undefined;
  if(data?.csrf)this.csrf=data.csrf;
  return {status:response.status,data};
 }
 async login(){
  const user=seed.accounts.platform_admin;
  await this.call('/auth/session');
  const result=await this.call('/auth/login','POST',{email:user.email,password:user.password});
  assert.equal(result.status,200,'platform admin login');
  return this;
 }
}
const platform=new Client();

before(async()=>{
 if(!server.listening)await new Promise<void>(resolve=>server.once('listening',resolve));
 base='http://127.0.0.1:'+(server.address() as {port:number}).port;
 await platform.login();
});

after(async()=>{
 await new Promise<void>(resolve=>server.close(()=>resolve()));
 await pool.end();
});

test('platform notice creation and small email campaign use the isolated outbox',async()=>{
 const organization=(await pool.query(`SELECT o.id
  FROM organizations o
  WHERE EXISTS(
   SELECT 1 FROM role_assignments a JOIN memberships m
    ON m.user_id=a.user_id AND m.organization_id=a.organization_id
   JOIN users u ON u.id=a.user_id
   WHERE a.organization_id=o.id AND a.active AND m.active AND NOT u.blocked
    AND a.starts_at<=now() AND (a.expires_at IS NULL OR a.expires_at>now())
  )
  ORDER BY o.id LIMIT 1`)).rows[0];
 assert.ok(organization,'A test organization with active recipients is required');
 const target={type:'organization',id:organization.id};
 const preview=await platform.call('/platform/communications/preview','POST',{target});
 assert.equal(preview.status,200);
 assert.ok(preview.data.count>0&&preview.data.count<=25,
  'The isolated test audience must be nonempty and fit one send batch');

 const notification=await platform.call('/platform/notifications','POST',{
  target,title:'Isolated communications test',body:'Test-only in-app notification',
  expectedRecipients:preview.data.count,idempotencyKey:randomUUID(),
 });
 assert.equal(notification.status,201);
 const storedNotice=(await pool.query(`SELECT n.custom_title,n.custom_body,b.recipient_count
  FROM notifications n JOIN platform_notification_batches b ON b.id=n.manual_batch_id
  WHERE b.id=$1`,[notification.data.id])).rows[0];
 assert.ok(storedNotice);
 assert.equal(storedNotice.custom_title,'Isolated communications test');
 assert.equal(storedNotice.custom_body,'Test-only in-app notification');
 assert.equal(storedNotice.recipient_count,preview.data.count);

 const emailPreview=await platform.call('/platform/communications/preview','POST',{target});
 assert.equal(emailPreview.status,200);
 assert.equal(emailPreview.data.count,preview.data.count);
 const campaign=await platform.call('/platform/email/campaigns','POST',{
  target,subject:'Isolated communications test',body:'Test-only email campaign',
  expectedRecipients:emailPreview.data.count,idempotencyKey:randomUUID(),
 });
 assert.equal(campaign.status,201);
 assert.equal(campaign.data.recipient_count,preview.data.count);

 const dispatch=await platform.call(`/platform/email/campaigns/${campaign.data.id}/dispatch`,'POST',{});
 assert.equal(dispatch.status,200);
 assert.equal(dispatch.data.done,true);
 assert.equal(dispatch.data.status,'local');
 assert.equal(dispatch.data.accepted,preview.data.count);
 assert.equal(dispatch.data.failed,0);
 assert.equal(dispatch.data.unknown,0);
 const status=(await pool.query(`SELECT c.status,r.status AS recipient_status
  FROM platform_email_campaigns c JOIN platform_email_campaign_recipients r ON r.campaign_id=c.id
  WHERE c.id=$1`,[campaign.data.id])).rows[0];
 assert.deepEqual(status,{status:'local',recipient_status:'local'});
});
