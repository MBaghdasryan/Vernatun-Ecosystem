import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
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
  const r=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',Cookie:this.cookie,...(method==='GET'?{}:{'X-CSRF-Token':this.csrf})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(r.headers.getSetCookie().length)this.cookie=r.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
  const data=r.headers.get('content-type')?.includes('json')?await r.json():undefined;
  if(data?.csrf)this.csrf=data.csrf;
  return {status:r.status,data};
 }
 async login(role:string){
  const user=account(role);await this.call('/auth/session');
  const result=await this.call('/auth/login','POST',{email:user.email,password:user.password});
  assert.equal(result.status,200,role);
  if(!result.data.contextId){
   const context=result.data.contexts.find((x:any)=>x.role_key===role);
   assert.ok(context,role);
   assert.equal((await this.call('/auth/context','POST',{id:context.id})).status,200);
  }
  return this;
 }
}
const platform=new Client(),organization=new Client();let organizationId:string;
before(async()=>{
 if(!server.listening)await new Promise<void>(resolve=>server.once('listening',resolve));
 base='http://127.0.0.1:'+(server.address() as any).port;
 await platform.login('platform_admin');await organization.login('org_admin');
 organizationId=(await pool.query('SELECT id FROM organizations ORDER BY id LIMIT 1')).rows[0].id;
});
after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));await pool.end()});

test('internal support calendar is isolated, versioned, conflict-aware and auditable',async()=>{
 assert.equal((await new Client().call('/platform/implementation-meetings')).status,401);
 assert.equal((await organization.call('/platform/implementation-meetings')).status,403);
 const idempotencyKey=randomUUID(),start=new Date(Date.now()+2*60*60_000),end=new Date(start.getTime()+60*60_000);
 const input={key:idempotencyKey,title:'Support handover meeting',organizationId:organizationId,
  startsAt:start.toISOString(),endsAt:end.toISOString(),timezone:'Asia/Yerevan',location:'Support room',notes:'Internal agenda'};
 const created=await platform.call('/platform/implementation-meetings','POST',input);
 assert.equal(created.status,201);assert.equal(created.data.status,'scheduled');assert.equal(created.data.version,1);
 const retry=await platform.call('/platform/implementation-meetings','POST',input);
 assert.equal(retry.status,201);assert.equal(retry.data.id,created.data.id);
 assert.equal((await platform.call('/platform/implementation-meetings','POST',{...input,key:randomUUID(),startsAt:new Date(start.getTime()+15*60_000).toISOString(),endsAt:new Date(end.getTime()+15*60_000).toISOString()})).status,409);
 assert.equal((await platform.call('/platform/implementation-meetings','POST',{...input,key:randomUUID(),timezone:'Not/A_Real_Timezone'})).status,400);

 const shiftedStart=new Date(start.getTime()+4*60*60_000),shiftedEnd=new Date(end.getTime()+4*60*60_000);
 const edit={key:randomUUID(),version:1,action:'edit',title:'Rescheduled support handover',
  startsAt:shiftedStart.toISOString(),endsAt:shiftedEnd.toISOString(),timezone:'Asia/Yerevan',location:'Support room',notes:'Updated agenda'};
 const updated=await platform.call(`/platform/implementation-meetings/${created.data.id}/change`,'POST',edit);
 assert.equal(updated.status,200);assert.equal(updated.data.version,2);assert.equal(updated.data.title,edit.title);
 assert.equal((await platform.call(`/platform/implementation-meetings/${created.data.id}/change`,'POST',{...edit,key:randomUUID(),version:1})).status,409);
 const confirmed=await platform.call(`/platform/implementation-meetings/${created.data.id}/change`,'POST',{key:randomUUID(),version:2,action:'confirm'});
 assert.equal(confirmed.status,200);assert.equal(confirmed.data.status,'confirmed');
 assert.equal((await platform.call(`/platform/implementation-meetings/${created.data.id}/change`,'POST',{key:randomUUID(),version:3,action:'complete'})).status,409);
 const cancelled=await platform.call(`/platform/implementation-meetings/${created.data.id}/change`,'POST',{key:randomUUID(),version:3,action:'cancel'});
 assert.equal(cancelled.status,200);assert.equal(cancelled.data.status,'cancelled');
 assert.equal((await platform.call(`/platform/implementation-meetings/${created.data.id}/change`,'POST',{key:randomUUID(),version:4,action:'edit',title:'Should not change'})).status,409);
 const list=await platform.call('/platform/implementation-meetings');
 assert.equal(list.status,200);assert.ok(list.data.meetings.some((x:any)=>x.id===created.data.id));
 assert.equal((await pool.query('SELECT count(*)::int n FROM platform_support_meeting_events WHERE meeting_id=$1',[created.data.id])).rows[0].n,4);
 await assert.rejects(pool.query("UPDATE platform_support_meeting_events SET details='{}' WHERE meeting_id=$1",[created.data.id]),/append-only/);
});
