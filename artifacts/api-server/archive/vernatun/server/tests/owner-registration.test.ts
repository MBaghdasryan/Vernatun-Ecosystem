import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHmac,randomUUID} from 'node:crypto';
import {app} from '../app.js';
import {pool} from '../db.js';
import {config} from '../config.js';

if(config.NODE_ENV!=='test'||!new URL(config.DATABASE_URL).pathname.endsWith('/vernatun_test'))throw new Error('Isolated database required');
const seed=JSON.parse(await readFile('.local/test/demo-accounts.json','utf8'));
const server=app.listen(0,'127.0.0.1');
let base='';

class Client{
 cookie='';csrf='';contexts:any[]=[];
 async call(path:string,method='GET',body?:unknown){
  const response=await fetch(base+'/api'+path,{method,headers:{
   'Content-Type':'application/json',Cookie:this.cookie,
   ...(method!=='GET'?{'X-CSRF-Token':this.csrf}:{})
  },...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(response.headers.getSetCookie().length)this.cookie=response.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
  const data=response.status===204?null:await response.json();
  if(data?.csrf)this.csrf=data.csrf;
  if(data?.contexts)this.contexts=data.contexts;
  return {status:response.status,data};
 }
 async login(account:any){
  await this.call('/auth/session');
  const result=await this.call('/auth/login','POST',{email:account.email,password:account.password});
  assert.equal(result.status,200);
  this.contexts=result.data.contexts;
  const context=this.contexts.find((c:any)=>c.role_key===account.role);
  if(context){
   const selected=await this.call('/auth/context','POST',{id:context.id});
   assert.equal(selected.status,200);
  }
  return this;
 }
}

let customerOrg:string,customerBuilding:string,customerUnit:string,organizationAdmin:Client,platformAdmin:Client;
before(async()=>{
 await new Promise<void>(resolve=>server.listening?resolve():server.on('listening',resolve));
 base='http://127.0.0.1:'+(server.address() as {port:number}).port;
 const schema=(await pool.query('SELECT current_schema() AS name')).rows[0].name;
 assert.match(schema,/^qa_[a-f0-9]{20}$/);
 organizationAdmin=await new Client().login(seed.accounts.org_admin);
 platformAdmin=await new Client().login(seed.accounts.platform_admin);
 customerOrg=organizationAdmin.contexts.find((c:any)=>c.role_key==='org_admin').organization_id;
 const unit=(await pool.query(`SELECT id,building_id FROM units
  WHERE organization_id=$1 ORDER BY id LIMIT 1`,[customerOrg])).rows[0];
 assert.ok(unit,'seeded management-company unit is required');
 customerBuilding=unit.building_id;customerUnit=unit.id;
 await pool.query('UPDATE organizations SET status=$2,is_demo=false,subscription_enforced=true WHERE id=$1',[customerOrg,'active']);
 await pool.query('UPDATE buildings SET is_demo=false WHERE id=$1',[customerBuilding]);
 await pool.query('UPDATE units SET is_demo=false WHERE id=$1',[customerUnit]);
 const plan=(await pool.query(`INSERT INTO subscription_plans(name,amount_minor,currency,building_limit,allowed_modules)
  VALUES('Owner registration test',0,'AMD',100,ARRAY['community']) RETURNING id`)).rows[0].id;
 await pool.query(`INSERT INTO subscriptions(organization_id,plan_id,starts_on,ends_on,status,created_by)
  VALUES($1,$2,CURRENT_DATE-1,CURRENT_DATE+30,'active',$3)`,[customerOrg,plan,seed.accounts.org_admin.id]);
 await pool.query(`INSERT INTO module_entitlements(organization_id,module,enabled,override_state)
  VALUES($1,'community',true,'enabled') ON CONFLICT(organization_id,module)
  DO UPDATE SET enabled=true,override_state='enabled'`,[customerOrg]);
});

after(async()=>{
 await new Promise<void>(resolve=>server.close(()=>resolve()));
});

async function registerOwner(email:string){
 const anonymous=new Client();await anonymous.call('/auth/session');
 const result=await anonymous.call('/auth/owner-registration','POST',{
  name:'QA Owner',email,password:'QA-owner-password-2026!',unitId:customerUnit,locale:'en'
 });
 assert.equal(result.status,201);
 const account=(await pool.query('SELECT id FROM users WHERE lower(email)=$1',[email])).rows[0];
 assert.ok(account);
 assert.equal((await pool.query(`SELECT count(*)::int AS count FROM role_assignments WHERE user_id=$1`,[account.id])).rows[0].count,0);
 const knownCode='246810';
 const digest=createHmac('sha256',config.SESSION_SECRET).update(account.id+'\0'+email+'\0'+knownCode).digest('hex');
 await pool.query('UPDATE resident_email_challenges SET code_hash=$2,attempts=0,expires_at=now()+interval \'5 minutes\' WHERE user_id=$1',[account.id,digest]);
 const user=new Client();await user.login({email,password:'QA-owner-password-2026!',role:'unit_owner'});
 assert.equal(user.contexts.length,0);
 assert.equal((await user.call('/auth/owner-registration/verify-email','POST',{code:knownCode})).status,204);
 const status=await user.call('/auth/owner-registration/status');
 assert.equal(status.status,200);
 assert.equal(status.data.emailVerified,true);
 assert.equal(status.data.requests[0].status,'pending_approval');
 return {user,id:account.id,requestId:status.data.requests[0].id,email};
}

test('owner registration stays unprivileged until organization approval; company decisions are tenant-scoped',async()=>{
 const catalog=await new Client().call('/auth/owner-registration/catalog');
 assert.equal(catalog.status,200);
 assert.ok(catalog.data.buildings.some((building:any)=>building.organizationId===customerOrg&&
  building.units.some((unit:any)=>unit.id===customerUnit)));
 const bad=new Client();await bad.call('/auth/session');
 assert.equal((await bad.call('/auth/owner-registration','POST',{
  name:'Role injection',email:`${randomUUID()}@vernatun.test`,password:'QA-owner-password-2026!',
  unitId:customerUnit,role:'platform_admin'
 })).status,400);

 const rejected=await registerOwner(`${randomUUID()}@vernatun.test`);
 assert.equal((await platformAdmin.call('/owner-access-requests')).status,403);
 const queue=await organizationAdmin.call('/owner-access-requests');
 assert.equal(queue.status,200);
 assert.ok(queue.data.requests.some((request:any)=>request.id===rejected.requestId));
 const missingReason=await organizationAdmin.call(`/owner-access-requests/${rejected.requestId}/decision`,'POST',{decision:'reject'});
 assert.equal(missingReason.status,400);
 const reject=await organizationAdmin.call(`/owner-access-requests/${rejected.requestId}/decision`,'POST',{
  decision:'reject',note:'Ownership documents need review'
 });
 assert.equal(reject.status,200);
 assert.equal(reject.data.status,'rejected');
 assert.equal((await pool.query(`SELECT count(*)::int AS count FROM role_assignments
  WHERE user_id=$1 AND role_key='unit_owner'`,[rejected.id])).rows[0].count,0);

 const approved=await registerOwner(`${randomUUID()}@vernatun.test`);
 const decision=await organizationAdmin.call(`/owner-access-requests/${approved.requestId}/decision`,'POST',{decision:'approve'});
 assert.equal(decision.status,200);
 assert.equal(decision.data.status,'approved');
 await approved.user.call('/auth/session');
 const ownerContext=approved.user.contexts.find((c:any)=>c.role_key==='unit_owner'&&c.unit_id===customerUnit);
 assert.ok(ownerContext,'approved owner context must be server-issued');
 assert.equal((await approved.user.call('/auth/context','POST',{id:ownerContext.id})).status,200);
 const invitation=await approved.user.call('/resident/owner-renter-invitations','POST',{
  email:`${randomUUID()}@vernatun.test`,
  expiresAt:new Date(Date.now()+7*24*60*60*1000).toISOString(),
  permissions:['requests.own','requests.create','announcements.read']
 });
 assert.equal(invitation.status,201);
 assert.ok(invitation.data.url);
});
