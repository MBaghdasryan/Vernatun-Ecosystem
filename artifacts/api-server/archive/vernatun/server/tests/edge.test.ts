import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {WebSocket} from 'ws';
import {createApiServer} from '../../../../src/server.js';
import {pool} from '../db.js';
import {config} from '../config.js';
import {isEdgeConnected} from '../edge-sockets.js';
import {edgeTimestamp,edgeTimestampedRecord} from '../edge-timestamp.js';
import {deviceHealth,edgeThresholds,normalizeEdgeStatus,edgeStatusReasons} from '../edge-management-policy.js';

if(config.NODE_ENV!=='test'||!new URL(config.DATABASE_URL).pathname.endsWith('/vernatun_test'))
 throw new Error('Edge integration tests require the isolated vernatun_test database');
const seed=JSON.parse(await readFile('.local/test/demo-accounts.json','utf8'));
const account=(role:string)=>Object.values(seed.accounts).find((a:any)=>a.role===role) as any;
const {server,edgeSockets}=createApiServer();let base='';let agentSocket:WebSocket|undefined;let v2Socket:WebSocket|undefined;

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
 edgeSockets.close();
 await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
 await pool.end();
});

test('RFC3339 Edge timestamps accept offsets and microseconds and reject invalid strings',()=>{
 for(const timestamp of ['2026-10-25T22:00:00Z','2026-10-25T22:00:00.344Z',
  '2026-10-25T22:00:00+00:00','2026-10-25T22:00:00.344086+00:00',
  '2026-10-26T02:00:00.344086+04:00']){
  assert.equal(edgeTimestamp.parse(timestamp),new Date(timestamp).toISOString());
  assert.equal(edgeTimestampedRecord.parse({timestamp}).timestamp,new Date(timestamp).toISOString());
 }
 for(const timestamp of ['invalid','2026-10-25','2026-10-25T22:00:00','2026-02-30T22:00:00Z','2026-10-25T25:00:00+00:00']){
  assert.equal(edgeTimestamp.safeParse(timestamp).success,false,timestamp);
 }
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
    deviceId:'qa-barrier-1',profile:'Vernatun Barrier',label:'QA barrier',active:false,
  }],
 },machineHeaders);
 assert.equal(inventory.status,200);
 assert.equal(inventory.data.devices,1);
  const inventoryRow=(await pool.query(`SELECT reported_online,last_seen_at,metadata FROM edge_device_inventory
   WHERE edge_node_id=(SELECT id FROM edge_nodes WHERE edge_id=$1) AND edge_device_id='qa-barrier-1'`,[edgeId])).rows[0];
  assert.equal(inventoryRow.reported_online,null,'ThingsBoard active must not be stored as authoritative device health');
  assert.equal(inventoryRow.last_seen_at,null,'inventory discovery alone is not proof of live device activity');
  assert.equal(inventoryRow.metadata.adapterMetadata.thingsboardActive,false,'raw adapter metadata must remain available');

 const payload={edgeId,tenantId:organizationId,buildingId};
 for(const timestamp of ['2026-10-25T22:00:00Z','2026-10-25T22:00:00.344Z',
  '2026-10-25T22:00:00+00:00','2026-10-25T22:00:00.344086+00:00']){
  assert.equal((await platform.call('/edge/v1/heartbeat','POST',{...payload,timestamp},machineHeaders)).status,200);
  assert.equal((await platform.call('/edge/v1/inventory','POST',{...payload,timestamp,devices:[]},machineHeaders)).status,200);
 }
 for(const endpoint of ['heartbeat','inventory']){
  assert.equal((await platform.call('/edge/v1/'+endpoint,'POST',{...payload,timestamp:'invalid',devices:[]},machineHeaders)).status,400);
 }
 for(const endpoint of ['telemetry','events','alarms']){
   const body={...payload,items:[{deviceId:'qa-barrier-1',eventId:'qa-event-'+endpoint,alarmId:'qa-alarm',
    timestamp:new Date().toISOString(),temperature:21,...(endpoint==='telemetry'?{online:true}:{})}]};
  assert.equal((await platform.call('/edge/v1/'+endpoint+'/batch','POST',body,machineHeaders)).status,200,endpoint);
  body.items[0].timestamp='invalid';
  assert.equal((await platform.call('/edge/v1/'+endpoint+'/batch','POST',body,machineHeaders)).status,400,endpoint);
 }
 const wsBase=`ws://127.0.0.1:${(server.address() as any).port}/api/edge/v1/connect`;
 const denied=async(headers:Record<string,string>,query='')=>{
  await new Promise<void>((resolve,reject)=>{
   const socket=new WebSocket(wsBase+query,{headers,handshakeTimeout:2500});
   socket.on('error',()=>{});
   socket.once('open',()=>{socket.close();reject(new Error('Unexpected machine upgrade'))});
   socket.once('unexpected-response',(_req,res)=>{
    res.resume();socket.terminate();
    try{assert.equal(res.statusCode,401);resolve()}catch(error){reject(error)}
   });
   socket.once('error',error=>reject(error));
  });
 };
 await denied({});
 await denied({Cookie:platform.cookie});
 await denied({...machineHeaders,Authorization:'Bearer '+randomBytes(32).toString('hex')});
 await denied({...machineHeaders,'X-Vernatun-Edge-Id':'different-edge'});
 await denied({...machineHeaders,'X-Vernatun-Tenant-Id':'00000000-0000-4000-8000-000000000000'});
 await denied({...machineHeaders,'X-Vernatun-Building-Id':'00000000-0000-4000-8000-000000000000'});
 await denied(machineHeaders,'?edgeId=different-edge');
 await denied(machineHeaders,'?tenantId=00000000-0000-4000-8000-000000000000');
 await denied(machineHeaders,'?buildingId=00000000-0000-4000-8000-000000000000');
  // Existing Agent identity headers are sufficient; optional query IDs, when
  // supplied, must match the authoritative credential binding.
  agentSocket=new WebSocket(wsBase,{
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
 assert.equal(isEdgeConnected(node.id),true,'production server assembly must populate the Edge connection registry');
 const credential=(await pool.query(`SELECT credential_hash,status FROM edge_credentials
  WHERE edge_node_id=$1 ORDER BY version LIMIT 1`,[node.id])).rows[0];
 assert.equal(credential.status,'active');
 assert.equal(credential.credential_hash,createHash('sha256').update(accessToken).digest('hex'));
 assert.notEqual(credential.credential_hash,accessToken,'raw Agent credentials must never be stored');
 const storedBootstrap=(await pool.query('SELECT token_hash,used_at FROM edge_bootstrap_tokens WHERE edge_id=$1',[edgeId])).rows[0];
 assert.ok(storedBootstrap.used_at);
 assert.equal(storedBootstrap.token_hash,createHash('sha256').update(bootstrapToken).digest('hex'));

 const device=(await pool.query('SELECT id FROM edge_device_inventory WHERE edge_node_id=$1 AND edge_device_id=$2',[node.id,'qa-barrier-1'])).rows[0];
  const consoleDevices=await platform.call(`/edge-console/nodes/${node.id}/devices`);
  assert.equal(consoleDevices.status,200);
  const consoleBarrier=consoleDevices.data.find((d:any)=>d.edge_device_id==='qa-barrier-1');
  assert.equal(consoleBarrier.health_status,'ONLINE');
  assert.equal(consoleBarrier.thingsboard_active,false,'the adapter active flag must be visible only as metadata');
  assert.equal(consoleBarrier.reported_online,null);
 const assigned=await platform.call(`/edge-console/devices/${device.id}/access`,'PUT',{
  unitId,allowedCapabilities:['BARRIER.OPEN'],
 });
 assert.equal(assigned.status,200,`device access assignment failed: ${String(assigned.data?.error??assigned.data?.code??'unknown')}`);
 const residentDevices=await owner.call(`/me/buildings/${buildingId}/devices`);
 assert.equal(residentDevices.status,200);
 assert.equal(residentDevices.data.length,1);
 assert.equal(residentDevices.data[0].id,device.id);
 assert.deepEqual(residentDevices.data[0].permittedCapabilities,['BARRIER.OPEN']);
  const residentStatus=await owner.call(`/me/buildings/${buildingId}/devices`);
  assert.equal(residentStatus.data.find((d:any)=>d.id===device.id).health_status,'ONLINE');
 const crossBuilding=await owner.call('/me/buildings/00000000-0000-4000-8000-000000000000/devices');
 assert.equal(crossBuilding.status,403,'resident cannot query another building');
  const manager=await new Client().login('manager'),family=await new Client().login('family');
  assert.equal((await platform.call('/edge/v1/heartbeat','POST',{
   ...payload,local:{commandAuthorization:'OK',queueDepth:0},
  },machineHeaders)).status,200,'restore a healthy heartbeat after the timestamp-validation fixtures');
  const commandPath=`/buildings/${buildingId}/devices/${device.id}`;
  const received:any[]=[];
  const collect=(raw:any)=>{const message=JSON.parse(raw.toString());if(message.type==='COMMAND')received.push(message.command)};
  agentSocket!.on('message',collect);
  const waitCommands=async(count:number)=>{
   const deadline=Date.now()+2000;
   while(received.length<count&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));
   assert.equal(received.length,count,'only the expected commands may reach the isolated Agent');
  };
  const resultFor=(commandId:string,state?:string)=>agentSocket!.send(JSON.stringify({type:'COMMAND_RESULT',result:{
   commandId,status:'SUCCESS',localHttpStatus:200,result:{decision:'ALLOW',...(state?{deviceResponse:{state}}:{accepted:true})},
  }}));
  const waitStatus=async(actor:Client,commandId:string,status:string)=>{
   const deadline=Date.now()+2000;let result:any;
   do{
    result=await actor.call(`/me/edge-commands/${commandId}`);
    if(result.data.status===status)return result.data;
    await new Promise(resolve=>setTimeout(resolve,20));
   }while(Date.now()<deadline);
   assert.equal(result.data.status,status);
  };
  const availability=await manager.call(commandPath+'/actions');
  assert.equal(availability.status,200);
  assert.equal(availability.data.actions.find((a:any)=>a.capability==='BARRIER.OPEN').enabled,true,JSON.stringify(availability.data));
  assert.equal((await platform.call(commandPath+'/commands','POST',{capability:'BARRIER.OPEN',reason:'manual_control'})).status,403,
   'global administration must not implicitly permit physical control');
  const key='resident-double-'+randomBytes(8).toString('hex');
  const input={capability:'BARRIER.OPEN',reason:'Isolated command acceptance',idempotencyKey:key};
  const [open,duplicate]=await Promise.all([
   owner.call(`/me${commandPath}/commands`,'POST',input),
   owner.call(`/me${commandPath}/commands`,'POST',input),
  ]);
  assert.equal(open.status,202);assert.equal(duplicate.status,202);
  assert.equal(open.data.commandId,duplicate.data.commandId,'double submission must return the same command receipt');
  await waitCommands(1);
  const ownerId=(await pool.query('SELECT id FROM users WHERE email=$1',[account('unit_owner').email])).rows[0].id;
  assert.equal(received[0].actor.userId,ownerId);
  assert.equal(received[0].tenantId,organizationId);
  assert.equal(received[0].buildingId,buildingId);
  const concurrent=await manager.call(commandPath+'/commands','POST',{capability:'BARRIER.CLOSE',reason:'Conflicting command'});
  assert.equal(concurrent.status,403);
  assert.equal(concurrent.data.authorizationReason,'device_command_in_progress');
  assert.equal(received.length,1);
  resultFor(open.data.commandId,'OPEN');
  await waitStatus(owner,open.data.commandId,'SUCCESS');
  const nowOpen=await manager.call(commandPath+'/actions');
  assert.equal(nowOpen.data.state,'OPEN');
  assert.equal(nowOpen.data.actions.find((a:any)=>a.capability==='BARRIER.OPEN').reason,'device_already_in_target_state');
  assert.equal(nowOpen.data.actions.find((a:any)=>a.capability==='BARRIER.CLOSE').enabled,true);
  const close=await manager.call(commandPath+'/commands','POST',{capability:'BARRIER.CLOSE',reason:'Isolated close'});
  assert.equal(close.status,202);await waitCommands(2);
  resultFor(close.data.commandId);
  await waitStatus(manager,close.data.commandId,'ACKNOWLEDGED');
  resultFor(close.data.commandId,'CLOSED');
  await waitStatus(manager,close.data.commandId,'SUCCESS');
  assert.equal((await manager.call(commandPath+'/actions')).data.state,'CLOSED');
  for(const capability of ['FIRE.CONTROL','ELEVATOR.SAFETY_CONTROL']){
   const denied=await manager.call(commandPath+'/commands','POST',{capability,reason:'Safety deny acceptance'});
   assert.equal(denied.status,403);
   assert.equal(denied.data.authorizationReason,'safety_capability_hard_denied');
  }
  assert.equal((await family.call(commandPath+'/commands','POST',{capability:'BARRIER.OPEN',reason:'No family delegation'})).status,403);
   assert.equal((await manager.call(commandPath+'/actions')).data.actions.find((a:any)=>a.capability==='BARRIER.OPEN').enabled,true,
    'fresh telemetry must make a verified Barrier available even when ThingsBoard active is false');
   assert.equal((await pool.query('SELECT reported_online,metadata FROM edge_device_inventory WHERE id=$1',[device.id])).rows[0].metadata.adapterMetadata.thingsboardActive,false);
   const offlineTelemetry=await platform.call('/edge/v1/telemetry/batch','POST',{
    ...payload,items:[{deviceId:'qa-barrier-1',online:false,timestamp:new Date().toISOString()}],
   },machineHeaders);
   assert.equal(offlineTelemetry.status,200);
   const offlineActions=await manager.call(commandPath+'/actions');
   assert.equal(offlineActions.data.actions.find((a:any)=>a.capability==='BARRIER.OPEN').enabled,false);
  const offline=await manager.call(commandPath+'/commands','POST',{capability:'BARRIER.OPEN',reason:'Offline acceptance'});
  assert.equal(offline.status,409);assert.equal(offline.data.errorCode,'device_offline');
  assert.equal(received.length,2,'offline and denied commands must never be dispatched');
   assert.equal((await platform.call('/edge/v1/telemetry/batch','POST',{
    ...payload,items:[{deviceId:'qa-barrier-1',online:true,timestamp:new Date().toISOString()}],
   },machineHeaders)).status,200);
  const policy=await platform.call(`/edge-console/devices/${device.id}/capabilities`,'PUT',{enabledCapabilities:[]});
  assert.equal(policy.status,200);
  const disabled=await manager.call(commandPath+'/commands','POST',{capability:'BARRIER.OPEN',reason:'Disabled policy acceptance'});
  assert.equal(disabled.status,403);assert.equal(disabled.data.authorizationReason,'capability_disabled_by_policy');
  assert.equal((await platform.call(`/edge-console/devices/${device.id}/capabilities`,'PUT',{enabledCapabilities:['FIRE.CONTROL']})).status,400);
  assert.equal((await platform.call(`/edge-console/devices/${device.id}/capabilities`,'PUT',{enabledCapabilities:['BARRIER.OPEN','BARRIER.CLOSE']})).status,200);
  const raced=await Promise.all([1,2].map(n=>manager.call(commandPath+'/commands','POST',{
   capability:'BARRIER.OPEN',reason:'Concurrent operator '+n,idempotencyKey:'operator-'+n+'-'+randomBytes(8).toString('hex'),
  })));
  assert.deepEqual(raced.map(r=>r.status).sort(),[202,403]);
  await waitCommands(3);
  const accepted=raced.find(r=>r.status===202)!;
  resultFor(accepted.data.commandId,'OPEN');await waitStatus(manager,accepted.data.commandId,'SUCCESS');
  const audit=await pool.query(`SELECT action FROM audit_events WHERE entity_type='edge_command' AND entity_id=$1`,[accepted.data.commandId]);
  assert.ok(audit.rows.some((r:any)=>r.action==='edge.command.requested'));
  assert.ok(audit.rows.some((r:any)=>r.action==='edge.command.success'));
  agentSocket!.off('message',collect);
 const removed=await platform.call(`/edge-console/devices/${device.id}/access/${unitId}`,'DELETE');
 assert.equal(removed.status,200);
 assert.equal((await owner.call(`/me/buildings/${buildingId}/devices`)).data.length,0);
});

test('Human workspace drafts, one-time tokens, real diagnostics, config and cross-tenant isolation',async()=>{
 const suffix=randomBytes(6).toString('hex'),edgeId=`UI-${suffix}`;
 const testBuilding=(await pool.query(`INSERT INTO buildings(organization_id,name,address)
  VALUES($1,$2,'Isolated UI QA') RETURNING id`,[organizationId,`Workspace ${suffix}`])).rows[0].id;
 const created=await platform.call('/edge-console/nodes','POST',{
  organizationId,buildingId:testBuilding,edgeId,name:'Workspace draft',siteCode:`SITE-${suffix}`,
  enabledModules:['metering'],heartbeatSeconds:40,
 });
 assert.equal(created.status,201,JSON.stringify(created.data));
 const node=created.data;
 assert.equal(node.registration_state,'PENDING_REGISTRATION');
 const fleet=await platform.call(`/edge-console/fleet?page=1&pageSize=1&search=${edgeId}`);
 assert.equal(fleet.status,200);
 assert.equal(fleet.data.pagination.total,1);
 assert.equal(fleet.data.nodes.length,1);
 assert.equal(fleet.data.summary.waiting,1);
 const check=await platform.call(`/edge-console/nodes/${node.id}/connection-check`);
 assert.equal(check.status,200);
 assert.equal(check.data.checks.inventory.status,'UNKNOWN','no invented inventory evidence');
 assert.equal(check.data.checks.websocket.status,'FAILED');
 assert.equal(check.data.reachable,false);
 const first=await platform.call(`/edge-console/nodes/${node.id}/bootstrap-token`,'POST',{expiresInMinutes:30});
 assert.equal(first.status,201,JSON.stringify(first.data));
 const second=await platform.call(`/edge-console/nodes/${node.id}/bootstrap-token`,'POST',{expiresInMinutes:30});
 assert.equal(second.status,201);
 assert.notEqual(second.data.bootstrapToken,first.data.bootstrapToken);
 const detail=await platform.call(`/edge-console/nodes/${node.id}`);
 assert.equal(detail.status,200);
 assert.equal(detail.data.node.credential_issued_at,null,'draft has no issued credential, not a revoked credential');
 const publicJson=JSON.stringify(detail.data);
 assert.equal(publicJson.includes(first.data.bootstrapToken),false);
 assert.equal(publicJson.includes(second.data.bootstrapToken),false);
 assert.equal(publicJson.includes('token_hash'),false);
 assert.equal(publicJson.includes('credential_hash'),false);
 assert.equal(detail.data.tokens.filter((t:any)=>t.status==='PENDING').length,1);
 const identity={'X-Vernatun-Edge-Id':edgeId,'X-Vernatun-Tenant-Id':organizationId,'X-Vernatun-Building-Id':testBuilding};
 const registration={edgeId,tenantId:organizationId,buildingId:testBuilding,siteCode:`SITE-${suffix}`,edgeName:'Workspace draft'};
 const old=await platform.call('/edge/v1/register','POST',registration,{...identity,Authorization:`Bearer ${first.data.bootstrapToken}`});
 assert.equal(old.status,401);
 const registered=await platform.call('/edge/v1/register','POST',registration,{...identity,Authorization:`Bearer ${second.data.bootstrapToken}`});
 assert.equal(registered.status,201,JSON.stringify(registered.data));
 assert.equal((await pool.query('SELECT count(*)::int AS count FROM edge_nodes WHERE edge_id=$1',[edgeId])).rows[0].count,1);
 assert.equal((await platform.call(`/edge-console/nodes/${node.id}/bootstrap-token`,'POST',{})).status,409);
 const updated=await platform.call(`/edge-console/nodes/${node.id}`,'PATCH',{heartbeatSeconds:50,description:'Reviewed settings',enabledModules:['metering','cameras']});
 assert.equal(updated.status,200);
 const agentConfig=await platform.call(`/edge/v1/config?edgeId=${edgeId}`,'GET',undefined,
  {...identity,Authorization:`Bearer ${registered.data.accessToken}`});
 assert.equal(agentConfig.status,200);
 assert.equal(agentConfig.data.heartbeatIntervalSeconds,50);
 assert.equal((await platform.call(`/edge-console/nodes/${node.id}`,'PATCH',{capabilities:['FIRE.CONTROL']})).status,400);
 assert.equal((await platform.call(`/edge-console/nodes/${node.id}`,'PATCH',{enabledModules:['FIRE.CONTROL']})).status,400);

 const orgAdmin=await new Client().login('org_admin');
 const orgSession=(await orgAdmin.call('/auth/session')).data;
 const orgContext=orgSession.contexts.find((v:any)=>v.role_key==='org_admin');
 await pool.query(`INSERT INTO module_entitlements(organization_id,module,enabled) VALUES($1,'smart_building',true)
  ON CONFLICT(organization_id,module) DO UPDATE SET enabled=true`,[orgContext.organization_id]);
 const foreignOrg=(await pool.query(`INSERT INTO organizations(name,currency) VALUES($1,'AMD') RETURNING id`,[`Foreign isolated ${suffix}`])).rows[0].id;
 const foreignBuilding=(await pool.query(`INSERT INTO buildings(organization_id,name,address) VALUES($1,'Foreign Edge QA','Isolated QA') RETURNING id`,[foreignOrg])).rows[0].id;
 const foreign=await platform.call('/edge-console/nodes','POST',{organizationId:foreignOrg,buildingId:foreignBuilding,
  edgeId:`FOREIGN-${suffix}`,name:'Foreign draft',siteCode:'FOREIGN'});
 assert.equal(foreign.status,201);
 assert.equal((await orgAdmin.call(`/edge-console/nodes/${foreign.data.id}`)).status,404);
 assert.equal((await orgAdmin.call(`/edge-console/nodes/${foreign.data.id}/bootstrap-token`,'POST',{})).status,404);
 assert.equal((await orgAdmin.call(`/edge-console/fleet?organizationId=${foreignOrg}`)).status,403);
 assert.equal((await orgAdmin.call(`/edge-console/nodes/${node.id}/credentials/rotate`,'POST',{})).status,403);
 const orgFleet=await orgAdmin.call('/edge-console/fleet');
 assert.equal(orgFleet.status,200);
 assert.ok(orgFleet.data.nodes.every((v:any)=>v.organization_id===orgContext.organization_id));
 const now=Date.now(),healthy={registration_state:'REGISTERED',last_heartbeat_at:new Date(now),credential_active:true,local_authorization_status:'OK',queue_depth:0};
  const deviceThresholds={deviceStaleAfterSeconds:120,deviceOfflineAfterSeconds:300};
  assert.equal(deviceHealth({edgeOnline:true},deviceThresholds,now).healthStatus,'UNKNOWN');
  assert.equal(deviceHealth({edgeOnline:true,lastTelemetryAt:new Date(now-30_000)},deviceThresholds,now).healthStatus,'ONLINE');
  assert.equal(deviceHealth({edgeOnline:true,lastEventAt:new Date(now-180_000)},deviceThresholds,now).healthStatus,'STALE');
  assert.equal(deviceHealth({edgeOnline:true,lastAlarmAt:new Date(now-301_000)},deviceThresholds,now).healthStatus,'OFFLINE');
  assert.equal(deviceHealth({edgeOnline:true,explicitOnline:'false',lastTelemetryAt:new Date(now)},deviceThresholds,now).healthStatus,'OFFLINE');
  assert.equal(deviceHealth({edgeOnline:true,gatewayAvailable:false,lastTelemetryAt:new Date(now)},deviceThresholds,now).healthStatus,'OFFLINE');
  assert.equal(deviceHealth({edgeOnline:false,lastTelemetryAt:new Date(now)},deviceThresholds,now).healthStatus,'OFFLINE');
  const customThresholds=edgeThresholds({management_config:{deviceStaleAfterSeconds:240,deviceOfflineAfterSeconds:600}});
  assert.equal(deviceHealth({edgeOnline:true,lastTelemetryAt:new Date(now-200_000)},customThresholds,now).healthStatus,'ONLINE');
 assert.equal(normalizeEdgeStatus(healthy,true,now),'ONLINE');
  assert.deepEqual(edgeStatusReasons(healthy,true,now),[]);
 assert.equal(normalizeEdgeStatus(healthy,false,now),'OFFLINE');
 assert.equal(normalizeEdgeStatus({...healthy,last_heartbeat_at:new Date(now-121000)},true,now),'OFFLINE');
 assert.equal(normalizeEdgeStatus({...healthy,queue_depth:101},true,now),'DEGRADED');
  assert.deepEqual(edgeStatusReasons({...healthy,queue_depth:101},true,now),['queue_depth']);
  assert.deepEqual(edgeStatusReasons({...healthy,last_inventory_at:new Date(now-601000)},true,now),['inventory_stale']);
  assert.deepEqual(edgeStatusReasons({...healthy,last_telemetry_at:new Date(now-301000)},true,now),['telemetry_stale']);
 assert.equal(normalizeEdgeStatus({...healthy,last_heartbeat_at:new Date(now-200000),
  management_config:{heartbeatSeconds:300}},true,now),'ONLINE','custom intervals must not become stale before their scheduled heartbeat');

 const blockBuildings=(await pool.query(`INSERT INTO buildings(organization_id,name,address)
  VALUES($1,'Draft block A','Isolated QA A'),($1,'Draft block B','Isolated QA B') RETURNING id`,[organizationId])).rows.map(b=>b.id);
 const block=await platform.call('/edge-console/blocks','POST',{organizationId,code:`DRAFT-${suffix}`,
  name:'Draft multi-building',buildingIds:blockBuildings});
 assert.equal(block.status,201);
 const v2Draft=await platform.call('/edge-console/nodes','POST',{organizationId,blockId:block.data.id,
  edgeId:`BLOCK-${suffix}`,name:'Block draft',siteCode:'DRAFT-BLOCK'});
 assert.equal(v2Draft.status,201);
 const bindings=await platform.call(`/edge-console/nodes/${v2Draft.data.id}/buildings`,'PATCH',{buildingIds:[blockBuildings[0]]});
 assert.equal(bindings.status,200);
 assert.equal((await platform.call(`/edge-console/nodes/${v2Draft.data.id}/buildings`,'PATCH',{buildingIds:[foreignBuilding]})).status,400);
 const v2Token=await platform.call(`/edge-console/nodes/${v2Draft.data.id}/bootstrap-token`,'POST',{expiresInMinutes:30});
 assert.equal(v2Token.status,201);
 const v2Register=await platform.call('/edge/v2/register','POST',{protocolVersion:2,edgeId:`BLOCK-${suffix}`,
  tenantId:organizationId,blockId:block.data.id,siteCode:'DRAFT-BLOCK',edgeName:'Block draft'},{
  Authorization:`Bearer ${v2Token.data.bootstrapToken}`,'X-Vernatun-Edge-Id':`BLOCK-${suffix}`,
  'X-Vernatun-Tenant-Id':organizationId,'X-Vernatun-Block-Id':block.data.id,
 });
 assert.equal(v2Register.status,201);
 assert.deepEqual(v2Register.data.buildingIds,[blockBuildings[0]],'registration must retain explicit draft bindings, not expand them');
 assert.equal((await platform.call(`/edge-console/nodes/${v2Draft.data.id}/buildings`,'PATCH',{buildingIds:blockBuildings})).status,200);
 const blockToken=await platform.call(`/edge-console/blocks/${block.data.id}/bootstrap-tokens`,'POST',{
  edgeId:`SCOPE-${suffix}`,name:'Scoped token QA',siteCode:'SCOPE-QA'});
 assert.equal(blockToken.status,201);
 await pool.query('UPDATE role_assignments SET building_id=$2 WHERE id=$1',[orgContext.id,blockBuildings[0]]);
 assert.equal((await orgAdmin.call(`/edge-console/nodes/${v2Draft.data.id}`)).status,403);
 assert.equal((await orgAdmin.call(`/edge-console/nodes/${v2Draft.data.id}/devices`)).status,404);
 assert.equal((await orgAdmin.call(`/edge-console/nodes/${v2Draft.data.id}`,'DELETE')).status,404);
 assert.equal((await orgAdmin.call(`/edge-console/blocks/${block.data.id}`,'PATCH',{name:'Not allowed'})).status,404);
 const scopedBlocks=await orgAdmin.call('/edge-console/blocks');
 assert.equal(scopedBlocks.status,200);
 assert.ok(!scopedBlocks.data.blocks.some((b:any)=>b.id===block.data.id));
 const scopedTokens=await orgAdmin.call('/edge-console/bootstrap-tokens');
 assert.equal(scopedTokens.status,200);
 assert.ok(!scopedTokens.data.tokens.some((t:any)=>t.id===blockToken.data.id));
 assert.equal((await orgAdmin.call(`/edge-console/bootstrap-tokens/${blockToken.data.id}/revoke`,'POST')).status,404);
 await pool.query('UPDATE role_assignments SET building_id=NULL WHERE id=$1',[orgContext.id]);
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
