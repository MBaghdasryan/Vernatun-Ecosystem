import {createHash,randomUUID} from 'node:crypto';
import type {Request} from 'express';
import {pool} from './db.js';
import type {Context} from './access.js';
import {ApiError} from './access.js';
import {permissionDecision} from './iam-evaluator.js';
import {isEdgeConnected,sendEdgeMessage} from './edge-sockets.js';

const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hardDenied=new Set(['FIRE.CONTROL','ELEVATOR.SAFETY_CONTROL']);
const permissionFor=(capability:string)=>{
 if(capability==='BARRIER.OPEN')return 'device.barrier.open.own';
 if(capability==='BARRIER.CLOSE')return 'device.barrier.close.building';
 return null;
};
type CommandInput={buildingId:string;deviceId:string;capability:string;reason:string;idempotencyKey?:string};

export async function requestEdgeCommand(req:Request,context:Context,input:CommandInput){
 if(!req.user)throw new ApiError(401,'unauthenticated');
 if(context.organization_id===null||context.organization_id==='')throw new ApiError(403,'organization_scope_required');
 if(context.building_id&&context.building_id!==input.buildingId)throw new ApiError(404,'device_not_found');
 const key=input.idempotencyKey?.trim()||randomUUID();
 if(key.length>160)throw new ApiError(400,'invalid_idempotency_key');
 const requestHash=digest({buildingId:input.buildingId,deviceId:input.deviceId,capability:input.capability,reason:input.reason});
 const client=await pool.connect();
 let created:any;
 try{
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[req.user.id+key]);
  const previous=await client.query(`SELECT command_id,status,authorization_decision,authorization_reason,
   requested_at,expires_at,error_code,request_hash FROM edge_commands
   WHERE requested_by_user_id=$1 AND idempotency_key=$2`,[req.user.id,key]);
  if(previous.rowCount){
   if(previous.rows[0].request_hash!==requestHash)throw new ApiError(409,'idempotency_conflict');
   created={...previous.rows[0],idempotent:true};
   await client.query('COMMIT');
  }else{
   const target=await client.query(`SELECT d.id AS device_inventory_id,d.edge_node_id,d.edge_device_id,d.thingsboard_id,
    d.capabilities,d.device_type,d.unit_id,n.organization_id,n.building_id,n.status AS edge_status,
    n.registration_state,n.name AS edge_name,n.block_id,n.protocol_version
    FROM edge_device_inventory d JOIN edge_nodes n ON n.id=d.edge_node_id
    WHERE d.id=$1 AND d.organization_id=$2 AND d.building_id=$3
     AND d.reported_online IS DISTINCT FROM false
    FOR SHARE OF d,n`,[input.deviceId,context.organization_id,input.buildingId]);
   if(!target.rowCount)throw new ApiError(404,'device_not_found');
   const device=target.rows[0];
   let decision='DENY',decisionReason='capability_not_supported';
   let permission=permissionFor(input.capability);
   if(hardDenied.has(input.capability)){permission=null;decisionReason='safety_capability_hard_denied'}
   else if(input.capability==='BARRIER.OPEN'&&context.role_key!=='unit_owner'&&context.role_key!=='renter'){
    decisionReason='resident_role_required';
   }else if(input.capability==='BARRIER.CLOSE'&&!['manager','security'].includes(context.role_key)){
    decisionReason='operational_role_required';
   }else if(!permission){
    decisionReason='capability_not_supported';
   }else if(!(device.capabilities as unknown[]).includes(input.capability)){
    decisionReason='device_capability_not_reported';
   }else if(context.role_key==='unit_owner'||context.role_key==='renter'){
    const access=await client.query(`SELECT 1 FROM edge_device_access
     WHERE device_id=$1 AND organization_id=$2 AND building_id=$3 AND unit_id=$4
      AND $5=ANY(allowed_capabilities)`,[device.device_inventory_id,context.organization_id,
      input.buildingId,context.unit_id,input.capability]);
    if(!context.unit_id||!access.rowCount)decisionReason='unit_device_access_missing';
    else{
     const permissionResult=await permissionDecision(context,permission,'POST');
     if(permissionResult.allowed){decision='ALLOW';decisionReason='role_scope_and_device_access_verified'}
     else decisionReason=permissionResult.reason;
    }
   }else{
    const permissionResult=await permissionDecision(context,permission,'POST');
    if(permissionResult.allowed){decision='ALLOW';decisionReason='role_scope_verified'}
    else decisionReason=permissionResult.reason;
   }
   const online=device.edge_status!=='DISABLED'&&device.registration_state==='REGISTERED'&&isEdgeConnected(device.edge_node_id);
   const commandId=randomUUID(),expiresAt=new Date(Date.now()+30_000).toISOString();
   const denied=decision!=='ALLOW',offline=decision==='ALLOW'&&!online;
   const status=denied?'DENIED':offline?'FAILED':'QUEUED';
   const reason=denied?decisionReason:offline?'edge_offline':decisionReason;
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
    RETURNING command_id,status,authorization_decision,authorization_reason,requested_at,expires_at,error_code`,
   [commandId,key,requestHash,device.edge_node_id,device.device_inventory_id,context.organization_id,
    input.buildingId,device.edge_device_id,input.capability,req.user.id,context.id,context.role_key,
    sourceProduct,input.reason,status,decision,reason,JSON.stringify(actorClaim),
    JSON.stringify({edgeName:device.edge_name,deviceType:device.device_type}),expiresAt,
    offline?'edge_offline':denied?'authorization_denied':null]);
   created={...row.rows[0],idempotent:false};
   await client.query(`INSERT INTO audit_events(organization_id,actor_user_id,action,entity_type,entity_id,details)
    VALUES($1,$2,$3,'edge_command',$4,$5)`,[context.organization_id,req.user.id,
    denied?'edge.command.denied':offline?'edge.command.offline':'edge.command.requested',commandId,
    JSON.stringify({capability:input.capability,deviceInventoryId:device.device_inventory_id,
     buildingId:input.buildingId,role:context.role_key,decisionReason:reason})]);
   await client.query('COMMIT');
   if(!denied&&!offline){
    const sent=sendEdgeMessage(device.edge_node_id,{type:'COMMAND',command:{
     commandId,idempotencyKey:key,tenantId:context.organization_id,
     ...(device.protocol_version===2?{protocolVersion:2,blockId:device.block_id}:{}),
     buildingId:input.buildingId,
     deviceId:device.thingsboard_id??device.edge_device_id,edgeDeviceId:device.edge_device_id,
     capability:input.capability,reason,source:sourceProduct,actor:actorClaim,expiresAt
    }});
    if(sent){
     await pool.query(`UPDATE edge_commands SET status='DELIVERED',delivered_at=now(),updated_at=now()
      WHERE command_id=$1 AND status='QUEUED'`,[commandId]);
     created.status='DELIVERED';
    }else{
     await pool.query(`UPDATE edge_commands SET status='FAILED',error_code='edge_offline',
      error_message='Edge disconnected before delivery',failed_at=now(),updated_at=now()
      WHERE command_id=$1 AND status='QUEUED'`,[commandId]);
     created.status='FAILED';created.error_code='edge_offline';
    }
   }
  }
 }catch(error){await client.query('ROLLBACK');throw error}
 finally{client.release()}
 const httpStatus=created.status==='DENIED'?403:created.status==='FAILED'?409:202;
 return {httpStatus,command:{commandId:created.command_id,status:created.status,
  authorizationDecision:created.authorization_decision,authorizationReason:created.authorization_reason,
  requestedAt:created.requested_at,expiresAt:created.expires_at,errorCode:created.error_code??null,
  idempotent:created.idempotent}};
}
