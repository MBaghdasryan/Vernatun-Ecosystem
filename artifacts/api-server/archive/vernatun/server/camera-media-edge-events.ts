import {pool} from './db.js';
import {cameraMediaGateway} from './camera-media-gateway.js';

const failureCode=/^[a-z][a-z0-9_]{1,63}$/;

export async function handleCameraMediaEdgeMessage(edgeNodeId:string,message:any){
 const type=String(message?.type??'').toUpperCase();
 if(type==='MEDIA_CAPABILITIES'){
  const version=Number(message.protocolVersion);
  const cameraDeviceIds=Array.isArray(message.cameraDeviceIds)
   ?[...new Set(message.cameraDeviceIds.filter((id:unknown)=>typeof id==='string'&&id.length>0&&id.length<=200))].slice(0,100)
   :[];
  const snapshotDeviceIds=Array.isArray(message.snapshotDeviceIds)
   ?[...new Set(message.snapshotDeviceIds.filter((id:unknown)=>typeof id==='string'&&id.length>0&&id.length<=200))].slice(0,100)
   :[];
  const cameraPublisher=message.cameraPublisher===true&&cameraDeviceIds.length>0;
  const livekitProvider=message.provider==='livekit';
  const capabilities={cameraPublisher,livekitProvider,cameraDeviceIds,snapshotDeviceIds,rtspGateway:message.rtspGateway===true};
  if(!Number.isInteger(version)||version<0||version>10)throw new Error('invalid_media_capabilities');
  await pool.query(`UPDATE edge_nodes SET media_protocol_version=$2,media_capabilities=$3::jsonb,
   media_capabilities_at=now(),last_seen_at=now(),updated_at=now() WHERE id=$1`,
  [edgeNodeId,version,JSON.stringify(capabilities)]);
  return true;
 }
 if(type!=='MEDIA_SESSION_STATE')return false;
 const sessionId=String(message.sessionId??'');
 const reported=String(message.state??'').toUpperCase();
  if(!/^[0-9a-f-]{36}$/i.test(sessionId)||!['STARTING','ACTIVE','LIVE','FAILED','STOPPING','ENDED'].includes(reported))
  throw new Error('invalid_media_session_state');
 const row=(await pool.query(`SELECT s.id,s.room_name,s.edge_participant_identity,s.state,d.edge_device_id
  FROM edge_camera_media_sessions s JOIN edge_device_inventory d ON d.id=s.camera_id
  WHERE s.id=$1 AND s.edge_node_id=$2 AND s.state IN ('STARTING','ACTIVE','STOPPING')`,[sessionId,edgeNodeId])).rows[0];
 if(!row)return true;
 if(message.deviceId&&message.deviceId!==row.edge_device_id)throw new Error('media_device_scope_mismatch');
  if(reported==='ACTIVE'||reported==='LIVE'){
  // Edge's status message is not sufficient proof of a media stream. The
  // Cloud must also observe the authorized publisher's actual video track.
  const hasTrack=await cameraMediaGateway.hasVideoPublisher(row.room_name,row.edge_participant_identity);
  if(hasTrack)await pool.query(`UPDATE edge_camera_media_sessions SET state='ACTIVE',
   started_at=COALESCE(started_at,now()),last_activity_at=now(),failure_code=NULL
   WHERE id=$1 AND state IN ('STARTING','ACTIVE')`,[row.id]);
 }else if(reported==='FAILED'){
  const code=String(message.failureCode??message.errorCode??'edge_media_failed');
  await pool.query(`UPDATE edge_camera_media_sessions SET state='FAILED',failure_code=$2,
   ended_at=COALESCE(ended_at,now()),last_activity_at=now() WHERE id=$1`,[row.id,failureCode.test(code)?code:'edge_media_failed']);
  if(cameraMediaGateway.configured)await cameraMediaGateway.deleteRoom(row.room_name).catch(()=>{});
 }else if(reported==='ENDED'){
  await pool.query(`UPDATE edge_camera_media_sessions SET state='ENDED',ended_at=COALESCE(ended_at,now()),
   last_activity_at=now() WHERE id=$1`,[row.id]);
  if(cameraMediaGateway.configured)await cameraMediaGateway.deleteRoom(row.room_name).catch(()=>{});
 }else if(reported==='STOPPING'){
  await pool.query(`UPDATE edge_camera_media_sessions SET state='STOPPING',last_activity_at=now() WHERE id=$1`,[row.id]);
 }
 return true;
}

export async function markCameraMediaNodeOffline(edgeNodeId:string){
 const sessions=(await pool.query(`UPDATE edge_camera_media_sessions SET state='FAILED',
  failure_code='edge_disconnected',ended_at=COALESCE(ended_at,now()),last_activity_at=now()
  WHERE edge_node_id=$1 AND state IN ('STARTING','ACTIVE','STOPPING')
  RETURNING room_name`,[edgeNodeId])).rows;
 if(cameraMediaGateway.configured){
  await Promise.all(sessions.map((session:any)=>cameraMediaGateway.deleteRoom(session.room_name).catch(()=>{})));
 }
}
