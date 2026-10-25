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
const server=createServer(app);attachEdgeWebSocket(server);let base='';let agentSocket:WebSocket|undefined;let v2Socket:WebSocket|undefined;

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
 if(v2Socket?.readyState===WebSocket.OPEN){
  await new Promise<void>(resolve=>{v2Socket!.once('close',()=>resolve());v2Socket!.close()});
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

test('Edge v2 registers a block node, scopes inventory to its buildings, and authenticates the v2 socket',async()=>{
 const suffix=randomBytes(8).toString('hex'),edgeId=`QA-BLOCK-${suffix}`,blockCode=`QA-${suffix}`;
 const secondBuildingId=(await pool.query(`INSERT INTO buildings(organization_id,name,address)
  VALUES($1,$2,$3) RETURNING id`,[organizationId,`QA Building ${suffix}`,'QA isolated address'])).rows[0].id as string;
 const blockBuildingIds=[buildingId,secondBuildingId];
 const block=await platform.call('/edge-console/blocks','POST',{
  organizationId,code:blockCode,name:'Isolated QA block',buildingIds:blockBuildingIds,
 });
 assert.equal(block.status,201,`block creation failed: ${String(block.data?.error??block.data?.code??'unknown')}`);
 assert.deepEqual(block.data.buildingIds,blockBuildingIds);
 const duplicateBuildingBlock=await platform.call('/edge-console/blocks','POST',{
  organizationId,code:`QA-DUP-${suffix}`,name:'Duplicate building block',buildingIds:[buildingId],
 });
 assert.equal(duplicateBuildingBlock.status,409,'a building cannot be assigned to two Edge blocks');
 const tokenResult=await platform.call(`/edge-console/blocks/${block.data.id}/bootstrap-tokens`,'POST',{
  edgeId,name:'Isolated QA block node',siteCode:blockCode,expiresInMinutes:30,
 });
 assert.equal(tokenResult.status,201,`v2 bootstrap failed: ${String(tokenResult.data?.error??tokenResult.data?.code??'unknown')}`);
 const bootstrapToken=tokenResult.data.bootstrapToken as string;
 const identityHeaders={
  Authorization:`Bearer ${bootstrapToken}`,
  'X-Vernatun-Edge-Id':edgeId,'X-Vernatun-Tenant-Id':organizationId,
  'X-Vernatun-Block-Id':block.data.id,
 };
 const registration={
  protocolVersion:2,edgeId,tenantId:organizationId,blockId:block.data.id,
  siteCode:blockCode,edgeName:'Isolated QA block node',agentVersion:'qa-agent-v2',
  platform:'windows',capabilities:{heartbeat:true,inventory:true},
 };
 const registered=await platform.call('/edge/v2/register','POST',registration,identityHeaders);
 assert.equal(registered.status,201,`v2 registration failed: ${String(registered.data?.error??registered.data?.code??'unknown')}`);
 assert.equal(registered.data.protocolVersion,2);
 assert.deepEqual(registered.data.buildingIds,[...blockBuildingIds].sort());
 const accessToken=registered.data.accessToken as string;
 const machineHeaders={
  Authorization:`Bearer ${accessToken}`,
  'X-Vernatun-Edge-Id':edgeId,'X-Vernatun-Tenant-Id':organizationId,
  'X-Vernatun-Block-Id':block.data.id,
 };
 const heartbeat=await platform.call('/edge/v2/heartbeat','POST',{
  protocolVersion:2,edgeId,tenantId:organizationId,blockId:block.data.id,
  local:{commandAuthorization:'OK',queueDepth:0},
 },machineHeaders);
 assert.equal(heartbeat.status,200);
 const inventory=await platform.call('/edge/v2/inventory','POST',{
  protocolVersion:2,edgeId,tenantId:organizationId,blockId:block.data.id,
  devices:[
   {buildingId,deviceId:'qa-block-device-1',name:'QA device 1',profile:'Vernatun Meter',active:true},
   {buildingId:secondBuildingId,deviceId:'qa-block-device-2',name:'QA device 2',profile:'Vernatun Meter',active:true},
  ],
 },machineHeaders);
 assert.equal(inventory.status,200,`multi-building inventory failed: ${String(inventory.data?.error??inventory.data?.code??'unknown')}`);
 assert.equal(inventory.data.devices,2);
 const telemetry=await platform.call('/edge/v2/telemetry/batch','POST',{
  protocolVersion:2,edgeId,tenantId:organizationId,blockId:block.data.id,
  items:[{buildingId,deviceId:'qa-block-device-1',timestamp:new Date().toISOString(),temperature:19}],
 },machineHeaders);
 assert.equal(telemetry.status,200,`v2 telemetry failed: ${String(telemetry.data?.error??telemetry.data?.code??'unknown')}`);
 const events=await platform.call('/edge/v2/events/batch','POST',{
  protocolVersion:2,edgeId,tenantId:organizationId,blockId:block.data.id,
  items:[{buildingId,deviceId:'qa-block-device-1',eventId:'qa-event-1',type:'meter.read'}],
 },machineHeaders);
 assert.equal(events.status,200,`v2 event failed: ${String(events.data?.error??events.data?.code??'unknown')}`);
 const repeatedEvents=await platform.call('/edge/v2/events/batch','POST',{
  protocolVersion:2,edgeId,tenantId:organizationId,blockId:block.data.id,
  items:[{buildingId,deviceId:'qa-block-device-1',eventId:'qa-event-1',type:'meter.read'}],
 },machineHeaders);
 assert.equal(repeatedEvents.status,200);
 assert.equal(repeatedEvents.data.inserted,0,'replayed event IDs are idempotent');
 const alarms=await platform.call('/edge/v2/alarms/batch','POST',{
  protocolVersion:2,edgeId,tenantId:organizationId,blockId:block.data.id,
  items:[{buildingId,deviceId:'qa-block-device-1',alarmId:'qa-alarm-1',type:'meter.alert'}],
 },machineHeaders);
 assert.equal(alarms.status,200,`v2 alarm failed: ${String(alarms.data?.error??alarms.data?.code??'unknown')}`);
 const edgeConfig=await platform.call(`/edge/v2/config?edgeId=${encodeURIComponent(edgeId)}`,'GET',undefined,machineHeaders);
 assert.equal(edgeConfig.status,200);
 assert.deepEqual(edgeConfig.data.buildingIds,[...blockBuildingIds].sort());
 const listedBlocks=await platform.call('/edge-console/blocks');
 const listedBlock=listedBlocks.data.blocks.find((item:any)=>item.id===block.data.id);
 assert.equal(listedBlock.building_count,2);
 assert.equal(listedBlock.edge_node_count,1);
 const crossBlock=await platform.call('/edge/v2/inventory','POST',{
  protocolVersion:2,edgeId,tenantId:organizationId,blockId:block.data.id,
  devices:[{buildingId:'00000000-0000-4000-8000-000000000000',deviceId:'outside-device',profile:'Vernatun Meter'}],
 },machineHeaders);
 assert.equal(crossBlock.status,403,'v2 inventory cannot write to a building outside the assigned block');
 assert.equal((await pool.query(`SELECT protocol_version,building_id,block_id FROM edge_nodes WHERE edge_id=$1`,[edgeId])).rows[0].building_id,null);
 const node=(await pool.query('SELECT id FROM edge_nodes WHERE edge_id=$1',[edgeId])).rows[0];
 assert.equal((await pool.query(`SELECT count(*)::int AS count FROM edge_node_buildings WHERE edge_node_id=$1`,[node.id])).rows[0].count,blockBuildingIds.length);
 assert.equal((await pool.query(`SELECT credential_hash FROM edge_credentials WHERE edge_node_id=$1`,[node.id])).rows[0].credential_hash,
  createHash('sha256').update(accessToken).digest('hex'));

 v2Socket=new WebSocket(`ws://127.0.0.1:${(server.address() as any).port}/api/edge/v2/connect?edgeId=${encodeURIComponent(edgeId)}`,{
  headers:machineHeaders,
 });
 await new Promise<void>((resolve,reject)=>{v2Socket!.once('open',resolve);v2Socket!.once('error',reject)});
 v2Socket.send(JSON.stringify({type:'EDGE_HELLO',protocolVersion:2,edgeId,tenantId:organizationId,blockId:block.data.id,agentVersion:'qa-agent-v2'}));
 const deadline=Date.now()+1500;let online=false;
 while(Date.now()<deadline){
  const state=await pool.query('SELECT status FROM edge_nodes WHERE id=$1',[node.id]);
  if(state.rows[0]?.status==='ONLINE'){online=true;break}
  await new Promise(resolve=>setTimeout(resolve,25));
 }
 assert.equal(online,true,'v2 WebSocket hello should mark the block-scoped Edge node online');

  const tokenList=await platform.call('/edge-console/bootstrap-tokens');
  assert.equal(tokenList.status,200);
  const listedToken=tokenList.data.tokens.find((item:any)=>item.edge_id===edgeId);
  assert.ok(listedToken,'issued token metadata should be available to authorized administrators');
  assert.equal(listedToken.token_hash,undefined,'token hashes must never be exposed');
  assert.equal(listedToken.bootstrapToken,undefined,'consumed plaintext must never be recoverable');

  const detail=await platform.call(`/edge-console/nodes/${node.id}`);
  assert.equal(detail.status,200);
  assert.deepEqual(detail.data.buildings.map((item:any)=>item.id).sort(),[...blockBuildingIds].sort());
  const connection=await platform.call(`/edge-console/nodes/${node.id}/connection-check`);
  assert.equal(connection.status,200);
  assert.equal(connection.data.webSocketOpen,true);
  assert.equal(connection.data.heartbeatFresh,true);
  assert.equal(connection.data.reachable,true);

  const renamed=await platform.call(`/edge-console/nodes/${node.id}`,'PATCH',{
   name:'Renamed isolated QA node',siteCode:`EDIT-${suffix}`,
  });
  assert.equal(renamed.status,200,`safe node metadata update failed: ${String(renamed.data?.code??'unknown')}`);
  assert.equal(renamed.data.edge_id,edgeId,'node identity must remain immutable');
  assert.equal(renamed.data.block_id,block.data.id,'node block scope must remain immutable');

  const changedBlock=await platform.call(`/edge-console/blocks/${block.data.id}`,'PATCH',{
   name:'Renamed isolated QA block',
  });
  assert.equal(changedBlock.status,200,`block metadata update failed: ${String(changedBlock.data?.code??'unknown')}`);
  assert.equal(changedBlock.data.code,blockCode,'block identity must remain stable');

  const archivedNode=await platform.call(`/edge-console/nodes/${node.id}`,'DELETE',{});
  assert.equal(archivedNode.status,200,`node archive failed: ${String(archivedNode.data?.code??'unknown')}`);
  const activeFleet=await platform.call('/edge-console/fleet');
  assert.equal(activeFleet.data.nodes.some((item:any)=>item.id===node.id),false);
  const archivedFleet=await platform.call('/edge-console/fleet?includeArchived=true');
  assert.equal(archivedFleet.data.nodes.some((item:any)=>item.id===node.id),true);
  const archivedBlock=await platform.call(`/edge-console/blocks/${block.data.id}`,'DELETE',{});
  assert.equal(archivedBlock.status,200,`block archive failed: ${String(archivedBlock.data?.code??'unknown')}`);
  const activeBlocks=await platform.call('/edge-console/blocks');
  assert.equal(activeBlocks.data.blocks.some((item:any)=>item.id===block.data.id),false);
  const allBlocks=await platform.call('/edge-console/blocks?includeArchived=true');
  assert.equal(allBlocks.data.blocks.some((item:any)=>item.id===block.data.id),true);
  const restoredBlock=await platform.call(`/edge-console/blocks/${block.data.id}/restore`,'POST',{});
  assert.equal(restoredBlock.status,200);
  const restoredNode=await platform.call(`/edge-console/nodes/${node.id}/restore`,'POST',{});
  assert.equal(restoredNode.status,200);
  assert.equal(restoredNode.data.credentialsMustBeRotated,true);
  assert.equal(restoredNode.data.edge_id,edgeId);
});
