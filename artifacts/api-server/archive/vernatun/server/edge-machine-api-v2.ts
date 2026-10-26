import {Router,type Request} from 'express';
import {createHash,randomBytes} from 'node:crypto';
import {z} from 'zod';
import {defaultEnabledCapabilitiesForProfile,getDeviceActionProfile,reportedCapabilitiesForProfile} from '@workspace/api-zod';
import {pool} from './db.js';
import {ApiError} from './access.js';
import {recordEdgeCommandResult} from './edge-sockets.js';
import {authenticateEdgeToken} from './edge-auth.js';
import {edgeTimestamp,edgeTimestampedRecord,edgeSourceTime as sourceTime} from './edge-timestamp.js';

const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const uuid=z.string().uuid();
const edgeIdSchema=z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/);
type EdgeV2Node={id:string;edge_id:string;organization_id:string;block_id:string;name:string;site_code:string;protocol_version:number};
type EdgeV2Request=Request&{edgeV2?:EdgeV2Node};
const router=Router();
const registrationSchema=z.object({
 protocolVersion:z.literal(2),edgeId:edgeIdSchema,tenantId:uuid,blockId:uuid,
 siteCode:z.string().trim().min(1).max(100),edgeName:z.string().trim().min(2).max(120),
 agentVersion:z.string().trim().max(80).optional(),platform:z.string().trim().max(60).optional(),
 capabilities:z.record(z.string(),z.unknown()).optional(),
}).strict();

function bearer(req:Request){
 const header=req.get('Authorization')??'';
 if(!header.startsWith('Bearer '))throw new ApiError(401,'edge_unauthorized');
 const token=header.slice(7);
 if(token.length<20||token.length>256)throw new ApiError(401,'edge_unauthorized');
 return token;
}
function verifyIdentity(req:Request,node:EdgeV2Node,body?:any){
 const pairs:[string,string][]=[
  [req.get('X-Vernatun-Edge-Id')??'',node.edge_id],
  [req.get('X-Vernatun-Tenant-Id')??'',node.organization_id],
  [req.get('X-Vernatun-Block-Id')??'',node.block_id],
 ];
 for(const [provided,expected] of pairs)if(!provided||provided.toLowerCase()!==expected.toLowerCase())
  throw new ApiError(401,'edge_identity_mismatch');
 if(body&&(body.protocolVersion!==2||body.edgeId!==node.edge_id||
  body.tenantId?.toLowerCase()!==node.organization_id.toLowerCase()||
  body.blockId?.toLowerCase()!==node.block_id.toLowerCase()))
  throw new ApiError(403,'edge_payload_scope_mismatch');
}
async function authenticatedNode(req:EdgeV2Request){
 if(req.edgeV2)return req.edgeV2;
 const node=await authenticateEdgeToken(bearer(req)) as EdgeV2Node|null;
 if(!node||node.protocol_version!==2||!node.block_id)throw new ApiError(401,'edge_unauthorized');
 verifyIdentity(req,node);
 req.edgeV2=node;
 return node;
}
const machineAuth=(req:EdgeV2Request,_res:any,next:(error?:unknown)=>void)=>{
 void authenticatedNode(req).then(()=>next(),next);
};
async function assertBuilding(node:EdgeV2Node,buildingId:string,db:any=pool){
 const found=await db.query(`SELECT 1 FROM edge_node_buildings
  WHERE edge_node_id=$1 AND organization_id=$2 AND block_id=$3 AND building_id=$4`,
 [node.id,node.organization_id,node.block_id,buildingId]);
 if(!found.rowCount)throw new ApiError(403,'building_outside_edge_block');
}
function deviceType(profile:string){
 const registered=getDeviceActionProfile(profile);
 if(registered)return registered.deviceType;
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
const batchItems=(body:any)=>{
 edgeTimestampedRecord.parse(body);
 const list=body?.items??body?.records??body?.telemetry??body?.events??body?.alarms;
 if(!Array.isArray(list)||list.length>2000)throw new ApiError(400,'invalid_edge_batch');
 return list.map(item=>edgeTimestampedRecord.parse(item));
};
async function requireDevice(node:EdgeV2Node,buildingId:string,externalId:string,db:any=pool){
 await assertBuilding(node,buildingId,db);
 const result=await db.query(`SELECT id FROM edge_device_inventory
  WHERE edge_node_id=$1 AND organization_id=$2 AND building_id=$3 AND edge_device_id=$4`,
 [node.id,node.organization_id,buildingId,externalId]);
 if(!result.rowCount)throw new ApiError(400,'unknown_edge_device');
 return result.rows[0].id as string;
}

router.post('/register',async(req,res)=>{
 const input=registrationSchema.parse(req.body);
 if(input.edgeId!==(req.get('X-Vernatun-Edge-Id')??'')||
  input.tenantId.toLowerCase()!==(req.get('X-Vernatun-Tenant-Id')??'').toLowerCase()||
  input.blockId.toLowerCase()!==(req.get('X-Vernatun-Block-Id')??'').toLowerCase())
  throw new ApiError(403,'edge_payload_scope_mismatch');
 const bootstrapToken=bearer(req),credential=`vne_${randomBytes(32).toString('base64url')}`;
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const token=(await client.query(`SELECT * FROM edge_bootstrap_tokens WHERE token_hash=$1 FOR UPDATE`,
   [digest(bootstrapToken)])).rows[0];
  if(!token||token.used_at||token.revoked_at||new Date(token.expires_at).getTime()<=Date.now())
   throw new ApiError(401,'bootstrap_token_invalid_or_used');
  if(token.protocol_version!==2||token.edge_id!==input.edgeId||
   token.organization_id.toLowerCase()!==input.tenantId.toLowerCase()||
   token.block_id.toLowerCase()!==input.blockId.toLowerCase()||
   token.site_code!==input.siteCode||token.edge_name!==input.edgeName)
   throw new ApiError(403,'bootstrap_binding_mismatch');
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[input.edgeId]);
  const occupied=await client.query('SELECT * FROM edge_nodes WHERE edge_id=$1 FOR UPDATE',[input.edgeId]);
  const draft=occupied.rows.find(n=>n.organization_id===token.organization_id&&n.block_id===token.block_id&&
   n.protocol_version===2&&n.registration_state==='PENDING_REGISTRATION'&&!n.archived_at);
  if(occupied.rowCount&&!draft)throw new ApiError(409,'edge_already_registered');
  const buildings=(await client.query(`SELECT building_id FROM edge_block_buildings
   WHERE block_id=$1 AND organization_id=$2 ORDER BY building_id`,[input.blockId,input.tenantId])).rows;
  if(!buildings.length)throw new ApiError(409,'edge_block_has_no_buildings');
  const node=draft?(await client.query(`UPDATE edge_nodes SET registration_state='REGISTERED',registered_at=now(),
   agent_version=$2,platform=$3,capabilities=$4,updated_at=now() WHERE id=$1
   RETURNING id,edge_id,organization_id,block_id,name,site_code,status`,
   [draft.id,input.agentVersion??null,input.platform??null,JSON.stringify(input.capabilities??{})])).rows[0]
   :(await client.query(`INSERT INTO edge_nodes
   (edge_id,organization_id,building_id,block_id,protocol_version,name,site_code,agent_version,platform,capabilities)
   VALUES($1,$2,NULL,$3,2,$4,$5,$6,$7,$8)
   RETURNING id,edge_id,organization_id,block_id,name,site_code,status`,
   [input.edgeId,token.organization_id,token.block_id,input.edgeName,token.site_code,
    input.agentVersion??null,input.platform??null,JSON.stringify(input.capabilities??{})])).rows[0];
  if(!draft)await client.query(`INSERT INTO edge_node_buildings(edge_node_id,organization_id,building_id,block_id)
   SELECT $1,$2,building_id,$3 FROM edge_block_buildings
   WHERE block_id=$3 AND organization_id=$2`,[node.id,node.organization_id,node.block_id]);
  await client.query(`INSERT INTO edge_credentials(edge_node_id,credential_hash,version) VALUES($1,$2,1)`,
   [node.id,digest(credential)]);
  await client.query(`UPDATE edge_bootstrap_tokens SET used_at=now(),used_by_edge_node_id=$2 WHERE id=$1`,
   [token.id,node.id]);
  await client.query(`INSERT INTO audit_events(organization_id,action,entity_type,entity_id,details)
   VALUES($1,'edge.register.v2','edge_node',$2,$3)`,[node.organization_id,node.id,
    JSON.stringify({edgeId:node.edge_id,blockId:node.block_id,buildingCount:buildings.length,version:input.agentVersion??null})]);
  const allowedBuildings=draft?(await client.query(`SELECT building_id FROM edge_node_buildings WHERE edge_node_id=$1 ORDER BY building_id`,[node.id])).rows:buildings;
  await client.query('COMMIT');
  res.status(201).json({protocolVersion:2,edgeId:node.edge_id,tenantId:node.organization_id,
   blockId:node.block_id,buildingIds:allowedBuildings.map((row:any)=>row.building_id),status:'REGISTERED',
   accessToken:credential,tokenType:'Bearer'});
 }catch(error){await client.query('ROLLBACK');throw error}
 finally{client.release()}
});

router.post('/heartbeat',machineAuth,async(req:EdgeV2Request,res)=>{
 const node=await authenticatedNode(req);
 const body=z.object({protocolVersion:z.literal(2),edgeId:edgeIdSchema,tenantId:uuid,blockId:uuid,
  timestamp:edgeTimestamp.optional(),status:z.string().max(40).optional(),
  agentVersion:z.string().trim().max(80).optional(),
  local:z.object({commandAuthorization:z.string().trim().max(40).optional(),
   queueDepth:z.number().int().min(0).max(100000).optional()}).optional(),
 }).strict().parse(req.body);
 verifyIdentity(req,node,body);
 const authStatus=body.local?.commandAuthorization??'UNKNOWN';
 await pool.query(`UPDATE edge_nodes SET status=CASE WHEN $2='OK' THEN 'ONLINE' ELSE 'DEGRADED' END,
  last_seen_at=now(),last_heartbeat_at=now(),agent_version=COALESCE($3,agent_version),local_authorization_status=$2,
  queue_depth=$4,updated_at=now() WHERE id=$1`,
 [node.id,authStatus,body.agentVersion??null,body.local?.queueDepth??0]);
 res.json({status:'ACCEPTED',serverTime:new Date().toISOString()});
});

router.post('/inventory',machineAuth,async(req:EdgeV2Request,res)=>{
 const node=await authenticatedNode(req);
 const body=z.object({protocolVersion:z.literal(2),edgeId:edgeIdSchema,tenantId:uuid,blockId:uuid,
  timestamp:edgeTimestamp.optional(),devices:z.array(z.object({buildingId:uuid,
   deviceId:z.string().trim().min(1).max(200),name:z.string().max(200).optional(),
   thingsboardId:z.string().max(200).nullable().optional(),
   profile:z.string().trim().min(1).max(100),label:z.string().max(200).nullable().optional(),
     active:z.boolean().nullable().optional(),gatewayAvailable:z.boolean().nullable().optional(),
     capabilities:z.array(z.string().trim().max(80)).max(30).optional()})).max(5000),
 }).strict().parse(req.body);
 verifyIdentity(req,node,body);
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  for(const device of body.devices){
   await assertBuilding(node,device.buildingId,client);
    const capabilities=reportedCapabilitiesForProfile(device.profile,device.capabilities);
    const enabledCapabilities=defaultEnabledCapabilitiesForProfile(device.profile);
   await client.query(`INSERT INTO edge_device_inventory
    (edge_node_id,organization_id,building_id,edge_device_id,thingsboard_id,name,profile,device_type,label,
      capabilities,enabled_capabilities,reported_online,last_seen_at,metadata,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NULL,NULL,
        CASE WHEN $12::boolean IS NULL AND $13::boolean IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('adapterMetadata',
         jsonb_strip_nulls(jsonb_build_object('thingsboardActive',$12::boolean,'gatewayAvailable',$13::boolean))) END,now())
    ON CONFLICT(edge_node_id,building_id,edge_device_id) DO UPDATE SET
     thingsboard_id=EXCLUDED.thingsboard_id,name=EXCLUDED.name,profile=EXCLUDED.profile,
     device_type=EXCLUDED.device_type,label=EXCLUDED.label,capabilities=EXCLUDED.capabilities,
      reported_online=NULL,
       metadata=CASE WHEN $12::boolean IS NULL AND $13::boolean IS NULL THEN COALESCE(edge_device_inventory.metadata,'{}'::jsonb)
       ELSE jsonb_set(COALESCE(edge_device_inventory.metadata,'{}'::jsonb),'{adapterMetadata}',
        (CASE WHEN jsonb_typeof(edge_device_inventory.metadata->'adapterMetadata')='object'
         THEN edge_device_inventory.metadata->'adapterMetadata' ELSE '{}'::jsonb END)
          ||jsonb_strip_nulls(jsonb_build_object('thingsboardActive',$12::boolean,'gatewayAvailable',$13::boolean)),true) END,updated_at=now()`,
   [node.id,node.organization_id,device.buildingId,device.deviceId,device.thingsboardId??null,
    device.name??device.deviceId,device.profile,deviceType(device.profile),device.label??null,
      JSON.stringify(capabilities),enabledCapabilities,device.active??null,device.gatewayAvailable??null]);
  }
  await client.query(`UPDATE edge_nodes SET last_seen_at=now(),last_inventory_at=now(),status='ONLINE',updated_at=now() WHERE id=$1`,[node.id]);
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error}
 finally{client.release()}
 res.json({status:'ACCEPTED',devices:body.devices.length});
});

router.post('/telemetry/batch',machineAuth,async(req:EdgeV2Request,res)=>{
 const node=await authenticatedNode(req),items=batchItems(req.body),client=await pool.connect();
 try{
  await client.query('BEGIN');
  for(const item of items){
   if(!item||typeof item.deviceId!=='string')throw new ApiError(400,'invalid_telemetry_item');
   const buildingId=uuid.parse(item.buildingId);
   const device=await requireDevice(node,buildingId,item.deviceId,client);
   const values=item.values&&typeof item.values==='object'&&!Array.isArray(item.values)?item.values:item;
   for(const [key,value] of Object.entries(values)){
    if(['deviceId','buildingId','timestamp','ts','time','edgeId','tenantId','blockId'].includes(key))continue;
    if(key.length>100||JSON.stringify(value).length>50000)throw new ApiError(400,'invalid_telemetry_value');
    await client.query(`INSERT INTO edge_telemetry_current(device_inventory_id,telemetry_key,value,source_timestamp,received_at)
     VALUES($1,$2,$3,$4,now()) ON CONFLICT(device_inventory_id,telemetry_key)
     DO UPDATE SET value=EXCLUDED.value,source_timestamp=EXCLUDED.source_timestamp,received_at=now()
     WHERE edge_telemetry_current.received_at<=now()`,
    [device,key,JSON.stringify(value),sourceTime(item.timestamp??item.ts)]);
   }
   await client.query('UPDATE edge_device_inventory SET last_telemetry_at=now(),last_seen_at=now() WHERE id=$1',[device]);
  }
  await client.query('UPDATE edge_nodes SET last_seen_at=now(),last_telemetry_at=now(),updated_at=now() WHERE id=$1',[node.id]);
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error}
 finally{client.release()}
 res.json({status:'ACCEPTED',items:items.length});
});

router.post('/events/batch',machineAuth,async(req:EdgeV2Request,res)=>{
 const node=await authenticatedNode(req),items=batchItems(req.body),client=await pool.connect();let inserted=0;
 try{
  await client.query('BEGIN');
  for(const item of items){
   if(!item||typeof item.deviceId!=='string')throw new ApiError(400,'invalid_edge_event');
   const buildingId=uuid.parse(item.buildingId),device=await requireDevice(node,buildingId,item.deviceId,client);
   const result=await client.query(`INSERT INTO edge_events
    (edge_node_id,device_inventory_id,organization_id,building_id,external_event_id,event_type,severity,source_timestamp,payload)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT(edge_node_id,building_id,external_event_id) WHERE external_event_id IS NOT NULL DO NOTHING`,
   [node.id,device,node.organization_id,buildingId,
    typeof item.eventId==='string'?item.eventId.slice(0,200):null,
    String(item.type??item.eventType??'edge.event').slice(0,100),
    typeof item.severity==='string'&&['info','warning','critical','emergency'].includes(item.severity)?item.severity:'info',
    sourceTime(item.timestamp??item.ts),JSON.stringify(item)]);
   inserted+=result.rowCount??0;
    if(result.rowCount)await client.query('UPDATE edge_device_inventory SET last_seen_at=now() WHERE id=$1',[device]);
  }
  await client.query('UPDATE edge_nodes SET last_seen_at=now(),last_event_at=now(),updated_at=now() WHERE id=$1',[node.id]);
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error}
 finally{client.release()}
 res.json({status:'ACCEPTED',received:items.length,inserted});
});

router.post('/alarms/batch',machineAuth,async(req:EdgeV2Request,res)=>{
 const node=await authenticatedNode(req),items=batchItems(req.body),client=await pool.connect();let inserted=0;
 try{
  await client.query('BEGIN');
  for(const item of items){
   if(!item||typeof item.deviceId!=='string'||typeof item.alarmId!=='string')throw new ApiError(400,'invalid_edge_alarm');
   const buildingId=uuid.parse(item.buildingId),device=await requireDevice(node,buildingId,item.deviceId,client);
   const result=await client.query(`INSERT INTO edge_alarms
    (edge_node_id,device_inventory_id,organization_id,building_id,external_alarm_id,alarm_type,severity,source_timestamp,payload)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(edge_node_id,building_id,external_alarm_id) DO NOTHING`,
   [node.id,device,node.organization_id,buildingId,item.alarmId.slice(0,200),
    String(item.type??'edge.alarm').slice(0,100),
    typeof item.severity==='string'&&['info','warning','critical','emergency'].includes(item.severity)?item.severity:'warning',
    sourceTime(item.timestamp??item.ts),JSON.stringify(item)]);
   inserted+=result.rowCount??0;
    if(result.rowCount)await client.query('UPDATE edge_device_inventory SET last_seen_at=now() WHERE id=$1',[device]);
  }
  await client.query('UPDATE edge_nodes SET last_seen_at=now(),last_alarm_at=now(),updated_at=now() WHERE id=$1',[node.id]);
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error}
 finally{client.release()}
 res.json({status:'ACCEPTED',received:items.length,inserted});
});

router.get('/config',machineAuth,async(req:EdgeV2Request,res)=>{
 const node=await authenticatedNode(req);
 if(req.query.edgeId!==node.edge_id)throw new ApiError(403,'edge_identity_mismatch');
 const row=(await pool.query(`SELECT config_version AS "configVersion",capabilities,management_config,
  organization_id AS "tenantId",block_id AS "blockId" FROM edge_nodes WHERE id=$1`,[node.id])).rows[0];
 const buildingIds=(await pool.query(`SELECT building_id FROM edge_node_buildings
  WHERE edge_node_id=$1 ORDER BY building_id`,[node.id])).rows.map(r=>r.building_id);
 res.json({protocolVersion:2,edgeId:node.edge_id,...row,buildingIds,
  heartbeatIntervalSeconds:row.management_config.heartbeatSeconds,inventoryIntervalSeconds:row.management_config.inventorySeconds,
  telemetryBatchIntervalSeconds:row.management_config.telemetrySeconds,
  endpoints:{heartbeat:'/api/edge/v2/heartbeat',inventory:'/api/edge/v2/inventory',
   telemetry:'/api/edge/v2/telemetry/batch',events:'/api/edge/v2/events/batch',
   alarms:'/api/edge/v2/alarms/batch',websocket:'/api/edge/v2/connect'}});
});

router.post('/commands/:commandId/result',machineAuth,async(req:EdgeV2Request,res)=>{
 const node=await authenticatedNode(req);
 const body=z.object({protocolVersion:z.literal(2),edgeId:edgeIdSchema,tenantId:uuid,blockId:uuid,
  commandId:uuid,buildingId:uuid.optional(),result:z.unknown().optional(),status:z.string().optional(),timestamp:edgeTimestamp.optional(),
 }).passthrough().parse(req.body);
 verifyIdentity(req,node,body);
 if(body.buildingId)await assertBuilding(node,body.buildingId);
 const result=await recordEdgeCommandResult(node.id,body);
 res.json(result);
});

export const edgeMachineApiV2=router;
