import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {authenticator} from 'otplib';
import {app} from '../app.js';
import {pool} from '../db.js';
import {config} from '../config.js';
if(config.NODE_ENV!=='test'||!new URL(config.DATABASE_URL).pathname.endsWith('/vernatun_test'))throw new Error('Isolated database required');
const seed=JSON.parse(await readFile('.local/test/demo-accounts.json','utf8'));
const account=(role:string)=>Object.values(seed.accounts).find((a:any)=>a.role===role) as any;
const server=app.listen(0,'127.0.0.1');let base:string;
class Client{
 cookie='';csrf='';
 async call(path:string,method='GET',body?:unknown,csrf=true){
  const r=await fetch(base+'/api'+path,{method,headers:{Cookie:this.cookie,'Content-Type':'application/json',...(method==='GET'||!csrf?{}:{'X-CSRF-Token':this.csrf})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(r.headers.getSetCookie().length)this.cookie=r.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
  const data=r.headers.get('Content-Type')?.includes('json')?await r.json():null;
  if(data?.csrf)this.csrf=data.csrf;return {status:r.status,data};
 }
 async login(role:string,code?:string){
  const a=account(role);await this.call('/auth/session');
  const r=await this.call('/auth/login','POST',{email:a.email,password:a.password,...(code?{code}:{})});
  assert.equal(r.status,200);if(!r.data.contextId){const c=r.data.contexts.find((c:any)=>c.role_key===role);assert.equal((await this.call('/auth/context','POST',{id:c.id})).status,200)}return this;
 }
}
const clients:Record<string,Client>={};
before(async()=>{if(!server.listening)await new Promise<void>(r=>server.once('listening',r));base='http://127.0.0.1:'+(server.address() as any).port;
 for(const role of ['platform_admin','org_admin','manager','unit_owner','support'])clients[role]=await new Client().login(role);
});
after(async()=>{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));await pool.end()});
test('public lead persists only valid consent/contact; CSRF, honeypot, no external delivery',async()=>{
 const p=new Client();await p.call('/auth/session');
 const b={name:'QA Applicant',contact:'qa@example.invalid',organization:'QA',productInterest:'HAYAT',audience:'manager',message:'Original user content',consent:true,language:'hy',website:''};
 assert.equal((await p.call('/leads','POST',b,false)).status,403);
 assert.equal((await p.call('/leads','POST',{...b,consent:false})).status,400);
 assert.equal((await p.call('/leads','POST',{...b,website:'spam'})).status,400);
 assert.equal((await p.call('/leads','POST',{...b,contact:'invalid'})).status,400);
 const r=await p.call('/leads','POST',b);assert.equal(r.status,201);assert.equal(r.data.received,true);
 assert.equal((await pool.query('SELECT message,language FROM leads WHERE id=$1',[r.data.id])).rows[0].message,b.message);
 assert.equal((await p.call('/leads','POST',b)).status,201);
 assert.equal((await p.call('/leads','POST',b)).status,429);
});
test('lead list has independent permission, deterministic bounded paging/search/sort',async()=>{
 assert.equal((await clients.unit_owner.call('/leads')).status,403);
 assert.equal((await clients.support.call('/leads')).status,403);
 const r=await clients.platform_admin.call('/leads?page=1&pageSize=1&q=QA&sort=name&direction=asc');
 assert.equal(r.status,200);assert.equal(r.data.rows.length,1);assert.equal(r.data.total,2);
 const r2=await clients.platform_admin.call('/leads?page=2&pageSize=1&q=QA&sort=name&direction=asc');
 assert.notEqual(r.data.rows[0].id,r2.data.rows[0].id);
 assert.equal((await clients.platform_admin.call('/leads?pageSize=101')).status,400);
 assert.equal((await clients.platform_admin.call('/leads?sort=name%3BDROP')).status,400);
 await pool.query("DELETE FROM role_permissions WHERE role_key='platform_admin' AND permission_key='leads.read'");
 assert.equal((await clients.platform_admin.call('/leads')).status,403);
 await pool.query("INSERT INTO role_permissions(role_key,permission_key) VALUES('platform_admin','leads.read')");
});
test('scoped server records reject invalid sort/limit, preserve legacy array, narrow unit scope',async()=>{
 for(const resource of ['properties','units','people','invitations']){
  const r=await clients.org_admin.call('/paged/'+resource+'?pageSize=1');
  assert.equal(r.status,200);assert.ok(r.data.rows.length<=1);assert.ok(r.data.total>=r.data.rows.length);
 }
 assert.equal((await clients.org_admin.call('/paged/units?pageSize=10000')).status,400);
 assert.equal((await clients.org_admin.call('/paged/units?sort=number%3BDROP')).status,400);
 assert.equal((await clients.unit_owner.call('/paged/organizations')).status,403);
 const c=(await clients.unit_owner.call('/auth/session')).data.contexts.find((c:any)=>c.role_key==='unit_owner');
 const own=await clients.unit_owner.call('/paged/units');assert.equal(own.status,200);assert.ok(own.data.rows.every((u:any)=>u.id===c.unit_id));
 const legacy=await clients.org_admin.call('/units');assert.ok(Array.isArray(legacy.data));
});
test('14 role dashboards use real scoped cards and no duplicate metric keys',async()=>{
 const roles=[...new Set(Object.values(seed.accounts).map((a:any)=>a.role))];
 assert.equal(roles.length,14);
 for(const role of roles){const c=clients[role as string]??await new Client().login(role as string);
  const r=await c.call('/role-insights?currency=AMD');assert.equal(r.status,200,role as string);
  assert.ok(Array.isArray(r.data.cards));assert.equal(new Set(r.data.cards.map((x:any)=>x.key)).size,r.data.cards.length,role as string);
 }
});
let recovery:string[];
test('MFA policy defaults optional; no automatic lockdown; enrollment/proof and rollout grace required',async()=>{
 const c=clients.org_admin;
 const before=await c.call('/mfa/policy');assert.equal(before.data.policy.required,false);assert.equal(before.data.policy.version,0);
 const future=new Date(Date.now()+2*86400000).toISOString();
 assert.equal((await c.call('/mfa/policy','PUT',{required:true,enforceAfter:future,version:0,reason:'Safe QA rollout'})).status,403);
 assert.equal((await clients.unit_owner.call('/mfa/policy','PUT',{required:false,enforceAfter:null,version:0,reason:'Not authorized'})).status,403);
 const setup=await c.call('/mfa/setup','POST',{password:account('org_admin').password});assert.equal(setup.status,200);
 const enable=await c.call('/mfa/enable','POST',{code:authenticator.generate(setup.data.secret)});assert.equal(enable.status,200);recovery=enable.data.recoveryCodes;
 assert.equal((await c.call('/mfa/policy','PUT',{required:true,enforceAfter:new Date().toISOString(),version:0,reason:'Too soon activation'})).status,400);
 const r=await c.call('/mfa/policy','PUT',{required:true,enforceAfter:future,version:0,reason:'Safe QA rollout'});assert.equal(r.status,200);assert.equal(r.data.version,1);
 assert.equal((await c.call('/mfa/policy','PUT',{required:false,enforceAfter:null,version:0,reason:'Stale save blocked'})).status,409);
 assert.equal((await c.call('/mfa/disable','POST',{password:account('org_admin').password,code:recovery[0]})).status,403);
});
test('required MFA gates existing unverified sessions, retains enrollment route, recovery one-time and revocation',async()=>{
 const c=clients.org_admin,id=account('org_admin').id;
 await pool.query("UPDATE mfa_policies SET enforce_after=now()-interval '1 minute' WHERE role_key='org_admin'");
 // Clear proof on this user's sessions without relying on cookie signature encoding.
 await pool.query("UPDATE session SET sess=sess::jsonb-'mfaVerifiedAt' WHERE sess->'passport'->>'user'=$1",[id]);
 assert.equal((await c.call('/units')).status,403);
 assert.equal((await c.call('/mfa/status')).status,200);
 assert.equal((await c.call('/auth/session')).status,200);
 assert.equal((await c.call('/auth/reauthenticate','POST',{password:account('org_admin').password,code:recovery[0]})).status,200);
 assert.equal((await c.call('/units')).status,200);
 assert.equal((await c.call('/auth/reauthenticate','POST',{password:account('org_admin').password,code:recovery[0]})).status,401);
 const d=await c.call('/mfa/policy','PUT',{required:false,enforceAfter:null,version:1,reason:'QA rollout rollback'});assert.equal(d.status,200);
 assert.equal((await c.call('/mfa/disable','POST',{password:account('org_admin').password,code:recovery[1]})).status,200);
 assert.equal((await c.call('/auth/logout','POST')).status,204);
 assert.equal((await c.call('/units')).status,401);
});
