import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import type {Request} from 'express';
import {Webhook} from 'svix';
import {app} from '../app.js';
import {pool} from '../db.js';
import {config} from '../config.js';
import {sendInvitation} from '../invitation-delivery.js';
import {createEmailProvider} from '../email.js';
import type {Context} from '../access.js';
import {ingestDeliveryEvent} from '../email-delivery-events.js';
import {deliverEmail} from '../email.js';

if(config.NODE_ENV!=='test'||!new URL(config.DATABASE_URL).pathname.endsWith('/vernatun_test'))
 throw new Error('Delivery tests require the isolated test database');
const seeded=JSON.parse(await readFile('.local/test/demo-accounts.json','utf8'));
// Synthetic signing material belongs only to this test process; never uses a live secret.
const secret='whsec_'+randomBytes(32).toString('base64');
process.env.RESEND_WEBHOOK_SECRET=secret;
process.env.RESEND_WEBHOOK_SCOPE='qa-account';
const server=app.listen(0,'127.0.0.1');let base='';
class Client{
 cookie='';csrf='';context!:Context;
 async call(path:string,method='GET',body?:unknown){
  const response=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',
   ...(this.cookie?{Cookie:this.cookie}:{}),...(method==='GET'?{}:{'X-CSRF-Token':this.csrf})},
   ...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(response.headers.getSetCookie().length)this.cookie=response.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');
  const data=response.status===204?null:await response.json();
  if(data?.csrf)this.csrf=data.csrf;
  return {status:response.status,data};
 }
 async login(key:string){
  await this.call('/auth/session');const a=seeded.accounts[key];
  const r=await this.call('/auth/login','POST',{email:a.email,password:a.password});assert.equal(r.status,200);
  this.context=r.data.contexts.find((c:Context)=>c.role_key===a.role);
  assert.equal((await this.call('/auth/context','POST',{id:this.context.id})).status,200);return this;
 }
}
let platform:Client,org:Client;
const fakeResend={mode:'production',provider:'resend',from:'noreply@example.test'};
const fakeRequest={user:{id:seeded.accounts.platform_admin.id}} as Request;
before(async()=>{
 await new Promise<void>(resolve=>server.listening?resolve():server.once('listening',resolve));
 base='http://127.0.0.1:'+(server.address() as {port:number}).port;
 await pool.query('DELETE FROM auth_rate_limits');
 platform=await new Client().login('platform_admin');org=await new Client().login('org_admin');
});
after(async()=>{server.close();server.closeAllConnections();await pool.end()});
async function invite(organizationId=seeded.fixtures.orgA){
 const r=await platform.call('/invitations','POST',{email:randomUUID()+'@example.test',role:'org_admin',organizationId});
 assert.equal(r.status,201);
 return {id:r.data.id,token:new URL(r.data.url).searchParams.get('token')!};
}
async function accepted(i:{id:string;token:string},messageId=randomUUID()){
 await sendInvitation(fakeRequest,platform.context,i.id,i.token,{settings:fakeResend,dependencies:{
  resendFetch:async()=>Response.json({id:messageId})
 }});
 return messageId;
}
function payload(messageId:string,outcome='delivered'){
 return JSON.stringify({type:'email.'+outcome,created_at:new Date().toISOString(),
  data:{email_id:messageId,to:['foreign-recipient@example.test'],subject:'private content',bounce:{message:'private provider text'}}});
}
async function webhook(body:string,id='msg_'+randomUUID(),timestamp=new Date(),signature?:string){
 const wh=new Webhook(secret);
 return fetch(base+'/api/webhooks/resend',{method:'POST',headers:{
  'Content-Type':'application/json','svix-id':id,'svix-timestamp':String(Math.floor(timestamp.getTime()/1000)),
  'svix-signature':signature??wh.sign(id,timestamp,body)
 },body});
}
async function outcome(id:string){return (await pool.query('SELECT * FROM invitation_delivery_outcomes WHERE invitation_id=$1',[id])).rows[0]}

test('Signed endpoint rejects missing/bad signatures, changed bytes and stale/future timestamps without storing evidence',async()=>{
 const body=payload(randomUUID());
 const start=Number((await pool.query('SELECT count(*) FROM email_delivery_events')).rows[0].count);
 assert.equal((await webhook(body,undefined,undefined,'v1,invalid')).status,400);
 const id='msg_'+randomUUID(),time=new Date(),signature=new Webhook(secret).sign(id,time,body);
 assert.equal((await webhook(body+' ',id,time,signature)).status,400);
 for(const delta of [-601000,601000])assert.equal((await webhook(body,undefined,new Date(Date.now()+delta))).status,400);
 assert.equal((await fetch(base+'/api/webhooks/resend',{method:'POST',headers:{'Content-Type':'application/json'},body})).status,400);
 assert.equal(Number((await pool.query('SELECT count(*) FROM email_delivery_events')).rows[0].count),start);
});

test('Accepted receipt is not delivery; duplicate events and reverse arrival order preserve negative evidence',async()=>{
 const i=await invite(),messageId=await accepted(i);
 assert.equal((await outcome(i.id)).outcome,'accepted');
 const eventId='msg_'+randomUUID(),body=payload(messageId,'bounced');
 assert.equal((await webhook(body,eventId)).status,204);
 assert.equal((await webhook(body,eventId)).status,204);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM email_delivery_events WHERE event_id=$1',[eventId])).rows[0].n,1);
 assert.equal((await webhook(payload(messageId))).status,204);
 assert.equal((await outcome(i.id)).outcome,'bounced');
 assert.equal((await webhook(payload(messageId,'complained'))).status,204);
 assert.equal((await webhook(payload(messageId))).status,204);
 assert.equal((await outcome(i.id)).outcome,'complained');
 const row=(await pool.query('SELECT * FROM invitations WHERE id=$1',[i.id])).rows[0];
 assert.equal(row.accepted_at,null);assert.equal(row.revoked_at,null);assert.equal(row.role_key,'org_admin');
 const serialized=JSON.stringify((await pool.query('SELECT * FROM email_delivery_events WHERE message_id=$1',[messageId])).rows);
 assert.ok(!serialized.includes('foreign-recipient')&&!serialized.includes('private'));
 assert.ok(!JSON.stringify((await pool.query('SELECT * FROM invitation_email_attempts WHERE invitation_id=$1',[i.id])).rows).includes(i.token));
});

test('Early event is retained until receipt correlation; unrecognized and open/click events are not delivery',async()=>{
 const i=await invite(),messageId=randomUUID();
 await sendInvitation(fakeRequest,platform.context,i.id,i.token,{settings:fakeResend,dependencies:{resendFetch:async()=>{
  assert.equal((await webhook(payload(messageId))).status,204);
  assert.equal((await outcome(i.id)).outcome,'unknown');
  return Response.json({id:messageId});
 }}});
 assert.equal((await outcome(i.id)).outcome,'delivered');
 const n=Number((await pool.query('SELECT count(*) FROM email_delivery_events')).rows[0].count);
 for(const type of ['opened','clicked'])assert.equal((await webhook(payload(messageId,type))).status,204);
 assert.equal(Number((await pool.query('SELECT count(*) FROM email_delivery_events')).rows[0].count),n);
});

test('Scoped correlation and list never expose another tenant or another provider account',async()=>{
 const own=await invite(),other=await invite(seeded.fixtures.orgB);
 const ownMessage=await accepted(own),otherMessage=await accepted(other);
 await ingestDeliveryEvent({provider:'resend',scope:'different-account',eventId:randomUUID(),messageId:ownMessage,outcome:'bounced',occurredAt:new Date().toISOString()});
 assert.equal((await outcome(own.id)).outcome,'accepted');
 await webhook(payload(otherMessage,'bounced'));
 const list=await org.call('/invitations');
 assert.equal(list.status,200);assert.ok(list.data.some((r:any)=>r.id===own.id));
 assert.ok(!list.data.some((r:any)=>r.id===other.id));
 assert.ok(!JSON.stringify(list.data).includes(otherMessage));
 assert.ok(!JSON.stringify(list.data).includes('foreign-recipient'));
 assert.equal((await org.call('/invitations/'+other.id+'/resend','POST',{email:'changed@example.test'})).status,404);
 assert.equal((await org.call('/invitations/'+other.id,'DELETE')).status,404);
});

test('Correction/resend rotates token; old bounce cannot affect new attempt, revoke cannot revive',async()=>{
 const i=await invite(),oldMessage=await accepted(i);
 const email=randomUUID()+'@example.test';
 const r=await platform.call('/invitations/'+i.id+'/resend','POST',{email});
 assert.equal(r.status,200);
 const token=new URL(r.data.url).searchParams.get('token')!;
 assert.notEqual(token,i.token);
 assert.equal((await pool.query('SELECT email FROM invitations WHERE id=$1',[i.id])).rows[0].email,email);
 const newMessage=await accepted({id:i.id,token});
 await webhook(payload(newMessage));await webhook(payload(oldMessage,'bounced'));
 assert.equal((await outcome(i.id)).outcome,'delivered');
 const guest=new Client();await guest.call('/auth/session');
 assert.equal((await guest.call('/auth/accept-invitation','POST',{token:i.token,name:'QA person',password:'Temporary-Test-Only-0000'})).status,400);
 assert.equal((await platform.call('/invitations/'+i.id,'DELETE')).status,204);
 await webhook(payload(newMessage,'complained'));
 assert.equal((await platform.call('/invitations/'+i.id+'/resend','POST',{email})).status,409);
 const row=(await pool.query('SELECT * FROM invitations WHERE id=$1',[i.id])).rows[0];
 assert.ok(row.revoked_at);assert.equal(row.accepted_at,null);
 assert.equal(row.token_hash,createHash('sha256').update(token).digest('hex'));
});

test('Transport completion after token rotation cannot overwrite the new attempt',async()=>{
 const i=await invite(),oldMessage=randomUUID(),newMessage=randomUUID();
 let rotatedToken='';
 await sendInvitation(fakeRequest,platform.context,i.id,i.token,{settings:fakeResend,dependencies:{resendFetch:async()=>{
  const rotated=await platform.call('/invitations/'+i.id+'/resend','POST',{});
  assert.equal(rotated.status,200);rotatedToken=new URL(rotated.data.url).searchParams.get('token')!;
  await accepted({id:i.id,token:rotatedToken},newMessage);
  return Response.json({id:oldMessage});
 }}});
 await webhook(payload(oldMessage,'bounced'));
 assert.equal((await outcome(i.id)).outcome,'accepted');
 await webhook(payload(newMessage));
 assert.equal((await outcome(i.id)).outcome,'delivered');
 await assert.rejects(accepted(i),(e:any)=>e.code==='invalid_transition');
});

test('SMTP without DSN, local outbox and legacy sent never become delivered; failed transport stays failed',async()=>{
 const i=await invite();
 assert.equal((await outcome(i.id)).outcome,'local');
 await sendInvitation(fakeRequest,platform.context,i.id,i.token,{settings:{mode:'production',provider:'smtp',
  host:'smtp.example.test',port:587,from:'noreply@example.test',user:'qa',password:'synthetic'},transport:{
   sendMail:async()=>({accepted:[(await pool.query('SELECT email FROM invitations WHERE id=$1',[i.id])).rows[0].email],rejected:[]})
 }});
 const status=await outcome(i.id);assert.equal(status.outcome,'accepted');assert.equal(status.delivery_evidence,false);
 await assert.rejects(sendInvitation(fakeRequest,platform.context,i.id,i.token,{settings:fakeResend,dependencies:{
  resendFetch:async()=>Response.json({error:'private'},{status:503})
 }}),(e:any)=>e.code==='email_delivery_failed');
 assert.equal((await outcome(i.id)).outcome,'failed');
 const legacy=await invite();
 await pool.query("UPDATE invitations SET current_email_attempt_id=NULL,email_delivery_status='sent' WHERE id=$1",[legacy.id]);
 assert.equal((await outcome(legacy.id)).outcome,'accepted');assert.equal((await outcome(legacy.id)).delivery_evidence,null);
 for(const provider of ['smtp','outbox','disabled'])assert.equal(createEmailProvider({mode:'development',provider}).capabilities.deliveryEvents,false);
 const caps=createEmailProvider(fakeResend).capabilities;
 assert.equal(caps.deliveryEvents,true);assert.equal(caps.opens,false);assert.equal(caps.clicks,false);
});

test('Persistent delivery audit rejects updates, deletion and truncation',async()=>{
 for(const table of ['invitation_email_attempts','invitation_email_receipts','email_delivery_events']){
  await assert.rejects(pool.query(`DELETE FROM ${table}`),/append-only/);
  await assert.rejects(pool.query(`UPDATE ${table} SET provider=provider`),/append-only/);
  await assert.rejects(pool.query(`TRUNCATE ${table} CASCADE`),/append-only/);
 }
});

test('All six events are normalized, delayed is non-failure, late sent cannot regress final evidence',async()=>{
 const i=await invite(),messageId=await accepted(i);
 for(const [event,expected] of [['sent','sent'],['delivery_delayed','delayed'],['delivered','delivered'],
  ['sent','delivered'],['failed','failed'],['bounced','bounced'],['complained','complained']]){
  assert.equal((await webhook(payload(messageId,event))).status,204);
  assert.equal((await outcome(i.id)).outcome,expected);
 }
 const message=(await pool.query('SELECT * FROM email_message_outcomes WHERE provider_message_id=$1',[messageId])).rows[0];
 assert.equal(message.business_id,i.id);assert.equal(message.status,'complained');
 assert.ok(message.accepted_at);
 const user=(await pool.query('SELECT accepted_at,revoked_at FROM invitations WHERE id=$1',[i.id])).rows[0];
 assert.equal(user.accepted_at,null);assert.equal(user.revoked_at,null);
});

test('General reset delivery records contain no token or HTML, callbacks do not consume reset validity',async()=>{
 const token=randomBytes(32).toString('hex'),userId=seeded.accounts.org_admin.id;
 const reset=(await pool.query("INSERT INTO password_resets(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '30 minutes') RETURNING id",
  [userId,createHash('sha256').update(token).digest('hex')])).rows[0];
 const messageId=randomUUID(),url='https://example.test/reset-password?token='+token;
 await deliverEmail({to:'private-user@example.test',subject:'Private reset',text:url,url},'reset-'+userId,
  {settings:fakeResend,business:{type:'password_reset',id:reset.id},dependencies:{resendFetch:async()=>Response.json({id:messageId})}});
 assert.equal((await webhook(payload(messageId,'bounced'))).status,204);
 assert.equal((await webhook(payload(messageId,'complained'))).status,204);
 const message=(await pool.query('SELECT * FROM email_message_outcomes WHERE provider_message_id=$1',[messageId])).rows[0];
 assert.equal(message.business_type,'password_reset');assert.equal(message.status,'complained');
 assert.ok(!JSON.stringify(message).includes(token)&&!JSON.stringify(message).includes('reset-password?'));
 const r=(await pool.query('SELECT used_at FROM password_resets WHERE id=$1',[reset.id])).rows[0];
 assert.equal(r.used_at,null);
});

test('Email operations are admin-only, paginated and masked; detail and health retain safe evidence',async()=>{
 const i=await invite(),messageId=await accepted(i);
 const email=(await pool.query('SELECT email FROM invitations WHERE id=$1',[i.id])).rows[0].email;
 await webhook(payload(messageId,'delivery_delayed'));await webhook(payload(messageId));
 const list=await platform.call('/platform/email/messages?pageSize=1&status=delivered&businessType=invitation&recipient='+encodeURIComponent(email));
 assert.equal(list.status,200);assert.equal(list.data.items.length,1);assert.equal(list.data.pageSize,1);
 assert.ok(list.data.total>=1);assert.ok(!JSON.stringify(list.data).includes(email));
 assert.ok(list.data.items[0].recipient_masked.includes('***'));
 const detail=await platform.call('/platform/email/messages/'+list.data.items[0].id);
 assert.equal(detail.status,200);assert.equal(detail.data.message.status,'delivered');
 assert.equal(detail.data.events.length,2);assert.equal(detail.data.events[0].event_type,'email.delivery_delayed');
 assert.ok(!JSON.stringify(detail.data).includes(i.token));
 const health=await platform.call('/platform/email/health');
 assert.equal(health.status,200);assert.ok(health.data.counts.delivered>=1);
 assert.ok(health.data.deliveryRate>=0&&health.data.deliveryRate<=1);
 assert.ok(health.data.webhook.lastValidEvent);assert.equal(health.data.liveVerification,'not_performed');
 for(const path of ['/platform/email/messages','/platform/email/messages/'+list.data.items[0].id,'/platform/email/health']){
  assert.equal((await org.call(path)).status,403);
  assert.equal((await new Client().call(path)).status,401);
 }
 assert.equal((await platform.call('/platform/email/messages?pageSize=101')).status,400);
 assert.equal((await platform.call('/platform/email/messages?from=2026-02-30')).status,400);
 assert.equal((await platform.call('/platform/email/health?from=2026-10-07&to=2026-10-06')).status,400);
});

test('Unknown message evidence is retained, raw payload is discarded, endpoint rejects non-POST and oversize',async()=>{
 const messageId=randomUUID(),body=payload(messageId),eventId='msg_'+randomUUID();
 assert.equal((await webhook(body,eventId)).status,204);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM email_delivery_events WHERE event_id=$1',[eventId])).rows[0].n,1);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM email_messages WHERE provider_message_id=$1',[messageId])).rows[0].n,0);
 assert.equal((await fetch(base+'/api/webhooks/resend')).status,405);
 const tooLarge=JSON.stringify({padding:'x'.repeat(33000)});
 assert.equal((await webhook(tooLarge)).status,413);
 const wh=new Webhook(secret),time=new Date(),legacyId='msg_'+randomUUID();
 assert.equal((await fetch(base+'/api/email-webhooks/resend',{method:'POST',headers:{'Content-Type':'application/json',
  'svix-id':legacyId,'svix-timestamp':String(Math.floor(time.getTime()/1000)),'svix-signature':wh.sign(legacyId,time,body)},body})).status,204);
});

test('Resend evidence cannot confirm an SMTP ledger record with an identical provider ID',async()=>{
 const messageId=randomUUID();
 const row=(await pool.query(`INSERT INTO email_messages(provider,provider_scope,delivery_evidence,business_type,recipient,
  provider_message_id,transport_status,accepted_at) VALUES('smtp','qa-account',false,'other','qa@example.test',$1,'accepted',now()) RETURNING id`,[messageId])).rows[0];
 await webhook(payload(messageId,'delivered'));
 assert.equal((await pool.query('SELECT status FROM email_message_outcomes WHERE id=$1',[row.id])).rows[0].status,'accepted');
});

test('Provider rejection is not invented delivery failure in general ledger; no key/token is stored',async()=>{
 const businessId=randomUUID(),token=randomBytes(32).toString('hex'),url='https://example.test/?token='+token;
 await assert.rejects(deliverEmail({to:'qa@example.test',subject:'private',text:url,url},'notification-'+businessId,
  {settings:fakeResend,dependencies:{resendFetch:async()=>Response.json({error:'unavailable'},{status:503})}}));
 const record=(await pool.query('SELECT * FROM email_message_outcomes WHERE business_id=$1',[businessId])).rows[0];
 assert.equal(record.status,'unknown');assert.equal(record.provider_message_id,null);
 assert.ok(!JSON.stringify(record).includes(token)&&!JSON.stringify(record).includes(url));
});

test('Temporary event-store failure returns retryable 503; signed unsupported events are ignored',async()=>{
 const original=pool.query.bind(pool),body=payload(randomUUID()),eventId='msg_'+randomUUID();
 (pool as any).query=(...args:any[])=>{
  if(String(args[0]).includes('INSERT INTO email_delivery_events'))return Promise.reject(Object.assign(new Error('Synthetic DB outage'),{code:'ECONNREFUSED'}));
  return (original as any)(...args);
 };
 try{assert.equal((await webhook(body,eventId)).status,503)}
 finally{(pool as any).query=original}
 assert.equal((await webhook(body,eventId)).status,204);
 const start=(await pool.query('SELECT count(*)::int AS n FROM email_delivery_events')).rows[0].n;
 for(const type of ['opened','clicked','unrelated','__proto__','constructor']){
  const b=JSON.stringify({type,created_at:new Date().toISOString(),data:{email_id:randomUUID()}});
  assert.equal((await webhook(b)).status,204);
 }
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM email_delivery_events')).rows[0].n,start);
});

test('Acceptance followed by receipt persistence failure never invents failed transport',async()=>{
 const i=await invite(),original=pool.query.bind(pool);
 (pool as any).query=(...args:any[])=>{
  if(String(args[0]).includes('UPDATE email_messages SET transport_status'))return Promise.reject(Object.assign(new Error('Synthetic receipt outage'),{code:'ECONNREFUSED'}));
  return (original as any)(...args);
 };
 try{await assert.rejects(accepted(i),(e:any)=>e.code==='email_receipt_unrecorded')}
 finally{(pool as any).query=original}
 assert.equal((await outcome(i.id)).outcome,'unknown');
 const row=(await pool.query(`SELECT count(*)::int AS n FROM invitation_email_receipts r JOIN invitation_email_attempts a
  ON a.id=r.attempt_id JOIN invitations i ON i.current_email_attempt_id=a.id WHERE i.id=$1 AND r.outcome='failed'`,[i.id])).rows[0];
 assert.equal(row.n,0);
});
