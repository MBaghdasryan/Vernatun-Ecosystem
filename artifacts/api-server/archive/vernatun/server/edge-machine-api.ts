import {Router,type Request} from 'express';
import {createHash,randomBytes} from 'node:crypto';
import {z} from 'zod';
import {pool} from './db.js';
import {ApiError} from './access.js';
import {recordEdgeCommandResult} from './edge-sockets.js';
import {authenticateEdgeToken} from './edge-auth.js';
import {edgeTimestamp,edgeTimestampedRecord,edgeSourceTime as sourceTime} from './edge-timestamp.js';
import {logger} from '../../../src/lib/logger.js';

const digest=(token:string)=>createHash('sha256').update(token).digest('hex');
const id=z.string().uuid();
const edgeIdSchema=z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/);
type EdgeNode={id:string;edge_id:string;organization_id:string;building_id:string;name:string;site_code:string};
type MachineRequest=Request&{edgeNode?:EdgeNode};
const router=Router();
const registerBody=z.object({
 edgeId:edgeIdSchema,tenantId:id,buildingId:id,siteCode:z.string().trim().min(1).max(100),
 edgeName:z.string().trim().min(2).max(120),agentVersion:z.string().trim().max(80).optional(),
 platform:z.string().trim().max(60).optional(),capabilities:z.record(z.string(),z.unknown()).optional()
});

function bearer(req:Request){
 const header=req.get('Authorization')??'';
 if(!header.startsWith('Bearer '))throw new ApiError(401,'edge_unauthorized');
 const token=header.slice(7);
 if(token.length<20||token.length>256)throw new ApiError(401,'edge_unauthorized');
 return token;
}
function verifyRequestIdentity(req:Request,node:EdgeNode,body?:any){
 const pairs:[string,string][]=[
  [req.get('X-Vernatun-Edge-Id')??'',node.edge_id],
  [req.get('X-Vernatun-Tenant-Id')??'',node.organization_id],
  [req.get('X-Vernatun-Building-Id')??'',node.building_id]
 ];
 for(const [provided,expected] of pairs)if(!provided||provided.toLowerCase()!==expected.toLowerCase())throw new ApiError(401,'edge_identity_mismatch');
 if(body&&(body.edgeId!==node.edge_id||body.tenantId?.toLowerCase()!==node.organization_id.toLowerCase()||body.buildingId?.toLowerCase()!==node.building_id.toLowerCase()))
  throw new ApiError(403,'edge_payload_scope_mismatch');
}
async function authenticatedNode(req:MachineRequest){
 if(req.edgeNode)return req.edgeNode;
 const node=await authenticateEdgeToken(bearer(req)) as EdgeNode|null;
 if(!node)throw new ApiError(401,'edge_unauthorized');
 verifyRequestIdentity(req,node);
 req.edgeNode=node;
 return node;
}
const machineAuth=(req:MachineRequest,_res:any,next:(error?:unknown)=>void)=>{
 void authenticatedNode(req).then(()=>next(),next);
};

router.post('/register',async(req,res)=>{
 const input=registerBody.parse(req.body);
 if(input.edgeId!==(req.get('X-Vernatun-Edge-Id')??'')||
  input.tenantId.toLowerCase()!==(req.get('X-Vernatun-Tenant-Id')??'').toLowerCase()||
  input.buildingId.toLowerCase()!==(req.get('X-Vernatun-Building-Id')??'').toLowerCase())
  throw new ApiError(403,'edge_payload_scope_mismatch');
 const bootstrapToken=bearer(req),credential=`vne_${randomBytes(32).toString('base64url')}`;
 const tokenHash=digest(bootstrapToken),credentialHash=digest(credential);
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const token=(await client.query(`SELECT * FROM edge_bootstrap_tokens
   WHERE token_hash=$1 FOR UPDATE`,[tokenHash])).rows[0];
  if(!token||token.used_at||token.revoked_at||new Date(token.expires_at).getTime()<=Date.now())
   throw new ApiError(401,'bootstrap_token_invalid_or_used');
  if(token.protocol_version!==1||token.edge_id!==input.edgeId||token.organization_id.toLowerCase()!==input.tenantId.toLowerCase()||
   token.building_id?.toLowerCase()!==input.buildingId.toLowerCase()||token.site_code!==input.siteCode||
   token.edge_name!==input.edgeName)
   throw new ApiError(403,'bootstrap_binding_mismatch');
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[input.edgeId]);
  const occupied=await client.query(`SELECT * FROM edge_nodes
   WHERE edge_id=$1 OR building_id=$2 FOR UPDATE`,[input.edgeId,input.buildingId]);
  const draft=occupied.rows.find(n=>n.edge_id===input.edgeId&&n.organization_id===token.organization_id&&
   n.building_id===token.building_id&&n.protocol_version===1&&n.registration_state==='PENDING_REGISTRATION'&&!n.archived_at);
  if(occupied.rowCount&&(!draft||occupied.rowCount!==1))throw new ApiError(409,'edge_already_registered');
  const node=draft?(await client.query(`UPDATE edge_nodes SET registration_state='REGISTERED',registered_at=now(),
   agent_version=$2,platform=$3,capabilities=$4,updated_at=now() WHERE id=$1
   RETURNING id,edge_id,organization_id,building_id,name,status`,
   [draft.id,input.agentVersion??null,input.platform??null,JSON.stringify(input.capabilities??{})])).rows[0]
   :(await client.query(`INSERT INTO edge_nodes
   (edge_id,organization_id,building_id,name,site_code,agent_version,platform,capabilities)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,edge_id,organization_id,building_id,name,status`,
   [input.edgeId,token.organization_id,token.building_id,input.edgeName,token.site_code,
    input.agentVersion??null,input.platform??null,JSON.stringify(input.capabilities??{})])).rows[0];
  await client.query(`INSERT INTO edge_node_buildings(edge_node_id,organization_id,building_id)
   VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[node.id,node.organization_id,node.building_id]);
  await client.query(`INSERT INTO edge_credentials(edge_node_id,credential_hash,version)
   VALUES($1,$2,1)`,[node.id,credentialHash]);
  await client.query(`UPDATE edge_bootstrap_tokens SET used_at=now(),used_by_edge_node_id=$2 WHERE id=$1`,
   [token.id,node.id]);
  await client.query(`INSERT INTO audit_events(organization_id,action,entity_type,entity_id,details)
   VALUES($1,'edge.register','edge_node',$2,$3)`,[node.organization_id,node.id,
    JSON.stringify({edgeId:node.edge_id,buildingId:node.building_id,version:input.agentVersion??null})]);
  await client.query('COMMIT');
  res.status(201).json({edgeId:node.edge_id,tenantId:node.organization_id,buildingId:node.building_id,
   status:'REGISTERED',accessToken:credential,tokenType:'Bearer'});
 }catch(error){await client.query('ROLLBACK');throw error}
 finally{client.release()}
});

router.post('/heartbeat',machineAuth,async(req:MachineRequest,res)=>{
 const node=await authenticatedNode(req);
 const body=z.object({edgeId:edgeIdSchema,tenantId:id,buildingId:id,timestamp:edgeTimestamp.optional(),
  agentVersion:z.string().trim().max(80).optional(),
  local:z.object({commandAuthorization:z.string().trim().max(40).optional(),queueDepth:z.number().int().min(0).max(100000).optional()}).optional()
 }).parse(req.body);
 verifyRequestIdentity(req,node,body);
 const authStatus=body.local?.commandAuthorization??'UNKNOWN';
 const status=authStatus==='OK'?'ONLINE':'DEGRADED';
 await pool.query(`UPDATE edge_nodes SET status=$2,last_seen_at=now(),last_heartbeat_at=now(),
  agent_version=COALESCE($3,agent_version),local_authorization_status=$4,queue_depth=$5,updated_at=now()
  WHERE id=$1`,[node.id,status,body.agentVersion??null,authStatus,body.local?.queueDepth??0]);
 logger.info({code:'edge_heartbeat_accepted',edgeNodeId:node.id},'Edge heartbeat accepted');
 res.json({status:'ACCEPTED',serverTime:new Date().toISOString()});
});

function profileCapabilities(profile:string){
 if(profile==='Vernatun Barrier')return ['BARRIER.OPEN','BARRIER.CLOSE'];
 return [];
}
function deviceType(profile:string){
 if(profile.includes('Barrier'))return 'barrier';
 if(profile.includes('Camera'))return 'camera';
 if(profile.includes('Elevator'))return 'elevator';
 if(profile.includes('Meter'))return 'meter';
 if(profile.includes('Smoke'))return 'smoke_detector';
 if(profile.includes('Access Door'))return 'access_door';
 if(profile.includes('HVAC'))return 'hvac';
 if(profile.includes('Pump'))return 'pump';
 return 'unknown';
}
router.post('/inventory',machineAuth,async(req:MachineRequest,res)=>{
 const node=await authenticatedNode(req);
 const body=z.object({edgeId:edgeIdSchema,tenantId:id,buildingId:id,timestamp:edgeTimestamp.optional(),
  devices:z.array(z.object({deviceId:z.string().trim().min(1).max(200),thingsboardId:z.string().max(200).nullable().optional(),
   profile:z.string().trim().min(1).max(100),label:z.string().max(200).nullable().optional(),active:z.boolean().optional()})).max(1000)
 }).parse(req.body);
 verifyRequestIdentity(req,node,body);
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  for(const device of body.devices){
   const capabilities=profileCapabilities(device.profile);
   await client.query(`INSERT INTO edge_device_inventory
    (edge_node_id,organization_id,building_id,edge_device_id,thingsboard_id,name,profile,device_type,label,
     capabilities,reported_online,last_seen_at,metadata,updated_at)
    VALUES($1,$2,$3,$4,$5,$4,$6,$7,$8,$9,$10,now(),'{}',now())
     ON CONFLICT(edge_node_id,building_id,edge_device_id) DO UPDATE SET
     thingsboard_id=EXCLUDED.thingsboard_id,name=EXCLUDED.name,profile=EXCLUDED.profile,
     device_type=EXCLUDED.device_type,label=EXCLUDED.label,capabilities=EXCLUDED.capabilities,
     reported_online=EXCLUDED.reported_online,last_seen_at=now(),updated_at=now()`,
   [node.id,node.organization_id,node.building_id,device.deviceId,device.thingsboardId??null,
    device.profile,deviceType(device.profile),device.label??null,JSON.stringify(capabilities),device.active??null]);
  }
  await client.query(`UPDATE edge_nodes SET last_seen_at=now(),last_inventory_at=now(),status=CASE WHEN status='DISABLED' THEN status ELSE 'ONLINE' END,updated_at=now() WHERE id=$1`,[node.id]);
  await client.query('COMMIT');
  logger.info({code:'edge_inventory_accepted',edgeNodeId:node.id,devices:body.devices.length},'Edge inventory accepted');
  res.json({status:'ACCEPTED',devices:body.devices.length});
 }catch(error){await client.query('ROLLBACK');throw error}
 finally{client.release()}
});

const batchItems=(body:any)=>{
 edgeTimestampedRecord.parse(body);
 const list=body?.items??body?.records??body?.telemetry??body?.events??body?.alarms;
 if(!Array.isArray(list)||list.length>2000)throw new ApiError(400,'invalid_edge_batch');
 return list.map(item=>edgeTimestampedRecord.parse(item));
};
async function requireDevice(node:EdgeNode,externalId:string){
 const row=await pool.query(`SELECT id FROM edge_device_inventory
  WHERE edge_node_id=$1 AND edge_device_id=$2`,[node.id,externalId]);
 if(!row.rowCount)throw new ApiError(400,'unknown_edge_device');
 return row.rows[0].id as string;
}
router.post('/telemetry/batch',machineAuth,async(req:MachineRequest,res)=>{
 const node=await authenticatedNode(req),body=req.body;
 verifyRequestIdentity(req,node,body);
 const items=batchItems(body),client=await pool.connect();
 try{
  await client.query('BEGIN');
  for(const item of items){
   if(!item||typeof item.deviceId!=='string')throw new ApiError(400,'invalid_telemetry_item');
   const device=await requireDevice(node,item.deviceId);
   const values=item.values&&typeof item.values==='object'&&!Array.isArray(item.values)?item.values:item;
   for(const [key,value] of Object.entries(values)){
    if(['deviceId','timestamp','ts','time','edgeId','tenantId','buildingId'].includes(key))continue;
    if(key.length>100||JSON.stringify(value).length>50000)throw new ApiError(400,'invalid_telemetry_value');
    await client.query(`INSERT INTO edge_telemetry_current(device_inventory_id,telemetry_key,value,source_timestamp,received_at)
     VALUES($1,$2,$3,$4,now()) ON CONFLICT(device_inventory_id,telemetry_key)
     DO UPDATE SET value=EXCLUDED.value,source_timestamp=EXCLUDED.source_timestamp,received_at=now()
     WHERE edge_telemetry_current.received_at<=now()`,[device,key,JSON.stringify(value),sourceTime(item.timestamp??item.ts)]);
   }
   await client.query('UPDATE edge_device_inventory SET last_telemetry_at=now(),last_seen_at=now() WHERE id=$1',[device]);
  }
  await client.query('UPDATE edge_nodes SET last_seen_at=now(),last_telemetry_at=now(),updated_at=now() WHERE id=$1',[node.id]);
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error}
 finally{client.release()}
 res.json({status:'ACCEPTED',items:items.length});
});
router.post('/events/batch',machineAuth,async(req:MachineRequest,res)=>{
 const node=await authenticatedNode(req),body=req.body;
 verifyRequestIdentity(req,node,body);
 const items=batchItems(body),client=await pool.connect();let inserted=0;
 try{
  await client.query('BEGIN');
  for(const item of items){
   if(!item||typeof item.deviceId!=='string')throw new ApiError(400,'invalid_edge_event');
   const device=await requireDevice(node,item.deviceId);
   const externalId=typeof item.eventId==='string'?item.eventId.slice(0,200):null;
   const result=await client.query(`INSERT INTO edge_events
    (edge_node_id,device_inventory_id,organization_id,building_id,external_event_id,event_type,severity,source_timestamp,payload)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT(edge_node_id,building_id,external_event_id) WHERE external_event_id IS NOT NULL DO NOTHING`,
   [node.id,device,node.organization_id,node.building_id,externalId,
    String(item.type??item.eventType??'edge.event').slice(0,100),
    typeof item.severity==='string'&&['info','warning','critical','emergency'].includes(item.severity)?item.severity:'info',
    sourceTime(item.timestamp??item.ts),JSON.stringify(item)]);
   inserted+=result.rowCount??0;
  }
  await client.query('UPDATE edge_nodes SET last_seen_at=now(),last_event_at=now(),updated_at=now() WHERE id=$1',[node.id]);
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error}
 finally{client.release()}
 res.json({status:'ACCEPTED',received:items.length,inserted});
});
router.post('/alarms/batch',machineAuth,async(req:MachineRequest,res)=>{
 const node=await authenticatedNode(req),body=req.body;
 verifyRequestIdentity(req,node,body);
 const items=batchItems(body),client=await pool.connect();let inserted=0;
 try{
  await client.query('BEGIN');
  for(const item of items){
   if(!item||typeof item.deviceId!=='string'||typeof item.alarmId!=='string')throw new ApiError(400,'invalid_edge_alarm');
   const device=await requireDevice(node,item.deviceId);
   const result=await client.query(`INSERT INTO edge_alarms
    (edge_node_id,device_inventory_id,organization_id,building_id,external_alarm_id,alarm_type,severity,source_timestamp,payload)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT(edge_node_id,building_id,external_alarm_id) DO NOTHING`,
   [node.id,device,node.organization_id,node.building_id,item.alarmId.slice(0,200),
    String(item.type??'edge.alarm').slice(0,100),
    typeof item.severity==='string'&&['info','warning','critical','emergency'].includes(item.severity)?item.severity:'warning',
    sourceTime(item.timestamp??item.ts),JSON.stringify(item)]);
   inserted+=result.rowCount??0;
  }
  await client.query('UPDATE edge_nodes SET last_seen_at=now(),last_alarm_at=now(),updated_at=now() WHERE id=$1',[node.id]);
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error}
 finally{client.release()}
 res.json({status:'ACCEPTED',received:items.length,inserted});
});

router.get('/config',machineAuth,async(req:MachineRequest,res)=>{
 const node=await authenticatedNode(req);
 if(req.query.edgeId!==node.edge_id)throw new ApiError(403,'edge_identity_mismatch');
 const row=(await pool.query(`SELECT config_version AS "configVersion",capabilities,management_config,
  organization_id AS "tenantId",building_id AS "buildingId" FROM edge_nodes WHERE id=$1`,[node.id])).rows[0];
 res.json({edgeId:node.edge_id,...row,heartbeatIntervalSeconds:row.management_config.heartbeatSeconds,
  inventoryIntervalSeconds:row.management_config.inventorySeconds,telemetryBatchIntervalSeconds:row.management_config.telemetrySeconds,
  endpoints:{heartbeat:'/api/edge/v1/heartbeat',inventory:'/api/edge/v1/inventory',
   telemetry:'/api/edge/v1/telemetry/batch',events:'/api/edge/v1/events/batch',
   alarms:'/api/edge/v1/alarms/batch',websocket:'/api/edge/v1/connect'}});
});
router.post('/commands/:commandId/result',machineAuth,async(req:MachineRequest,res)=>{
 const node=await authenticatedNode(req);
 const body=z.object({edgeId:edgeIdSchema,tenantId:id,buildingId:id,commandId:id,
  status:z.string().trim().min(1).max(40),timestamp:edgeTimestamp.optional()}).passthrough().parse(req.body);
 verifyRequestIdentity(req,node,body);
 if(body.commandId!==req.params.commandId)throw new ApiError(400,'command_id_mismatch');
 res.json(await recordEdgeCommandResult(node.id,body));
});
export const edgeMachineApi=router;
