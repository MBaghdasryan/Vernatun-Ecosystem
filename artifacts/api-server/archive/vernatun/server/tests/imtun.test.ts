import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {app} from '../app.js';
import {pool} from '../db.js';
import {config} from '../config.js';

if(config.NODE_ENV!=='test'||!new URL(config.DATABASE_URL).pathname.endsWith('/vernatun_test'))
 throw new Error('ImTun tests require the isolated test database');
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
 for(const key of ['unit_owner','renter','family'])clients[key]=await new Client().login(key);
});
after(async()=>{server.close();server.closeAllConnections();await pool.end()});

test('Resident context labels come from its authorized building and unit',async()=>{
 const expected=(await pool.query(`SELECT u.number,b.name FROM units u JOIN buildings b ON b.id=u.building_id WHERE u.id=$1`,[seeded.fixtures.ua])).rows[0];
 for(const key of ['unit_owner','renter','family']){
  const session=await clients[key].call('/auth/session');
  assert.equal(session.status,200);
  const c=session.data.contexts.find((c:any)=>c.id===clients[key].contextId);
  assert.equal(c.unit_id,seeded.fixtures.ua);
  assert.equal(c.unit_number,expected.number);
  assert.equal(c.building_name,expected.name);
  assert.equal(c.product,'imtun');
 }
});

test('Family context cannot read finances or manage resident delegations',async()=>{
 assert.equal((await clients.family.call('/invoices')).status,403);
 assert.equal((await clients.family.call('/delegations')).status,403);
 const session=(await clients.family.call('/auth/session')).data;
 const c=session.contexts.find((c:any)=>c.id===session.contextId);
 assert.equal(c.permissions.includes('billing.own'),false);
 assert.equal(c.permissions.includes('residents.delegate'),false);
});

test('Owner and renter invoices remain restricted to the active unit and payer',async()=>{
 for(const key of ['unit_owner','renter']){
  const result=await clients[key].call('/invoices');
  assert.equal(result.status,200);
  for(const row of result.data){
   const invoice=(await pool.query('SELECT unit_id,payer_user_id FROM invoices WHERE id=$1',[row.id])).rows[0];
   assert.equal(invoice.unit_id,seeded.fixtures.ua);
   assert.equal(invoice.payer_user_id,seeded.accounts[key].id);
  }
 }
 assert.ok((await clients.unit_owner.call('/invoices')).data.length>0);
});

test('Switching owner to a different renter context never unions scopes or permissions; expired context is denied',async()=>{
 const owner=clients.unit_owner,f=seeded.fixtures;
 const oldRequest=(await pool.query('SELECT id FROM resident_requests WHERE unit_id=$1 AND author_user_id=$2 LIMIT 1',[f.ua,seeded.accounts.unit_owner.id])).rows[0];
 assert.ok(oldRequest);
 const assignment=(await pool.query(`INSERT INTO role_assignments(user_id,organization_id,role_key,building_id,unit_id,expires_at)
  VALUES($1,$2,'renter',$3,$4,now()+interval '1 day') RETURNING id`,[seeded.accounts.unit_owner.id,f.orgA,f.ba,f.ua2])).rows[0].id;
 try{
  assert.equal((await owner.call('/auth/context','POST',{id:assignment})).status,200);
  const session=(await owner.call('/auth/session')).data;
  const c=session.contexts.find((c:any)=>c.id===session.contextId);
  assert.equal(c.role_key,'renter');
  assert.equal(c.unit_id,f.ua2);
  assert.equal(c.permissions.includes('residents.delegate'),false);
  const units=await owner.call('/units');
  assert.equal(units.status,200);
  assert.ok(units.data.length>0);
  assert.ok(units.data.every((u:any)=>u.id===f.ua2));
  assert.equal((await owner.call('/requests/'+oldRequest.id)).status,404);
  const invoices=await owner.call('/invoices');
  assert.equal(invoices.status,200);
  for(const row of invoices.data){
   assert.equal((await pool.query('SELECT unit_id FROM invoices WHERE id=$1',[row.id])).rows[0].unit_id,f.ua2);
  }
  await pool.query("UPDATE role_assignments SET starts_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE id=$1",[assignment]);
  assert.equal((await owner.call('/units')).status,403);
 }finally{
  await owner.call('/auth/context','POST',{id:owner.contextId});
  await pool.query('DELETE FROM role_assignments WHERE id=$1',[assignment]);
 }
});
