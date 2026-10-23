import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {app} from '../app.js';
import {pool} from '../db.js';
import {config} from '../config.js';
import {roleKeys} from '../roles.js';
import {KPI_REGISTRY} from '../kpi-registry.js';
if(config.NODE_ENV!=='test'||!new URL(config.DATABASE_URL).pathname.endsWith('/vernatun_test'))throw new Error('Isolated test DB required');
const seeded=JSON.parse(await readFile('.local/test/demo-accounts.json','utf8'));
const server=app.listen(0,'127.0.0.1');
let base='';
class Client{
 cookie='';csrf='';context:any;
 async call(path:string,method='GET',body?:unknown){
  const r=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',Cookie:this.cookie,'X-CSRF-Token':this.csrf},...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(r.headers.getSetCookie().length)this.cookie=r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
  const data=r.status===204?null:await r.json();if(data?.csrf)this.csrf=data.csrf;return {status:r.status,data};
 }
 async login(key:string){
  const a=seeded.accounts[key];await this.call('/auth/session');
  const r=await this.call('/auth/login','POST',{email:a.email,password:a.password});assert.equal(r.status,200);
  this.context=r.data.contexts.find((c:any)=>c.role_key===a.role);
  assert.equal((await this.call('/auth/context','POST',{id:this.context.id})).status,200);return this;
 }
}
before(async()=>{await pool.query('DELETE FROM auth_rate_limits');await new Promise<void>(r=>server.listening?r():server.on('listening',r));base='http://127.0.0.1:'+(server.address() as {port:number}).port});
// Each case has its own login budget in this isolated schema. Never weaken
// production limits just because the suite signs in as every role twice.
beforeEach(async()=>{await pool.query('DELETE FROM auth_rate_limits')});
after(async()=>{server.close();server.closeAllConnections();await pool.end()});
test('all 14 roles receive real scoped cards without widening financial permissions',async()=>{
 assert.equal((await new Client().call('/role-insights')).status,401);
 for(const role of roleKeys){
  const c=await new Client().login(role),r=await c.call('/role-insights?currency=AMD');
  assert.equal(r.status,200,role);assert.ok(Array.isArray(r.data.cards),role);
  for(const card of r.data.cards){
   assert.match(card.value,/^-?\d+$/,role+':'+card.key);
   const definition=KPI_REGISTRY[card.key as keyof typeof KPI_REGISTRY];
   assert.ok(definition,role+': registry entry '+card.key);
   assert.equal(card.definition,definition.definition,role+': definition '+card.key);
   assert.equal(card.module,definition.module,role+': module '+card.key);
   assert.equal(card.noDataBehavior,definition.noDataBehavior,role+': empty-state rule '+card.key);
   assert.ok(card.permission.split(' OR ').some((p:string)=>c.context.permissions.includes(p)),role+': permission '+card.key);
   assert.ok(typeof card.queryId==='string'&&typeof card.scope==='string',role+': query/scope '+card.key);
   assert.equal(card.dataState,'measured',role+': count data state '+card.key);
  }
  if(!c.context.permissions.some((p:string)=>p==='billing.read'||p==='billing.own'))assert.ok(!r.data.cards.some((x:any)=>x.currency),role+' has no financial cards');
  if(role!=='platform_admin')assert.ok(!r.data.cards.some((x:any)=>x.key==='organizations'),role+' has no platform totals');
 }
});
test('workspace search authorizes every source for all 14 roles and does not widen tenant scope',async()=>{
 assert.equal((await new Client().call('/workspace-search?q=Demo')).status,401);
 for(const role of roleKeys){
  const client=await new Client().login(role);
  const result=await client.call('/workspace-search?q=Demo');
  assert.equal(result.status,200,role+': '+JSON.stringify(result.data));
  assert.equal(result.data.contextId,client.context.id);
  for(const group of result.data.groups){
   assert.ok(group.items.length<=6);
   assert.equal(typeof group.hasMore,'boolean');
   for(const item of group.items)assert.deepEqual(Object.keys(item).sort(),['description','id','title']);
   if(group.kind==='properties'||group.kind==='units'){
    for(const item of group.items){
     const allowed=await pool.query(group.kind==='units'
      ?'SELECT id FROM units WHERE id=$1 AND organization_id=$2 AND ($3::uuid IS NULL OR building_id=$3) AND ($4::uuid IS NULL OR id=$4)'
      :'SELECT id FROM buildings WHERE id=$1 AND organization_id=$2 AND ($3::uuid IS NULL OR id=$3) AND ($4::uuid IS NULL OR id=(SELECT building_id FROM units WHERE id=$4))',
      [item.id,client.context.organization_id,client.context.building_id,client.context.unit_id]);
     assert.equal(allowed.rowCount,1,role+': no cross-scope search record');
    }
   }
  }
  if(!client.context.permissions.some((p:string)=>['billing.read','billing.own'].includes(p))){
   assert.ok(!result.data.groups.some((g:any)=>g.kind==='invoices'),role+': no finance discovery');
  }
  if(role==='platform_admin'){
   assert.ok(!result.data.groups.some((g:any)=>['properties','units','people','requests','documents','invoices'].includes(g.kind)),'IAM/platform authority is not tenant authority');
   const demos=Number((await pool.query('SELECT count(*) FROM organizations WHERE is_demo')).rows[0].count);
   if(demos)assert.ok(result.data.groups.find((g:any)=>g.kind==='organizations')?.items.length,'visible demo marker is searchable');
  }
  if(role==='technician'){
   const assigned=(await pool.query(`SELECT r.id,b.name FROM work_orders w JOIN resident_requests r ON r.id=w.request_id
    JOIN units u ON u.id=r.unit_id JOIN buildings b ON b.id=u.building_id WHERE w.technician_id=$1 AND r.organization_id=$2 LIMIT 1`,
    [seeded.accounts.technician.id,client.context.organization_id])).rows[0];
   if(assigned){
    const byBuilding=await client.call('/workspace-search?q='+encodeURIComponent(assigned.name));
    assert.equal(byBuilding.status,200);
    assert.ok(byBuilding.data.groups.find((g:any)=>g.kind==='workorders')?.items.some((item:any)=>item.id===assigned.id),'assigned work is searchable by building');
   }
  }
 }
 const owner=await new Client().login('unit_owner');
 assert.equal((await owner.call('/workspace-search?q=x')).status,400);
 assert.equal((await owner.call('/workspace-search?q='+encodeURIComponent('x'.repeat(101)))).status,400);
 const literal=await owner.call('/workspace-search?q=%25%25');
 assert.equal(literal.status,200);
 assert.ok(literal.data.groups.every((g:any)=>g.items.length===0),'wildcards are literal, not an all-record query');
});
test('header unread count is account-bound and includes only enabled unread in-app notifications',async()=>{
 assert.equal((await new Client().call('/notifications/unread-count')).status,401);
 const owner=await new Client().login('unit_owner');
 const result=await owner.call('/notifications/unread-count');
 assert.equal(result.status,200);
 const expected=Number((await pool.query('SELECT count(*) FROM notifications WHERE user_id=$1 AND in_app_enabled AND read_at IS NULL',[seeded.accounts.unit_owner.id])).rows[0].count);
 assert.deepEqual(result.data,{unread:expected});
});
test('implementation tools require global support authority and keep diagnostic counts assigned',async()=>{
 for(const role of roleKeys){
  const client=await new Client().login(role);
  const expected=['platform_admin','support'].includes(role)?200:403;
  const diagnostic=await client.call('/platform/implementation-diagnostics');
  const knowledge=await client.call('/platform/knowledge-base?language=ru');
  assert.equal(diagnostic.status,expected,role+': diagnostics');
  assert.equal(knowledge.status,expected,role+': knowledge');
  if(expected!==200)continue;
  assert.equal(diagnostic.data.database,'reachable');
  assert.equal(diagnostic.data.schema,'ready');
  assert.equal(diagnostic.data.scope,role==='platform_admin'?'platform':'assigned');
  const pending=Number((await pool.query("SELECT count(*) FROM onboarding_steps WHERE status<>'completed' AND ($1::boolean OR assigned_to=$2)",[role==='platform_admin',seeded.accounts[role].id])).rows[0].count);
  assert.equal(diagnostic.data.pendingStages,pending);
  assert.ok(knowledge.data.length>=5);
  assert.ok(knowledge.data.every((a:any)=>a.slug&&a.title&&a.body&&!('storage_key' in a)));
  for(const language of ['hy','en'])assert.equal((await client.call('/platform/knowledge-base?language='+language)).status,200);
  assert.equal((await client.call('/platform/knowledge-base?language=xx')).status,400);
 }
});
test('financial cards filter by month, currency, payer and tenant; no invented zero on invalid input',async()=>{
 const owner=await new Client().login('unit_owner'),manager=await new Client().login('manager'),other=await new Client().login('second_org');
 const scope=owner.context;
 for(const [period,amount,currency,payer] of [
  ['1999-01-01',11000,'AMD',seeded.accounts.unit_owner.id],
  ['1999-01-15',22000,'AMD',seeded.accounts.renter.id],
  ['1999-02-01',99000,'AMD',seeded.accounts.unit_owner.id],
  ['1999-01-01',7000,'USD',seeded.accounts.unit_owner.id],
 ]){
  await pool.query("INSERT INTO invoices(organization_id,unit_id,payer_user_id,period,amount_minor,currency,status) VALUES($1,$2,$3,$4,$5,$6,'published')",[scope.organization_id,scope.unit_id,payer,period,amount,currency]);
 }
 const value=(r:any,key:string)=>r.data.cards.find((c:any)=>c.key===key)?.value;
 const own=await owner.call('/role-insights?period=1999-01&currency=AMD');
 assert.equal(own.status,200);assert.equal(value(own,'charged'),'11000');
 assert.equal(own.data.cards.find((c:any)=>c.key==='charged').dataState,'measured');
 assert.equal(value(await manager.call('/role-insights?period=1999-01&currency=AMD'),'charged'),'33000');
 assert.equal(value(await owner.call('/role-insights?period=1999-01&currency=USD'),'charged'),'7000');
 const emptyPeriod=await owner.call('/role-insights?period=1999-03&currency=AMD');
 assert.equal(value(emptyPeriod,'charged'),'0');
 assert.equal(emptyPeriod.data.cards.find((c:any)=>c.key==='charged').dataState,'no_data');
 assert.ok(!(await other.call('/role-insights?period=1999-01&currency=AMD')).data.cards.some((c:any)=>c.currency));
 assert.equal((await owner.call('/role-insights?period=1999-13')).status,400);
 assert.equal((await owner.call('/role-insights?currency=INVALID')).status,400);
});
test('unit-scoped team totals exclude other units and locked people; module gates hide finance cards',async()=>{
 const manager=await new Client().login('manager'),owner=await new Client().login('unit_owner');
 const a=(await pool.query('SELECT * FROM role_assignments WHERE id=$1',[manager.context.id])).rows[0];
 const person=seeded.accounts.unit_owner.id;
 const oldBlocked=(await pool.query('SELECT blocked FROM users WHERE id=$1',[person])).rows[0].blocked;
 try{
  await pool.query('UPDATE role_assignments SET building_id=$2,unit_id=$3 WHERE id=$1',[a.id,owner.context.building_id,owner.context.unit_id]);
  const getTeam=async()=>Number((await manager.call('/role-insights')).data.cards.find((x:any)=>x.key==='team').value);
  const initial=await getTeam();
  await pool.query('UPDATE users SET blocked=true WHERE id=$1',[person]);
  assert.equal(await getTeam(),initial-1);
  const cards=(await manager.call('/role-insights')).data.cards;
  assert.equal(cards.find((x:any)=>x.key==='units').value,'1');
  const old=(await pool.query("SELECT override_state FROM module_entitlements WHERE organization_id=$1 AND module='finance'",[a.organization_id])).rows[0];
  try{
   await pool.query("UPDATE module_entitlements SET override_state='disabled' WHERE organization_id=$1 AND module='finance'",[a.organization_id]);
   assert.ok(!(await manager.call('/role-insights')).data.cards.some((x:any)=>x.currency));
  }finally{await pool.query("UPDATE module_entitlements SET override_state=$2 WHERE organization_id=$1 AND module='finance'",[a.organization_id,old.override_state])}
 }finally{
  await pool.query('UPDATE users SET blocked=$2 WHERE id=$1',[person,oldBlocked]);
  await pool.query('UPDATE role_assignments SET building_id=$2,unit_id=$3 WHERE id=$1',[a.id,a.building_id,a.unit_id]);
 }
});
test('organization dashboard mirrors effective module policy and role-insight team scope',async()=>{
 const manager=await new Client().login('org_admin');
 const [dashboard,modules,insights]=await Promise.all([
  manager.call('/dashboard'),manager.call('/modules'),manager.call('/role-insights'),
 ]);
 assert.equal(dashboard.status,200);
 assert.equal(modules.status,200);
 assert.equal(insights.status,200);
 assert.equal(dashboard.data.metrics.modules,modules.data.filter((x:any)=>x.enabled).length);
 assert.equal(dashboard.data.metrics.team,Number(insights.data.cards.find((x:any)=>x.key==='team').value));
});
