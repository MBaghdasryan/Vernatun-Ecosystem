import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {WebSocket} from 'ws';
import {app} from '../app.js';
import {pool} from '../db.js';
import {config} from '../config.js';
import {attachEdgeWebSocket} from '../edge-sockets.js';

if(config.NODE_ENV!=='test'||!new URL(config.DATABASE_URL).pathname.endsWith('/vernatun_test'))
 throw new Error('Edge integration tests require the isolated vernatun_test database');
const seed=JSON.parse(await readFile('.local/test/demo-accounts.json','utf8'));
const account=(role:string)=>Object.values(seed.accounts).find((a:any)=>a.role===role) as any;
const server=createServer(app);attachEdgeWebSocket(server);let base='';let agentSocket:WebSocket|undefined;

class Client{
 cookie='';csrf='';
 async call(path:string,method='GET',body?:unknown,extraHeaders:Record<string,string>={}){
  const response=await fetch(base+'/api'+path,{method,headers:{
   Cookie:this.cookie,'Content-Type':'application/json',
   ...(method==='GET'?{}:{'X-CSRF-Token':this.csrf}),...extraHeaders,
  },...(body===undefined?{}:{body:JSON.stringify(body)})});
  const cookies=response.headers.getSetCookie();if(cookies.length)this.cookie=cookies.map(v=>v.split(';')[0]).join('; ');
  const data=response.headers.get('Content-Type')?.includes('json')?await response.json():null;
  if(data?.csrf)this.csrf=data.csrf;
  return {status:response.status,data};
 }
 async login(role:string){
  const a=account(role);const session=await this.call('/auth/session');
  assert.ok(this.csrf.length>0,`CSRF token missing from session response (status ${session.status}, body keys ${Object.keys(session.data??{}).join(',')})`);
  const response=await this.call('/auth/login','POST',{email:a.email,password:a.password});
  assert.equal(response.status,200,`login ${role}: ${String(response.data?.error??'no error code')}`);
  if(!response.data.contextId){
   const context=response.data.contexts.find((x:any)=>x.role_key===role);
   assert.ok(context,`missing ${role} test context`);
   assert.equal((await this.call('/auth/context','POST',{id:context.id})).status,200);
  }
  return this;
 }
}
let platform:Client,owner:Client,buildingId:string,organizationId:string,unitId:string;
before(async()=>{
 if(!server.listening)await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 base='http://127.0.0.1:'+(server.address() as any).port;
 platform=await new Client().login('platform_admin');
 owner=await new Client().login('unit_owner');
 const session=(await owner.call('/auth/session')).data;
 const context=session.contexts.find((x:any)=>x.role_key==='unit_owner');
 assert.ok(context?.building_id&&context?.organization_id&&context?.unit_id,'resident test fixture must include a unit, building, and organization');
 buildingId=context.building_id;organizationId=context.organization_id;unitId=context.unit_id;
 await pool.query(`INSERT INTO module_entitlements(organization_id,module,enabled)
  VALUES($1,'smart_building',true) ON CONFLICT(organization_id,module) DO UPDATE SET enabled=true`,[organizationId]);
});
after(async()=>{
 if(agentSocket?.readyState===WebSocket.OPEN){
  await new Promise<void>(resolve=>{agentSocket!.once('close',()=>resolve());agentSocket!.close()});
 }
 await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
 await pool.end();
});

test('Edge v1 bootstrap, Agent identity binding, hash-only credentials, inventory, and unit isolation',async()=>{
 const edgeId='QA-'+randomBytes(8).toString('hex');
 const name='Isolated QA Edge';const siteCode='QA-SITE';
 const bootstrap=await platform.call('/edge-console/bootstrap-tokens','POST',{
  organizationId,buildingId,edgeId,name,siteCode,expiresInMinutes:30,
 });
 assert.equal(bootstrap.status,201);
 assert.equal(bootstrap.data.oneTime,true);
 const bootstrapToken=bootstrap.data.bootstrapToken as string;
 assert.ok(bootstrapToken.length>=20);
 const identityHeaders={
  Authorization:`Bearer ${bootstrapToken}`,
  'X-Vernatun-Edge-Id':edgeId,'X-Vernatun-Tenant-Id':organizationId,'X-Vernatun-Building-Id':buildingId,
 };
 const registration={
  edgeId,tenantId:organizationId,buildingId,siteCode,edgeName:name,agentVersion:'qa-agent',
  platform:'windows',capabilities:{heartbeat:true,inventory:true,telemetry:true,events:true,alarms:true},
 };
 const mismatch=await platform.call('/edge/v1/register','POST',{...registration,edgeName:'Different Edge'},identityHeaders);
 assert.equal(mismatch.status,403,'bootstrap binding must reject a different agent name');
 const registered=await platform.call('/edge/v1/register','POST',registration,identityHeaders);
 assert.equal(registered.status,201);
 assert.equal(registered.data.status,'REGISTERED');
 assert.equal(registered.data.edgeId,edgeId);
 const accessToken=registered.data.accessToken as string;
 assert.ok(accessToken.length>=32);
 assert.equal((await platform.call('/edge/v1/register','POST',registration,identityHeaders)).status,401,'bootstrap tokens are single-use');

 const machineHeaders={
  Authorization:`Bearer ${accessToken}`,
  'X-Vernatun-Edge-Id':edgeId,'X-Vernatun-Tenant-Id':organizationId,'X-Vernatun-Building-Id':buildingId,
 };
 const wrongTenant=await platform.call('/edge/v1/heartbeat','POST',{
  edgeId,tenantId:organizationId,buildingId,local:{commandAuthorization:'OK',queueDepth:0},
 },{...machineHeaders,'X-Vernatun-Tenant-Id':'00000000-0000-4000-8000-000000000000'});
 assert.equal(wrongTenant.status,401,'machine identity headers must match the enrolled tenant');
 const heartbeat=await platform.call('/edge/v1/heartbeat','POST',{
  edgeId,tenantId:organizationId,buildingId,agentVersion:'qa-agent',
  local:{commandAuthorization:'OK',queueDepth:0},
 },machineHeaders);
 assert.equal(heartbeat.status,200);
 const inventory=await platform.call('/edge/v1/inventory','POST',{
  edgeId,tenantId:organizationId,buildingId,devices:[{
   deviceId:'qa-barrier-1',profile:'Vernatun Barrier',label:'QA barrier',active:true,
  }],
 },machineHeaders);
 assert.equal(inventory.status,200);
 assert.equal(inventory.data.devices,1);

  agentSocket=new WebSocket(`ws://127.0.0.1:${(server.address() as any).port}/api/edge/v1/connect?edgeId=${encodeURIComponent(edgeId)}`,{
   headers:machineHeaders,
  });
  await new Promise<void>((resolve,reject)=>{
   agentSocket!.once('open',resolve);agentSocket!.once('error',reject);
  });
  agentSocket.send(JSON.stringify({type:'EDGE_HELLO',edgeId,tenantId:organizationId,buildingId,agentVersion:'qa-agent'}));
  const helloDeadline=Date.now()+1500;let online=false;
  while(Date.now()<helloDeadline){
   const state=await pool.query('SELECT status FROM edge_nodes WHERE edge_id=$1',[edgeId]);
   if(state.rows[0]?.status==='ONLINE'){online=true;break}
   await new Promise(resolve=>setTimeout(resolve,25));
  }
  assert.equal(online,true,'WebSocket Agent hello should mark the scoped Edge node online');

 const node=(await pool.query('SELECT id FROM edge_nodes WHERE edge_id=$1',[edgeId])).rows[0];
 const credential=(await pool.query(`SELECT credential_hash,status FROM edge_credentials
  WHERE edge_node_id=$1 ORDER BY version LIMIT 1`,[node.id])).rows[0];
 assert.equal(credential.status,'active');
 assert.equal(credential.credential_hash,createHash('sha256').update(accessToken).digest('hex'));
 assert.notEqual(credential.credential_hash,accessToken,'raw Agent credentials must never be stored');
 const storedBootstrap=(await pool.query('SELECT token_hash,used_at FROM edge_bootstrap_tokens WHERE edge_id=$1',[edgeId])).rows[0];
 assert.ok(storedBootstrap.used_at);
 assert.equal(storedBootstrap.token_hash,createHash('sha256').update(bootstrapToken).digest('hex'));

 const device=(await pool.query('SELECT id FROM edge_device_inventory WHERE edge_node_id=$1 AND edge_device_id=$2',[node.id,'qa-barrier-1'])).rows[0];
 const assigned=await platform.call(`/edge-console/devices/${device.id}/access`,'PUT',{
  unitId,allowedCapabilities:['BARRIER.OPEN'],
 });
 assert.equal(assigned.status,200,`device access assignment failed: ${String(assigned.data?.error??assigned.data?.code??'unknown')}`);
 const residentDevices=await owner.call(`/me/buildings/${buildingId}/devices`);
 assert.equal(residentDevices.status,200);
 assert.equal(residentDevices.data.length,1);
 assert.equal(residentDevices.data[0].id,device.id);
 assert.deepEqual(residentDevices.data[0].permittedCapabilities,['BARRIER.OPEN']);
 const crossBuilding=await owner.call('/me/buildings/00000000-0000-4000-8000-000000000000/devices');
 assert.equal(crossBuilding.status,403,'resident cannot query another building');
 const removed=await platform.call(`/edge-console/devices/${device.id}/access/${unitId}`,'DELETE');
 assert.equal(removed.status,200);
 assert.equal((await owner.call(`/me/buildings/${buildingId}/devices`)).data.length,0);
});
