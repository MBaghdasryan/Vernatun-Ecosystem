import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {app} from '../app.js';
import {pool} from '../db.js';
import {config} from '../config.js';
import {startRoute,viewRoute} from '../../shared/products.js';

if(config.NODE_ENV!=='test'||!new URL(config.DATABASE_URL).pathname.endsWith('/vernatun_test'))
 throw new Error('Phase 1 checks require the isolated test database');
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
  const data=response.status===204?null:await response.json();
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
 for(const key of ['platform_admin','org_admin','support'])clients[key]=await new Client().login(key);
});
after(async()=>{server.close();server.closeAllConnections();await pool.end()});

test('Platform invitation list and revocation use platform.invite, while organization scope stays isolated',async()=>{
 const platform=clients.platform_admin,org=clients.org_admin;
 const pc=(await platform.call('/auth/session')).data.contexts.find((c:any)=>c.id===platform.contextId);
 assert.ok(pc.permissions.includes('platform.invite'));
 assert.equal(pc.permissions.includes('people.invite'),false);
 const a=await platform.call('/invitations','POST',{email:randomUUID()+'@example.test',role:'org_admin',organizationId:seeded.fixtures.orgA});
 const b=await platform.call('/invitations','POST',{email:randomUUID()+'@example.test',role:'org_admin',organizationId:seeded.fixtures.orgB});
 assert.equal(a.status,201);assert.equal(b.status,201);
 const all=await platform.call('/invitations');
 assert.equal(all.status,200);
 assert.ok(all.data.some((i:any)=>i.id===a.data.id)&&all.data.some((i:any)=>i.id===b.data.id));
 const own=await org.call('/invitations');
 assert.equal(own.status,200);
 assert.ok(own.data.some((i:any)=>i.id===a.data.id));
 assert.equal(own.data.some((i:any)=>i.id===b.data.id),false);
 assert.ok(own.data.every((i:any)=>i.organization_id===seeded.fixtures.orgA));
 assert.equal((await org.call('/invitations/'+b.data.id,'DELETE')).status,404);
 assert.equal((await platform.call('/invitations/'+b.data.id,'DELETE')).status,204);
 const event=(await pool.query("SELECT organization_id FROM audit_events WHERE action='invitation.revoke' AND entity_id=$1",[b.data.id])).rows[0];
 assert.equal(event.organization_id,seeded.fixtures.orgB);
});

test('Platform audit includes organization events and structured details without leaking another organization to org admin',async()=>{
 const first=randomUUID(),second=randomUUID();
 await pool.query(`INSERT INTO audit_events(organization_id,actor_user_id,action,entity_type,entity_id,details)
  VALUES($1,$2,'qa.phase1','organization',$3,'{"previous":"active","new":"suspended"}'),
  ($4,$2,'qa.phase1','organization',$5,'{"reason":"isolated regression"}')`,
 [seeded.fixtures.orgA,seeded.accounts.platform_admin.id,first,seeded.fixtures.orgB,second]);
 const all=await clients.platform_admin.call('/audit');
 assert.equal(all.status,200);
 const own=all.data.find((e:any)=>e.entity_id===first);
 assert.ok(own);assert.equal(own.organization_id,seeded.fixtures.orgA);
 assert.deepEqual(own.details,{previous:'active',new:'suspended'});
 assert.ok(all.data.some((e:any)=>e.entity_id===second));
 const limited=await clients.org_admin.call('/audit');
 assert.equal(limited.status,200);
 assert.ok(limited.data.some((e:any)=>e.entity_id===first));
 assert.equal(limited.data.some((e:any)=>e.entity_id===second),false);
});

test('Approved temporary support context starts on its permitted import screen, not the forbidden grants screen',async()=>{
 const support=clients.support;
 const requested=await support.call('/support/grants','POST',{organizationId:seeded.fixtures.orgA,reason:'Scoped import regression check',permissions:['imports.manage'],hours:1});
 assert.equal(requested.status,201);
 assert.equal((await clients.org_admin.call('/support/grants/'+requested.data.id+'/approve','POST',{})).status,200);
 try{
  assert.equal((await support.call('/auth/context','POST',{id:requested.data.id})).status,200);
  const session=(await support.call('/auth/session')).data;
  const c=session.contexts.find((c:any)=>c.id===session.contextId);
  assert.deepEqual(c.permissions,['imports.manage']);
  assert.equal(c.startRoute,'/console/imports');
  assert.equal(viewRoute('console','overview','support',c),'/console/imports');
  assert.equal((await support.call('/imports')).status,200);
  assert.equal((await support.call('/support/grants')).status,403);
  assert.equal((await support.call('/invoices')).status,403);
  await pool.query("UPDATE support_access_grants SET expires_at=now()-interval '1 minute' WHERE id=$1",[requested.data.id]);
  assert.equal((await support.call('/imports')).status,403);
 }finally{await support.call('/auth/context','POST',{id:support.contextId})}
});

test('Temporary support start routes honor the exact permissions and disabled modules; ordinary support route is preserved',()=>{
 assert.equal(startRoute('support',{organization_id:seeded.fixtures.orgA,permissions:['properties.read']}),'/console/properties');
 assert.equal(startRoute('support',{organization_id:seeded.fixtures.orgA,permissions:['requests.read'],modules:['requests']}),'/console/requests');
 assert.equal(startRoute('support',{organization_id:seeded.fixtures.orgA,permissions:['requests.read'],modules:[]}),'/context');
 assert.equal(startRoute('support',{organization_id:null,permissions:['support.access.request']}),'/console/onboarding');
});
