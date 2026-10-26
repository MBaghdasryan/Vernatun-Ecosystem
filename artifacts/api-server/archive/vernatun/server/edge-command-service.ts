import {createHash,randomUUID} from 'node:crypto';
import type {Request} from 'express';
import {pool} from './db.js';
import type {Context} from './access.js';
import {ApiError} from './access.js';
import {permissionDecision} from './iam-evaluator.js';
import {isEdgeConnected,sendEdgeMessage} from './edge-sockets.js';
import {getDeviceActionDefinition,getDeviceActionProfile} from '@workspace/api-zod';
import {deviceHealth,edgeThresholds,edgeTransportOnline} from './edge-management-policy.js';

const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hardDenied=new Set(['FIRE.CONTROL','ELEVATOR.SAFETY_CONTROL']);
const residentRoles=new Set(['unit_owner','renter']);
const buildingControlRoles=new Set(['platform_admin','org_admin','manager','dispatcher','security']);
const permissionFor=(capability:string,role:string)=>{
 if(capability==='BARRIER.OPEN')return residentRoles.has(role)?'device.barrier.open.own':'device.barrier.open.building';
 if(capability==='BARRIER.CLOSE')return 'device.barrier.close.building';
 return getDeviceActionDefinition(capability)?.permission??null;
};
type CommandInput={buildingId:string;deviceId:string;capability:string;reason:string;idempotencyKey?:string};

const scalar=(value:any):string=>{
 if(typeof value==='string')return value.toUpperCase();
 if(value&&typeof value==='object'){
  const nested=value.state??value.status??value.value;
  if(nested!==undefined)return scalar(nested);
 }
 return String(value??'').toUpperCase();
};
async function deviceTelemetryState(db:any,deviceId:string){
 const result=await db.query(`SELECT telemetry_key,value FROM edge_telemetry_current
  WHERE device_inventory_id=$1 AND lower(telemetry_key) IN ('state','status','fault','online')`,
 [deviceId]);
 return Object.fromEntries(result.rows.map((row:any)=>[String(row.telemetry_key).toLowerCase(),row.value]));
}

async function deviceHealthActivity(db:any,device:any){
 const activity=await db.query(`SELECT
  (SELECT max(received_at) FROM edge_events WHERE device_inventory_id=$1) AS last_event_at,
  (SELECT max(received_at) FROM edge_alarms WHERE device_inventory_id=$1) AS last_alarm_at`,[device.device_inventory_id??device.id]);
 const telemetry=await db.query(`SELECT value FROM edge_telemetry_current
  WHERE device_inventory_id=$1 AND lower(telemetry_key)='online' LIMIT 1`,[device.device_inventory_id??device.id]);
 return {lastTelemetryAt:device.last_telemetry_at,lastEventAt:activity.rows[0]?.last_event_at,
  lastAlarmAt:activity.rows[0]?.last_alarm_at,explicitOnline:telemetry.rows[0]?.value,
  gatewayAvailable:device.metadata?.adapterMetadata?.gatewayAvailable};
}

async function policyReason(db:any,c:Context,device:any,capability:string,permissionResult:{allowed:boolean;reason:string},telemetry:Record<string,any>){
 if(hardDenied.has(capability))return 'safety_capability_hard_denied';
 const action=getDeviceActionProfile(device.profile)?.actions.find(item=>item.capability===capability);
 if(!action?.adapterVerified)return 'adapter_not_verified';
 if(!Array.isArray(device.capabilities)||!device.capabilities.includes(capability))return 'device_capability_not_reported';
 if(!Array.isArray(device.enabled_capabilities)||!device.enabled_capabilities.includes(capability))return 'capability_disabled_by_policy';
 if(residentRoles.has(c.role_key)){
  if(capability!=='BARRIER.OPEN')return 'operational_role_required';
  if(!c.unit_id)return 'unit_device_access_missing';
  const access=await db.query(`SELECT 1 FROM edge_device_access WHERE device_id=$1
   AND organization_id=$2 AND building_id=$3 AND unit_id=$4 AND $5=ANY(allowed_capabilities)`,
  [device.device_inventory_id,c.organization_id,device.building_id,c.unit_id,capability]);
  if(!access.rowCount)return 'unit_device_access_missing';
 }else if(!buildingControlRoles.has(c.role_key)||!c.permissions.includes('edge.commands.execute')){
  return 'command_execution_permission_required';
 }
 if(!permissionResult.allowed)return permissionResult.reason;
 const state=scalar(telemetry.state??telemetry.status),fault=scalar(telemetry.fault);
 if(fault&&!['FALSE','0','NORMAL','OK'].includes(fault))return 'device_fault';
 if(action.blocksWhenState?.includes(state))return state===action.targetState?'device_already_in_target_state':'device_transition_in_progress';
 return null;
}

async function connectionReason(db:any,device:any){
 if(!edgeTransportOnline(device,isEdgeConnected(device.edge_node_id)))return 'edge_offline';
 if(device.local_authorization_status!=='OK')return 'edge_local_authorization_unavailable';
 const activity=await deviceHealthActivity(db,device);
 const health=deviceHealth({edgeOnline:true,...activity},edgeThresholds(device));
 if(health.healthStatus==='OFFLINE')return 'device_offline';
 if(health.healthStatus==='STALE')return 'device_health_stale';
 if(health.healthStatus==='UNKNOWN')return 'device_health_unknown';
 return null;
}

export async function availableDeviceActions(c:Context,deviceId:string,buildingId:string){
 if(c.building_id&&c.building_id!==buildingId)throw new ApiError(404,'device_not_found');
 if(!c.organization_id&&c.role_key!=='platform_admin')throw new ApiError(403,'organization_scope_required');
 const target=await pool.query(`SELECT d.*,d.id AS device_inventory_id,n.status,n.registration_state,n.last_heartbeat_at,
  n.last_inventory_at,n.last_telemetry_at AS node_last_telemetry_at,n.local_authorization_status,n.queue_depth,
  n.management_config,n.archived_at,
  EXISTS(SELECT 1 FROM edge_credentials ec WHERE ec.edge_node_id=n.id AND ec.status='active' AND ec.revoked_at IS NULL) AS credential_active
  FROM edge_device_inventory d JOIN edge_nodes n ON n.id=d.edge_node_id WHERE d.id=$1
  AND d.building_id=$2 AND ($3::uuid IS NULL OR d.organization_id=$3)`,
 [deviceId,buildingId,c.organization_id]);
 if(!target.rowCount)throw new ApiError(404,'device_not_found');
 const device=target.rows[0],profile=getDeviceActionProfile(device.profile);
 const scopedContext={...c,organization_id:device.organization_id};
 if(['unit_owner','renter','family'].includes(c.role_key)){
  const access=await pool.query('SELECT 1 FROM edge_device_access WHERE device_id=$1 AND unit_id=$2',[device.id,c.unit_id]);
  if(!access.rowCount)throw new ApiError(404,'device_not_found');
 }
  const telemetry=await deviceTelemetryState(pool,device.id),offline=await connectionReason(pool,device);
 const inFlight=await pool.query(`SELECT 1 FROM edge_commands WHERE device_inventory_id=$1
  AND status IN ('REQUESTED','AUTHORIZED','QUEUED','DELIVERED','ACKNOWLEDGED') AND expires_at>now()`,[device.id]);
 const actions=await Promise.all((profile?.actions??[]).map(async action=>{
  const permission=permissionFor(action.capability,c.role_key);
  const permissionResult=permission?await permissionDecision(scopedContext,permission,'POST'):{allowed:false,reason:'capability_not_supported'};
  const reason=await policyReason(pool,scopedContext,device,action.capability,permissionResult,telemetry)
   ??(inFlight.rowCount?'device_command_in_progress':null)??offline;
  return {capability:action.capability,labelKey:action.labelKey,enabled:reason===null,reason,
   confirmation:action.confirmation,adapterVerified:action.adapterVerified};
 }));
 return {deviceId:device.id,online:offline===null,state:scalar(telemetry.state??telemetry.status)||null,actions,
  safetyLocked:profile?.hardDenied??[]};
}

export async function requestEdgeCommand(req:Request,context:Context,input:CommandInput){
 if(!req.user)throw new ApiError(401,'unauthenticated');
 if(!context.organization_id){
  if(context.role_key!=='platform_admin'||!context.permissions.includes('edge.commands.execute'))throw new ApiError(403,'command_execution_permission_required');
  const target=await pool.query('SELECT organization_id FROM edge_device_inventory WHERE id=$1 AND building_id=$2',[input.deviceId,input.buildingId]);
  if(!target.rowCount)throw new ApiError(404,'device_not_found');
  context={...context,organization_id:target.rows[0].organization_id};
 }
 if(context.building_id&&context.building_id!==input.buildingId)throw new ApiError(404,'device_not_found');
 const key=input.idempotencyKey?.trim()||randomUUID();
 if(key.length>160)throw new ApiError(400,'invalid_idempotency_key');
 const requestHash=digest({buildingId:input.buildingId,deviceId:input.deviceId,capability:input.capability,reason:input.reason});
 const permission=permissionFor(input.capability,context.role_key);
 const permissionResult=permission?await permissionDecision(context,permission,'POST'):{allowed:false,reason:'capability_not_supported'};
 const client=await pool.connect();
 let created:any,dispatch:{nodeId:string;command:any}|undefined;
 try{
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[req.user.id+key]);
   const previous=await client.query(`SELECT command_id,status,capability,authorization_decision,authorization_reason,
    organization_id,requested_role_assignment_id,
   requested_at,expires_at,error_code,request_hash FROM edge_commands
   WHERE requested_by_user_id=$1 AND idempotency_key=$2`,[req.user.id,key]);
  if(previous.rowCount){
    if(previous.rows[0].organization_id!==context.organization_id||previous.rows[0].requested_role_assignment_id!==context.id)
     throw new ApiError(409,'idempotency_scope_conflict');
   if(previous.rows[0].request_hash!==requestHash)throw new ApiError(409,'idempotency_conflict');
    created={...previous.rows[0],idempotent:true};
    await client.query('COMMIT');
   }else{
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['edge-device:'+input.deviceId]);
     const target=await client.query(`SELECT d.id AS device_inventory_id,d.edge_node_id,d.edge_device_id,d.thingsboard_id,d.metadata,
     d.capabilities,d.enabled_capabilities,d.device_type,d.profile,d.unit_id,d.reported_online,d.last_telemetry_at,
     n.organization_id,d.building_id,n.building_id AS node_building_id,n.status,n.registration_state,n.name AS edge_name,
     n.block_id,n.protocol_version,n.last_heartbeat_at,n.last_inventory_at,n.last_telemetry_at AS node_last_telemetry_at,
     n.local_authorization_status,n.queue_depth,n.management_config,n.archived_at,
     EXISTS(SELECT 1 FROM edge_credentials ec WHERE ec.edge_node_id=n.id AND ec.status='active'
       AND ec.revoked_at IS NULL) AS credential_active
    FROM edge_device_inventory d JOIN edge_nodes n ON n.id=d.edge_node_id
    WHERE d.id=$1 AND d.organization_id=$2 AND d.building_id=$3
    FOR SHARE OF d,n`,[input.deviceId,context.organization_id,input.buildingId]);
   if(!target.rowCount)throw new ApiError(404,'device_not_found');
   const device=target.rows[0];
    const telemetry=await deviceTelemetryState(client,device.device_inventory_id);
    await client.query(`UPDATE edge_commands SET status='TIMEOUT',error_code='command_expired',completed_at=now(),updated_at=now()
     WHERE device_inventory_id=$1 AND expires_at<=now() AND status IN ('REQUESTED','AUTHORIZED','QUEUED','DELIVERED','ACKNOWLEDGED')`,
    [device.device_inventory_id]);
    const inFlight=await client.query(`SELECT 1 FROM edge_commands WHERE device_inventory_id=$1
     AND status IN ('REQUESTED','AUTHORIZED','QUEUED','DELIVERED','ACKNOWLEDGED') AND expires_at>now()`,
    [device.device_inventory_id]);
    const rejection=await policyReason(client,context,device,input.capability,permissionResult,telemetry)
     ??(inFlight.rowCount?'device_command_in_progress':null);
    const decision=rejection?'DENY':'ALLOW',decisionReason=rejection??'role_scope_and_device_policy_verified';
     const offlineReason=await connectionReason(client,device);
    const online=offlineReason===null;
   const commandId=randomUUID(),expiresAt=new Date(Date.now()+30_000).toISOString();
   const denied=decision!=='ALLOW',offline=decision==='ALLOW'&&!online;
   const status=denied?'DENIED':offline?'FAILED':'QUEUED';
    const reason=denied?decisionReason:offline?offlineReason:decisionReason;
   const actorClaim={userId:req.user.id,roleKey:context.role_key,roleAssignmentId:context.id,
    organizationId:context.organization_id,buildingId:input.buildingId,unitId:context.unit_id,
    permission:permission??null};
   const sourceProduct=['unit_owner','renter','family'].includes(context.role_key)?'imtun':
    ['technician','contractor','security','dispatcher'].includes(context.role_key)?'hayat':
    context.role_key==='platform_admin'?'console':'vernatun_os';
   const row=await client.query(`INSERT INTO edge_commands
    (command_id,idempotency_key,request_hash,edge_node_id,device_inventory_id,organization_id,building_id,
     edge_device_id,capability,requested_by_user_id,requested_role_assignment_id,requested_role,source_product,
     reason,status,authorization_decision,authorization_reason,actor_claim,source_context,expires_at,
     error_code,failed_at,completed_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
     CASE WHEN $15='FAILED' THEN now() END,CASE WHEN $15='DENIED' THEN now() END)
     RETURNING command_id,status,capability,authorization_decision,authorization_reason,requested_at,expires_at,error_code`,
   [commandId,key,requestHash,device.edge_node_id,device.device_inventory_id,context.organization_id,
    input.buildingId,device.edge_device_id,input.capability,req.user.id,context.id,context.role_key,
    sourceProduct,input.reason,status,decision,reason,JSON.stringify(actorClaim),
    JSON.stringify({edgeName:device.edge_name,deviceType:device.device_type}),expiresAt,
     offline?offlineReason:denied?'authorization_denied':null]);
   created={...row.rows[0],idempotent:false};
   await client.query(`INSERT INTO audit_events(organization_id,actor_user_id,action,entity_type,entity_id,details)
    VALUES($1,$2,$3,'edge_command',$4,$5)`,[context.organization_id,req.user.id,
    denied?'edge.command.denied':offline?'edge.command.offline':'edge.command.requested',commandId,
    JSON.stringify({capability:input.capability,deviceInventoryId:device.device_inventory_id,
     buildingId:input.buildingId,role:context.role_key,decisionReason:reason})]);
   await client.query('COMMIT');
   if(!denied&&!offline){
     dispatch={nodeId:device.edge_node_id,command:{
     commandId,idempotencyKey:key,tenantId:context.organization_id,
     ...(device.protocol_version===2?{protocolVersion:2,blockId:device.block_id}:{}),
     buildingId:input.buildingId,
     deviceId:device.thingsboard_id??device.edge_device_id,edgeDeviceId:device.edge_device_id,
     capability:input.capability,reason,source:sourceProduct,actor:actorClaim,expiresAt
     }};
    }
   }
  }catch(error){await client.query('ROLLBACK');throw error}
  finally{client.release()}
  if(dispatch){
     const sent=Date.now()<new Date(created.expires_at).getTime()&&sendEdgeMessage(dispatch.nodeId,{type:'COMMAND',command:dispatch.command});
    if(sent){
     await pool.query(`UPDATE edge_commands SET status='DELIVERED',delivered_at=now(),updated_at=now()
       WHERE command_id=$1 AND status='QUEUED'`,[created.command_id]);
     created.status='DELIVERED';
    }else{
     await pool.query(`UPDATE edge_commands SET status='FAILED',error_code='edge_offline',
      error_message='Edge disconnected before delivery',failed_at=now(),updated_at=now()
       WHERE command_id=$1 AND status='QUEUED'`,[created.command_id]);
     created.status='FAILED';created.error_code='edge_offline';
    }
  }
  const httpStatus=created.status==='DENIED'?403:created.status==='FAILED'?409:202;
  return {httpStatus,command:{commandId:created.command_id,status:created.status,capability:created.capability,
  authorizationDecision:created.authorization_decision,authorizationReason:created.authorization_reason,
  requestedAt:created.requested_at,expiresAt:created.expires_at,errorCode:created.error_code??null,
  idempotent:created.idempotent}};
}
