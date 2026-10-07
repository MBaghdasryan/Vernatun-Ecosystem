import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {app} from '../app.js';
import {pool} from '../db.js';
import {config} from '../config.js';
import {roleKeys} from '../roles.js';
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
after(async()=>{server.close();server.closeAllConnections();await pool.end()});
test('all 14 roles receive real scoped cards without widening financial permissions',async()=>{
 assert.equal((await new Client().call('/role-insights')).status,401);
 for(const role of roleKeys){
  const c=await new Client().login(role),r=await c.call('/role-insights?currency=AMD');
  assert.equal(r.status,200,role);assert.ok(Array.isArray(r.data.cards),role);
  for(const card of r.data.cards)assert.match(card.value,/^-?\d+$/,role+':'+card.key);
  if(!c.context.permissions.some((p:string)=>p==='billing.read'||p==='billing.own'))assert.ok(!r.data.cards.some((x:any)=>x.currency),role+' has no financial cards');
  if(role!=='platform_admin')assert.ok(!r.data.cards.some((x:any)=>x.key==='organizations'),role+' has no platform totals');
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
 assert.equal(value(await manager.call('/role-insights?period=1999-01&currency=AMD'),'charged'),'33000');
 assert.equal(value(await owner.call('/role-insights?period=1999-01&currency=USD'),'charged'),'7000');
 assert.equal(value(await owner.call('/role-insights?period=1999-03&currency=AMD'),'charged'),'0');
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
