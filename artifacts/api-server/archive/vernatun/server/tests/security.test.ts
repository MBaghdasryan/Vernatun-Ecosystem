import {contexts} from '../access.js';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,rm} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {authenticator} from 'otplib';
import {app} from '../app.js';
import {pool} from '../db.js';
import {config} from '../config.js';
if(config.NODE_ENV!=='test'||!new URL(config.DATABASE_URL).pathname.endsWith('/vernatun_test'))throw new Error('Tests require isolated vernatun_test database');
const seeded=JSON.parse(await readFile('.local/test/demo-accounts.json','utf8'));
let base='';const server=app.listen(0,'127.0.0.1');
class Client{cookie='';csrf='';async call(path:string,method='GET',body?:unknown,csrf=true){const r=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',...(this.cookie?{Cookie:this.cookie}:{}),...(csrf&&method!=='GET'?{'X-CSRF-Token':this.csrf}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});const cookies=r.headers.getSetCookie();if(cookies.length)this.cookie=cookies.map(x=>x.split(';')[0]).join('; ');const data=r.status===204?null:await r.json();if(data?.csrf)this.csrf=data.csrf;return {status:r.status,data}}async login(key:string){const a=seeded.accounts[key];await this.call('/auth/session');const r=await this.call('/auth/login','POST',{email:a.email,password:a.password});assert.equal(r.status,200);if(!r.data.contextId){const id=r.data.contexts.find((x:any)=>x.role_key===a.role).id;assert.equal((await this.call('/auth/context','POST',{id})).status,200)}return this}}
let platform:Client,org:Client,other:Client,family:Client,renter:Client,owner:Client,technician:Client,contractor:Client,support:Client;
before(async()=>{await pool.query("DELETE FROM auth_rate_limits");await new Promise<void>(r=>server.listening?r():server.on('listening',r));const addr=server.address() as {port:number};base='http://127.0.0.1:'+addr.port;platform=await new Client().login('platform_admin');org=await new Client().login('org_admin');other=await new Client().login('second_org');family=await new Client().login('family');renter=await new Client().login('renter');owner=await new Client().login('unit_owner');technician=await new Client().login('technician');contractor=await new Client().login('contractor');support=await new Client().login('support')});
after(async()=>{server.close();server.closeAllConnections();await pool.end()});
test('All fourteen roles expose product routes without additional permissions; disabled finance hides manager OS',async()=>{
 const expected:Record<string,string>={platform_admin:'/console/overview',support:'/console/onboarding',org_admin:'/os/organization',portfolio_owner:'/os/portfolio',developer:'/os/development',accountant:'/os/accounting',manager:'/hayat/management',dispatcher:'/hayat/dispatch',technician:'/hayat/my-work',contractor:'/hayat/contractor',security:'/hayat/security',unit_owner:'/imtun/owner',renter:'/imtun/renter',family:'/imtun/family'};
 for(const [role,path] of Object.entries(expected)){const c=(await contexts(seeded.accounts[role].id)).find(x=>x.role_key===role)!;assert.equal(c.startRoute,path);assert.equal(c.product,path.split('/')[1]);if(!['platform_admin','support'].includes(role))assert.ok(!c.products?.includes('console'));}
 const c=(await org.call('/auth/session')).data.contexts.find((x:any)=>x.role_key==='org_admin');assert.deepEqual(c.products,['os']);assert.ok(!c.permissions.includes('billing.read'));
 const before=(await contexts(seeded.accounts.manager.id)).find(c=>c.role_key==='manager')!;assert.ok(before.products?.includes('os'));
 try{await pool.query("UPDATE module_entitlements SET enabled=false WHERE organization_id=$1 AND module='finance'",[seeded.fixtures.orgA]);const after=(await contexts(seeded.accounts.manager.id)).find(c=>c.role_key==='manager')!;assert.deepEqual(after.products,['hayat']);assert.deepEqual(after.permissions,before.permissions)}finally{await pool.query("UPDATE module_entitlements SET enabled=true WHERE organization_id=$1 AND module='finance'",[seeded.fixtures.orgA])}
});
test('Unauthenticated reads are rejected; mutations require CSRF',async()=>{assert.equal((await new Client().call('/properties')).status,401);assert.equal((await org.call('/properties','POST',{name:'test',address:'test'},false)).status,403)});
test('Default locale and currency are Armenian/AMD; preferences are validated',async()=>{const s=await family.call('/auth/session');assert.equal(s.data.user.locale,'hy');assert.equal(s.data.user.currency,'AMD');assert.equal((await family.call('/auth/preferences','PATCH',{locale:'xx',currency:'EUR'})).status,400)});
test('Organizations are isolated and substituting unit IDs fails',async()=>{const a=await org.call('/properties'),b=await other.call('/properties');assert.ok(a.data.every((x:any)=>x.id!==seeded.fixtures.bb));assert.ok(b.data.every((x:any)=>x.id!==seeded.fixtures.ba));assert.equal((await org.call('/units/'+seeded.fixtures.ub)).status,404);assert.equal((await other.call('/units/'+seeded.fixtures.ua)).status,404);assert.equal((await owner.call('/units/'+seeded.fixtures.ua2)).status,404)});
test('Family cannot read finances; admin role does not imply finance permission',async()=>{assert.equal((await family.call('/invoices')).status,403);assert.equal((await org.call('/invoices')).status,403);assert.equal((await platform.call('/invoices')).status,403)});
test('Tenant sees only obligations assigned to their own user',async()=>{const a=await renter.call('/invoices');assert.equal(a.status,200);assert.equal(a.data.length,1);assert.equal(a.data[0].amount_minor,'1250000');const b=await owner.call('/invoices');assert.ok(b.data.some((i:any)=>i.amount_minor==='2450000'));const ownIds=(await pool.query('SELECT id FROM invoices WHERE payer_user_id=$1',[seeded.accounts.unit_owner.id])).rows.map(i=>i.id);assert.ok(b.data.every((i:any)=>ownIds.includes(i.id)));assert.equal((await renter.call('/invoices?currency=USD')).data.length,0)});
test('Role context switch cannot assign ungranted authority',async()=>{const s=await platform.call('/auth/session');assert.equal((await family.call('/auth/context','POST',{id:s.data.contextId})).status,403)});
test('Technician, contractor and support cannot browse residents or finances',async()=>{for(const c of [technician,contractor,support]){assert.equal((await c.call('/people')).status,403);assert.equal((await c.call('/invoices')).status,403);assert.equal((await c.call('/units')).status,403)}});
test('Organization admin cannot issue a platform role or foreign-unit invitation',async()=>{assert.equal((await org.call('/invitations','POST',{email:'forbidden@vernatun.test',role:'platform_admin'})).status,403);assert.equal((await org.call('/invitations','POST',{email:'forbidden@vernatun.test',role:'family',buildingId:seeded.fixtures.bb,unitId:seeded.fixtures.ub})).status,404)});
test('Revoking role takes effect on the next direct API request',async()=>{const id=(await family.call('/auth/session')).data.contextId;try{assert.equal((await org.call('/roles/'+id,'DELETE')).status,204);assert.equal((await family.call('/properties')).status,403)}finally{await pool.query('UPDATE role_assignments SET active=true WHERE id=$1',[id])}});
test('Expired assignments are rejected even with an existing session',async()=>{const id=(await renter.call('/auth/session')).data.contextId;const before=(await pool.query('SELECT starts_at,expires_at FROM role_assignments WHERE id=$1',[id])).rows[0];try{await pool.query("UPDATE role_assignments SET starts_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE id=$1",[id]);assert.equal((await renter.call('/invoices')).status,403)}finally{await pool.query('UPDATE role_assignments SET starts_at=$1,expires_at=$2 WHERE id=$3',[before.starts_at,before.expires_at,id])}});
test('Disabled modules cannot be accessed through API',async()=>{
 const initial=await org.call('/modules');
 const finance=initial.data.modules.find((m:any)=>m.module==='finance');
 assert.ok(finance);
 try{
  assert.equal((await org.call('/modules/finance','PATCH',{enabled:false,expectedUpdatedAt:finance.updatedAt})).status,200);
  assert.equal((await owner.call('/invoices')).status,403);
 }finally{
  const current=await org.call('/modules');
  const latest=current.data.modules.find((m:any)=>m.module==='finance');
  if(latest&&!latest.enabled)assert.equal((await org.call('/modules/finance','PATCH',{enabled:true,expectedUpdatedAt:latest.updatedAt})).status,200);
 }
});
test('Published financial rows are immutable at database level',async()=>{const invoice=(await owner.call('/invoices')).data[0];await assert.rejects(pool.query('UPDATE invoices SET amount_minor=1 WHERE id=$1',[invoice.id]),/immutable/)});
test('Organization onboarding links create a separate account with limited scope; block revokes session',async()=>{
 const tag=randomBytes(5).toString('hex');
 const created=await platform.call('/organizations','POST',{name:'Test organization '+tag,currency:'AMD'});assert.equal(created.status,201);
 const invite=await platform.call('/invitations','POST',{email:tag+'@vernatun.test',role:'org_admin',organizationId:created.data.id});assert.equal(invite.status,201);
 const token=new URL(invite.data.url).searchParams.get('token');
 const guest=new Client();await guest.call('/auth/session');
 const password=randomBytes(18).toString('base64url');
 assert.equal((await guest.call('/auth/accept-invitation','POST',{token,name:'Test administrator',password})).status,200);
 assert.equal((await guest.call('/auth/accept-invitation','POST',{token,name:'Test administrator',password})).status,400);
 const login=await guest.call('/auth/login','POST',{email:tag+'@vernatun.test',password});assert.equal(login.status,200);
 assert.equal(login.data.contexts.length,1);assert.equal(login.data.contexts[0].organization_id,created.data.id);
 const building=await guest.call('/properties','POST',{name:'Test building',address:'Demo address'});assert.equal(building.status,201);
 assert.equal((await guest.call('/units','POST',{buildingId:building.data.id,number:'1',area:45})).status,201);
 assert.equal((await guest.call('/units/'+seeded.fixtures.ua)).status,404);
 // Preserve the last-administrator guard; only a tenant with another active admin can lose this account.
 assert.equal((await platform.call('/users/'+login.data.user.id+'/block','POST',{})).status,409);
 await pool.query('INSERT INTO memberships(user_id,organization_id) VALUES($1,$2)',[seeded.accounts.org_admin.id,created.data.id]);
 await pool.query("INSERT INTO role_assignments(user_id,organization_id,role_key) VALUES($1,$2,'org_admin')",[seeded.accounts.org_admin.id,created.data.id]);
 assert.equal((await platform.call('/users/'+login.data.user.id+'/block','POST',{})).status,204);
 assert.equal((await guest.call('/properties')).status,401);
});
test('Revoked invitation cannot be accepted',async()=>{const invite=await org.call('/invitations','POST',{email:randomBytes(5).toString('hex')+'@vernatun.test',role:'technician'});assert.equal(invite.status,201);assert.equal((await org.call('/invitations/'+invite.data.id,'DELETE')).status,204);const guest=new Client();await guest.call('/auth/session');assert.equal((await guest.call('/auth/accept-invitation','POST',{token:new URL(invite.data.url).searchParams.get('token'),name:'Test',password:randomBytes(18).toString('base64url')})).status,400)});
test('Every required role exists as a separate account with server-resolved context',async()=>{const r=await pool.query('SELECT count(DISTINCT user_id)::int AS total,count(DISTINCT role_key)::int AS roles FROM role_assignments');assert.ok(r.rows[0].total>=15);assert.equal(r.rows[0].roles,14)});
test('Expired invitation is rejected',async()=>{const r=await org.call('/invitations','POST',{email:randomBytes(5).toString('hex')+'@vernatun.test',role:'technician'});assert.equal(r.status,201);await pool.query("UPDATE invitations SET expires_at=now()-interval '1 day' WHERE id=$1",[r.data.id]);const guest=new Client();await guest.call('/auth/session');assert.equal((await guest.call('/auth/accept-invitation','POST',{token:new URL(r.data.url).searchParams.get('token'),name:'Test person',password:randomBytes(18).toString('base64url')})).status,400)});
test('Password reset token is single-use and revokes existing sessions',async()=>{const user=seeded.accounts.family;const oldHash=(await pool.query('SELECT password_hash FROM users WHERE id=$1',[user.id])).rows[0].password_hash;const guest=new Client();await guest.call('/auth/session');try{assert.equal((await guest.call('/auth/forgot-password','POST',{email:user.email})).status,200);const file=JSON.parse(await readFile(`.local/test/outbox/reset-${user.id}.json`,'utf8'));const token=new URL(file.url).searchParams.get('token');const password=randomBytes(18).toString('base64url');assert.equal((await guest.call('/auth/reset-password','POST',{token,password})).status,204);assert.equal((await family.call('/properties')).status,401);assert.equal((await guest.call('/auth/reset-password','POST',{token,password})).status,400)}finally{await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2',[oldHash,user.id])}});
test('CLI-recovered account must pass MFA and change its password before using Vernatun',async()=>{
 const account=seeded.accounts.support;
 const original=(await pool.query('SELECT password_hash,must_change_password FROM users WHERE id=$1',[account.id])).rows[0];
 const originalMfa=(await pool.query('SELECT * FROM mfa_credentials WHERE user_id=$1',[account.id])).rows[0];
 if(originalMfa?.enabled)return;
 const script=fileURLToPath(new URL('../scripts/recover-global-account.mjs',import.meta.url));
 let credentialFile='';
 try{
  const setup=await support.call('/mfa/setup','POST',{password:account.password});
  assert.equal(setup.status,200);
  const enabled=await support.call('/mfa/enable','POST',{code:authenticator.generate(setup.data.secret)});
  assert.equal(enabled.status,200);
  const priorSession=(await pool.query(`SELECT sid,sess,expire FROM session
   WHERE sess->'passport'->>'user'=$1 AND expire>now() LIMIT 1`,[account.id])).rows[0];
  assert.ok(priorSession);

  const recovered=spawnSync(process.execPath,[script,`--email=${account.email}`,'--role=support',
   '--confirm-production-account-recovery'],{
   encoding:'utf8',maxBuffer:1024*1024,
   env:{...process.env,NODE_ENV:'test',DATABASE_URL:config.DATABASE_URL,VERNATUN_ACCOUNT_RECOVERY_TEST_MODE:'1'},
  });
  assert.equal(recovered.status,0,recovered.stderr);
  const summary=JSON.parse(recovered.stdout);
  credentialFile=summary.privateCredentialsFile;
  const credential=JSON.parse(await readFile(credentialFile,'utf8'));
  const temporaryPassword=credential.password as string;
  assert.equal(summary.passwordPrinted,false);
  assert.equal(recovered.stdout.includes(temporaryPassword),false);
  assert.equal(recovered.stderr.includes(temporaryPassword),false);
  assert.equal((await pool.query('SELECT must_change_password FROM users WHERE id=$1',[account.id])).rows[0].must_change_password,true);
  assert.equal((await pool.query('SELECT enabled FROM mfa_credentials WHERE user_id=$1',[account.id])).rows[0].enabled,true);

  // Simulate an in-flight old session saving after the CLI's DELETE: the tombstone must still win.
  await pool.query(`INSERT INTO session(sid,sess,expire) VALUES($1,$2::json,$3)
   ON CONFLICT(sid) DO UPDATE SET sess=EXCLUDED.sess,expire=EXCLUDED.expire`,
   [priorSession.sid,JSON.stringify(priorSession.sess),priorSession.expire]);
  const replayed=await support.call('/auth/session');
  assert.equal(replayed.status,200);
  assert.equal(replayed.data.user,null);

  const fresh=new Client();
  await fresh.call('/auth/session');
  const withoutMfa=await fresh.call('/auth/login','POST',{email:account.email,password:temporaryPassword});
  assert.equal(withoutMfa.status,401);
  assert.equal(withoutMfa.data.error,'mfa_required');
  const login=await fresh.call('/auth/login','POST',{
   email:account.email,password:temporaryPassword,code:enabled.data.recoveryCodes[0],
  });
  assert.equal(login.status,200);
  assert.equal(login.data.user.mustChangePassword,true);
  assert.deepEqual(login.data.contexts,[]);
  const forcedSession=await fresh.call('/auth/session');
  assert.equal(forcedSession.data.user.mustChangePassword,true);
  assert.deepEqual(forcedSession.data.contexts,[]);
  assert.equal((await fresh.call('/properties')).data.error,'password_change_required');
  assert.equal((await fresh.call('/auth/preferences','PATCH',{locale:'en',currency:'USD'})).data.error,'password_change_required');
  await pool.query('DELETE FROM auth_rate_limits');
  assert.equal((await fresh.call('/auth/first-login-password','POST',{
   currentPassword:'wrong temporary password',password:randomBytes(24).toString('base64url'),
  })).data.error,'invalid_credentials');
  const newPassword=randomBytes(24).toString('base64url');
  assert.equal((await fresh.call('/auth/first-login-password','POST',{
   currentPassword:temporaryPassword,password:newPassword,
  })).status,204);
  const completed=await fresh.call('/auth/session');
  assert.equal(completed.data.user.mustChangePassword,false);
  assert.ok(completed.data.contexts.some((c:any)=>c.role_key==='support'));
  const audit=await pool.query(`SELECT details FROM audit_events WHERE actor_user_id=$1
   AND action='auth.password.first_login.change' ORDER BY id DESC LIMIT 1`,[account.id]);
  assert.equal(JSON.stringify(audit.rows).includes(temporaryPassword),false);
  assert.equal(JSON.stringify(audit.rows).includes(newPassword),false);
 }finally{
  await pool.query('UPDATE users SET password_hash=$1,must_change_password=$2 WHERE id=$3',
   [original.password_hash,original.must_change_password,account.id]);
  await pool.query('DELETE FROM mfa_credentials WHERE user_id=$1',[account.id]);
  if(originalMfa)await pool.query(`INSERT INTO mfa_credentials
   (user_id,secret_encrypted,pending_secret,pending_until,enabled,last_counter,recovery_hashes)
   VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(user_id) DO UPDATE SET
   secret_encrypted=EXCLUDED.secret_encrypted,pending_secret=EXCLUDED.pending_secret,
   pending_until=EXCLUDED.pending_until,enabled=EXCLUDED.enabled,last_counter=EXCLUDED.last_counter,
   recovery_hashes=EXCLUDED.recovery_hashes`,
   [account.id,originalMfa.secret_encrypted,originalMfa.pending_secret,originalMfa.pending_until,
    originalMfa.enabled,originalMfa.last_counter,originalMfa.recovery_hashes]);
  await pool.query(`DELETE FROM session WHERE sess->'passport'->>'user'=$1`,[account.id]);
  if(credentialFile)await rm(credentialFile,{force:true});
 }
});
test('Login attempts are rate limited',async()=>{const guest=new Client();await guest.call('/auth/session');let blocked=false;for(let i=0;i<21;i++){const r=await guest.call('/auth/login','POST',{email:'missing@vernatun.test',password:'not-a-real-password'});if(r.status===429){blocked=true;break}assert.equal(r.status,401)}assert.ok(blocked)});
