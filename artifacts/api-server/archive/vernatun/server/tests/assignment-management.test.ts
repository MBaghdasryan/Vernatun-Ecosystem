import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {app} from '../app.js';
import {pool} from '../db.js';
import {config} from '../config.js';
if(config.NODE_ENV!=='test'||!new URL(config.DATABASE_URL).pathname.endsWith('/vernatun_test'))throw new Error('Isolated test DB required');
const seeded=JSON.parse(await readFile('.local/test/demo-accounts.json','utf8'));
const server=app.listen(0,'127.0.0.1');
let base='',org:Client,manager:Client,other:Client,assignment:any,adminAssignment:any;
class Client{
 cookie='';csrf='';
 async call(path:string,method='GET',body?:unknown){
  const r=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',Cookie:this.cookie,'X-CSRF-Token':this.csrf},...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(r.headers.getSetCookie().length)this.cookie=r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
  const data=r.status===204?null:await r.json();if(data?.csrf)this.csrf=data.csrf;return {status:r.status,data};
 }
 async login(key:string){
  const a=seeded.accounts[key];await this.call('/auth/session');
  const r=await this.call('/auth/login','POST',{email:a.email,password:a.password});assert.equal(r.status,200);
  const ctx=r.data.contexts.find((c:any)=>c.role_key===a.role);
  assert.equal((await this.call('/auth/context','POST',{id:ctx.id})).status,200);return this;
 }
}
before(async()=>{
 await pool.query('DELETE FROM auth_rate_limits');
 await new Promise<void>(r=>server.listening?r():server.on('listening',r));
 base='http://127.0.0.1:'+(server.address() as {port:number}).port;
 org=await new Client().login('org_admin');manager=await new Client().login('manager');other=await new Client().login('second_org');
 assignment=(await pool.query("SELECT * FROM role_assignments WHERE user_id=$1 AND role_key='dispatcher'",[seeded.accounts.dispatcher.id])).rows[0];
 adminAssignment=(await pool.query("SELECT * FROM role_assignments WHERE user_id=$1 AND role_key='org_admin'",[seeded.accounts.org_admin.id])).rows[0];
});
after(async()=>{server.close();server.closeAllConnections();await pool.end()});
async function updateBody(id=assignment.id){
 const r=await org.call('/roles/'+id);assert.equal(r.status,200);
 const a=r.data.assignment;
 return {version:a.version,roleKey:a.role_key,buildingId:a.building_id,unitId:a.unit_id,startsAt:a.starts_at,expiresAt:a.expires_at};
}
test('assignment boundaries, persistence, conflict and audit',async()=>{
 assert.equal((await manager.call('/roles/'+assignment.id)).status,403);
 assert.equal((await other.call('/roles/'+assignment.id)).status,404);
 const own=await org.call('/roles/'+adminAssignment.id);assert.equal(own.data.editable,false);
 assert.equal((await org.call('/roles/'+adminAssignment.id,'PATCH',await updateBody(adminAssignment.id))).status,403);
 const b=await updateBody();
 assert.equal((await org.call('/roles/'+assignment.id,'PATCH',{...b,expiresAt:b.startsAt})).status,400);
 assert.equal((await org.call('/roles/'+assignment.id,'PATCH',{...b,roleKey:'platform_admin'})).status,400);
 const foreign=(await pool.query('SELECT id FROM buildings WHERE organization_id<>$1 LIMIT 1',[assignment.organization_id])).rows[0];
 assert.equal((await org.call('/roles/'+assignment.id,'PATCH',{...b,buildingId:foreign.id})).status,404);
 const unit=(await pool.query('SELECT id,building_id FROM units WHERE organization_id=$1 LIMIT 1',[assignment.organization_id])).rows[0];
 assert.equal((await org.call('/roles/'+assignment.id,'PATCH',{...b,unitId:unit.id})).status,400);
 const patch={...b,roleKey:'accountant',buildingId:unit.building_id,unitId:unit.id};
 const result=await org.call('/roles/'+assignment.id,'PATCH',patch);assert.equal(result.status,200,JSON.stringify(result.data));
 assert.equal(result.data.assignment.role_key,'accountant');
 const access=await import('../access.js');
 const changed=(await access.contexts(seeded.accounts.dispatcher.id)).find(c=>c.id===assignment.id)!;
 assert.equal(changed.role_key,'accountant');assert.ok(changed.permissions.includes('billing.publish'));
 assert.equal((await org.call('/roles/'+assignment.id,'PATCH',b)).status,409);
 const saved=await org.call('/roles/'+assignment.id);assert.equal(saved.data.assignment.unit_id,unit.id);
 const audit=(await pool.query("SELECT details FROM audit_events WHERE entity_id=$1 AND action='role.update' ORDER BY created_at DESC LIMIT 1",[assignment.id])).rows[0];
 assert.equal(audit.details.before.role_key,'dispatcher');assert.equal(audit.details.after.role_key,'accountant');
 const cleared=await org.call('/roles/'+assignment.id,'PATCH',{...await updateBody(),buildingId:null,unitId:null,expiresAt:null});
 assert.equal(cleared.status,200);assert.equal(cleared.data.assignment.unit_id,null);
});
test('bounded administrator cannot widen a target beyond its own scope',async()=>{
 const unit=(await pool.query('SELECT id,building_id FROM units WHERE organization_id=$1 LIMIT 1',[assignment.organization_id])).rows[0];
 await pool.query('UPDATE role_assignments SET building_id=$2,unit_id=$3 WHERE id=ANY($1::uuid[])',[[adminAssignment.id,assignment.id],unit.building_id,unit.id]);
 try{
  const b=await updateBody();
  assert.equal((await org.call('/roles/'+assignment.id,'PATCH',{...b,buildingId:null,unitId:null})).status,404);
  assert.equal((await org.call('/roles/'+assignment.id,'PATCH',{...b,unitId:null})).status,404);
 }finally{
  await pool.query('UPDATE role_assignments SET building_id=NULL,unit_id=NULL WHERE id=ANY($1::uuid[])',[[adminAssignment.id,assignment.id]]);
 }
});
test('resident lifecycle and last administrator cannot be bypassed',async()=>{
 const resident=(await pool.query("SELECT id FROM role_assignments WHERE user_id=$1 AND role_key='unit_owner'",[seeded.accounts.unit_owner.id])).rows[0];
 const detail=await org.call('/roles/'+resident.id);assert.equal(detail.data.editable,false);
 assert.equal((await org.call('/roles/'+resident.id,'PATCH',{...await updateBody(resident.id),roleKey:'manager'})).status,403);
 assert.equal((await org.call('/roles/'+adminAssignment.id,'DELETE')).status,403);
 // Make the acting admin temporary, leaving the target as the only durable admin.
 const target=(await pool.query("INSERT INTO role_assignments(user_id,organization_id,role_key) VALUES($1,$2,'org_admin') RETURNING *",[seeded.accounts.manager.id,assignment.organization_id])).rows[0];
 await pool.query("UPDATE role_assignments SET expires_at=now()+interval '1 day' WHERE id=$1",[adminAssignment.id]);
 try{
  const b=await updateBody(target.id);
  const r=await org.call('/roles/'+target.id,'PATCH',{...b,roleKey:'manager'});
  assert.equal(r.status,409);assert.equal(r.data.error,'last_administrator');
  const building=(await pool.query('SELECT id FROM buildings WHERE organization_id=$1 LIMIT 1',[assignment.organization_id])).rows[0];
  assert.equal((await org.call('/roles/'+target.id,'PATCH',{...b,buildingId:building.id})).status,409);
  assert.equal((await org.call('/roles/'+target.id,'DELETE')).status,409);
 }finally{
  await pool.query('UPDATE role_assignments SET expires_at=NULL WHERE id=$1',[adminAssignment.id]);
  await pool.query('DELETE FROM role_assignments WHERE id=$1',[target.id]);
 }
});
test('concurrent edits cannot silently overwrite; revoke immediately removes context',async()=>{
 const b=await updateBody();
 const results=await Promise.all(['manager','dispatcher'].map(roleKey=>org.call('/roles/'+assignment.id,'PATCH',{...b,roleKey})));
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 assert.equal((await org.call('/roles/'+assignment.id,'DELETE')).status,204);
 assert.equal((await org.call('/roles/'+assignment.id)).data.editable,false);
 const sessions=await import('../access.js');
 assert.equal((await sessions.contexts(seeded.accounts.dispatcher.id)).some(c=>c.id===assignment.id),false);
 assert.equal((await org.call('/roles/'+assignment.id,'DELETE')).status,204);
});
test('IAM profiles, deny precedence, exceptional grants and shared permission explanation',async()=>{
 const {roleCatalog}=await import('../roles.js');
 const a=(await pool.query("SELECT * FROM role_assignments WHERE user_id=$1 AND role_key='manager'",[seeded.accounts.manager.id])).rows[0];
 const profile={name:'Limited manager QA',description:'No property registry',baseRole:'manager',permissions:roleCatalog.manager.permissions.filter(p=>p!=='properties.read'),active:true};
 const created=await org.call('/iam/profiles','POST',profile);assert.equal(created.status,201,JSON.stringify(created.data));
 const edited=await org.call('/iam/profiles/'+created.data.id,'PATCH',{...profile,version:created.data.version,description:'Edited isolated profile'});
 assert.equal(edited.status,200);
 assert.equal((await org.call('/iam/profiles/'+created.data.id,'PATCH',{...profile,version:created.data.version})).status,409);
 assert.equal((await other.call('/iam/profiles/'+created.data.id,'PATCH',{...profile,version:edited.data.version})).status,404);
 assert.equal((await org.call('/iam/profiles','POST',{...profile,name:'Invalid scope QA',permissions:['organizations.manage']})).status,403);
 const foreign=await other.call('/iam/profiles','POST',{...profile,name:'Foreign QA'});assert.equal(foreign.status,201);
 const version=async()=>(await org.call('/roles/'+a.id)).data.assignment.version;
 const policy={version:await version(),profileId:created.data.id,denies:[],grants:[],reason:'Isolated access policy verification',expiresAt:null};
 assert.equal((await org.call('/iam/assignments/'+a.id+'/policy','POST',{...policy,profileId:foreign.data.id})).status,404);
 assert.equal((await org.call('/iam/assignments/'+a.id+'/policy','POST',policy)).status,200);
 assert.equal((await manager.call('/properties')).status,403);
 const explanation=await org.call('/iam/assignments/'+a.id+'/access');
 assert.equal(explanation.data.evaluations.find((p:any)=>p.permission==='properties.read').allowed,false);
 const simulation=await org.call('/iam/assignments/'+a.id+'/access','POST',{method:'PATCH'});
 assert.equal(simulation.status,200);assert.equal(simulation.data.method,'PATCH');
 assert.equal(simulation.data.evaluations.find((p:any)=>p.permission==='properties.read').allowed,false);
 assert.equal((await other.call('/iam/assignments/'+a.id+'/access')).status,404);
 const expiry=new Date(Date.now()+3600000).toISOString();
 assert.equal((await org.call('/iam/assignments/'+a.id+'/policy','POST',{...policy,version:await version(),grants:['properties.read'],expiresAt:expiry})).status,403);
 const platform=await new Client().login('platform_admin');
 assert.equal((await platform.call('/invoices')).status,403);
 const grant={...policy,version:await version(),grants:['properties.read'],denies:['properties.read'],expiresAt:expiry};
 assert.equal((await platform.call('/iam/assignments/'+a.id+'/policy','POST',grant)).status,200);
 assert.equal((await manager.call('/properties')).status,403);
 assert.equal((await platform.call('/iam/assignments/'+a.id+'/policy','POST',{...grant,version:await version(),denies:[]})).status,200);
 assert.equal((await manager.call('/properties')).status,200);
 assert.equal((await org.call('/iam/assignments/'+a.id+'/policy','POST',{...policy,version:await version(),denies:['properties.read']})).status,200);
 assert.equal((await manager.call('/properties')).status,403);
 assert.equal((await pool.query("SELECT count(*)::int AS n FROM iam_assignment_rules WHERE assignment_id=$1 AND effect='grant'",[a.id])).rows[0].n,1);
 assert.equal((await org.call('/iam/assignments/'+a.id+'/policy','POST',{...policy,version:await version()})).status,200);
 assert.equal((await manager.call('/properties')).status,200);
 const updated=(await org.call('/iam/users/'+a.user_id)).data.assignments.find((x:any)=>x.id===a.id);
 assert.equal((await org.call('/iam/assignments/'+a.id+'/status','POST',{version:updated.version,status:'suspended',reason:'Isolated pause test'})).status,204);
 assert.equal((await manager.call('/properties')).status,403);
 const suspended=(await org.call('/iam/users/'+a.user_id)).data.assignments.find((x:any)=>x.id===a.id);
 assert.equal(suspended.active,false);assert.equal(suspended.assignment_status,'suspended');
 assert.equal((await org.call('/iam/assignments/'+a.id+'/status','POST',{version:suspended.version,status:'active',reason:'Isolated resume test'})).status,204);
 assert.equal((await manager.call('/properties')).status,200);
 assert.equal((await platform.call('/iam/users/'+seeded.accounts.org_admin.id+'/status','POST',{status:'disabled',reason:'Last admin denial test'})).status,409);
 assert.equal((await platform.call('/iam/users/'+seeded.accounts.manager.id+'/status','POST',{status:'disabled',reason:'Isolated disable account'})).status,204);
 assert.equal((await manager.call('/properties')).status,401);
 const disabled=(await platform.call('/iam/users/'+seeded.accounts.manager.id)).data;
 assert.equal(disabled.user.account_status,'disabled');assert.equal(disabled.sessions.length,0);
 assert.equal((await platform.call('/iam/users/'+seeded.accounts.manager.id+'/status','POST',{status:'active',reason:'Isolated reactivate account'})).status,204);
 assert.equal((await pool.query('SELECT blocked FROM users WHERE id=$1',[a.user_id])).rows[0].blocked,false);
 assert.equal((await org.call('/iam/users/'+seeded.accounts.manager.id+'/logout','POST',{reason:'Not platform administrator'})).status,403);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM roles')).rows[0].n,14);
});
