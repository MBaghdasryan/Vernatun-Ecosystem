import express,{type Request} from 'express';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {context,requirePermission,ApiError,type Context} from './access.js';
import {pool} from './db.js';
import {record,transaction} from './operations.js';
import {logger} from '../../../src/lib/logger.js';
import {isEdgeConnected,sendEdgeMessage} from './edge-sockets.js';
import {cameraMediaGateway} from './camera-media-gateway.js';
import type {MediaViewerToken} from './camera-media-gateway.js';

export const cameraMedia=express.Router();
const uuid=z.string().uuid();

type CameraRow={
 id:string;name:string;edge_device_id:string;building_id:string;building_name:string;zone:string|null;edge_id:string;
 edge_node_id:string;edge_status:string;edge_connected:boolean;media_protocol_version:number;
 media_capabilities:Record<string,unknown>;reported_online:boolean|null;last_seen_at:string;
 last_telemetry_at:string|null;telemetry:Record<string,unknown>;
};

function asBoolean(value:unknown):boolean|null{
 if(typeof value==='boolean')return value;
 if(typeof value==='number')return value!==0;
 if(typeof value==='string'){
  const v=value.trim().toLowerCase();
  if(['true','1','yes','online','open'].includes(v))return true;
  if(['false','0','no','offline','closed'].includes(v))return false;
 }
 return null;
}
function fromJson(value:unknown){
 if(value&&typeof value==='object'&&'value'in value)return (value as {value:unknown}).value;
 return value;
}
function cameraTelemetry(value:Record<string,unknown>){
 const get=(key:string)=>fromJson(value[key]);
 const fps=Number(get('fps'));
 const resolution=get('resolution');
 return {
  online:asBoolean(get('online')),
  cameraOpen:asBoolean(get('camera_open')),
  videoLoss:asBoolean(get('video_loss')),
  tamper:asBoolean(get('tamper')),
  fps:Number.isFinite(fps)&&fps>=0?fps:null,
  resolution:typeof resolution==='string'&&/^\d{2,5}x\d{2,5}$/i.test(resolution)?resolution:null,
 };
}
function streamState(row:CameraRow){
 const telemetry=cameraTelemetry(row.telemetry);
 const deviceOnline=telemetry.online??row.reported_online;
 const fresh=!!row.last_telemetry_at&&Date.now()-new Date(row.last_telemetry_at).getTime()<120_000;
 if(!cameraMediaGateway.configured)return {available:false,state:'NOT_CONFIGURED' as const,reason:'media_provider_not_configured'};
 if(!row.edge_connected)return {available:false,state:'EDGE_OFFLINE' as const,reason:'edge_offline'};
  if(deviceOnline===false)return {available:false,state:'CAMERA_OFFLINE' as const,reason:'camera_offline'};
  if(deviceOnline!==true)return {available:false,state:'VIDEO_UNAVAILABLE' as const,reason:'camera_status_unknown'};
 if(!fresh||telemetry.videoLoss===true)return {available:false,state:'VIDEO_UNAVAILABLE' as const,reason:telemetry.videoLoss?'video_loss':'camera_telemetry_stale'};
 const capable=row.media_protocol_version>=1&&row.media_capabilities.cameraPublisher===true&&row.media_capabilities.livekitProvider===true;
 if(!capable)return {available:false,state:'VIDEO_UNAVAILABLE' as const,reason:'edge_media_agent_not_ready'};
 return {available:true,state:'READY' as const,reason:'ready_to_start'};
}
async function cameraRows(c:Context,id?:string){
 if(!c.organization_id)throw new ApiError(403,'organization_required');
 const rows=(await pool.query(`SELECT d.id,d.name,d.edge_device_id,d.building_id,b.name AS building_name,
  COALESCE(d.metadata->>'zone',d.metadata->>'zoneName') AS zone,n.edge_id,n.id AS edge_node_id,
  n.status AS edge_status,n.media_protocol_version,n.media_capabilities,n.last_seen_at,
  d.reported_online,d.last_seen_at AS device_last_seen_at,d.last_telemetry_at,
  COALESCE((SELECT jsonb_object_agg(lower(t.telemetry_key),t.value) FROM edge_telemetry_current t
    WHERE t.device_inventory_id=d.id AND lower(t.telemetry_key) IN
     ('online','camera_open','video_loss','tamper','fps','resolution')),'{}'::jsonb) AS telemetry
 FROM edge_device_inventory d
 JOIN edge_nodes n ON n.id=d.edge_node_id
 JOIN buildings b ON b.id=d.building_id AND b.organization_id=d.organization_id
 WHERE d.organization_id=$1
  AND ($2::uuid IS NULL OR d.building_id=$2)
  AND ($3::uuid IS NULL OR d.unit_id=$3)
  AND (lower(d.device_type) LIKE '%camera%' OR lower(d.profile) LIKE '%camera%')
  AND ($4::uuid IS NULL OR d.id=$4)
 ORDER BY b.name,d.name LIMIT 300`,[c.organization_id,c.building_id,c.unit_id,id??null])).rows;
 return rows.map((row:any)=>({...row,edge_connected:isEdgeConnected(row.edge_node_id)})) as CameraRow[];
}
async function authorizedCamera(req:Request,id:string,permission='device.camera.live_view'){
 const c=await requirePermission(req,permission);
 if(!c.organization_id)throw new ApiError(403,'organization_required');
 const row=(await cameraRows(c,id))[0];
 if(!row)throw new ApiError(404,'not_found');
 return {c,row};
}
function cameraSummary(row:CameraRow){
 const telemetry=cameraTelemetry(row.telemetry);
 const deviceOnline=telemetry.online??row.reported_online;
 const fresh=!!row.last_telemetry_at&&Date.now()-new Date(row.last_telemetry_at).getTime()<120_000;
 const cameraStatus=deviceOnline===true&&fresh?'ONLINE':deviceOnline===false?'OFFLINE':fresh?'STALE':'UNKNOWN';
 const state=streamState(row);
 return {
  id:row.id,name:row.name,buildingId:row.building_id,buildingName:row.building_name,
  zone:row.zone,edgeId:row.edge_id,edgeStatus:row.edge_status,edgeConnected:row.edge_connected,
  cameraStatus,lastTelemetryAt:row.last_telemetry_at,telemetry,stream:state,
 };
}
async function viewerRow(sessionId:string,viewerId:string,userId:string,db:any=pool){
 const result=await db.query(`SELECT v.id,v.user_id,v.session_id,v.organization_id,v.building_id,
  v.participant_identity,v.expires_at,v.ended_at,s.camera_id,s.edge_node_id,s.room_name,
  s.edge_participant_identity,s.state,s.expires_at AS session_expires_at,s.failure_code
  FROM edge_camera_media_viewers v JOIN edge_camera_media_sessions s
   ON s.id=v.session_id AND s.organization_id=v.organization_id AND s.building_id=v.building_id
  WHERE v.id=$1 AND v.session_id=$2 AND v.user_id=$3`,
 [viewerId,sessionId,userId]);
 return result.rows[0]??null;
}
async function issueViewerToken(row:any):Promise<MediaViewerToken>{
 if(!cameraMediaGateway.configured||!cameraMediaGateway.serverUrl)throw new ApiError(503,'media_provider_unavailable');
 return cameraMediaGateway.createViewerToken(row.room_name,row.participant_identity);
}
async function stopCameraSession(sessionId:string,viewerId:string,userId:string,c:Context,req:Request){
 const ended=await transaction(async db=>{
  const viewer=(await db.query(`SELECT v.*,s.edge_node_id,s.room_name,s.state,s.camera_id
   FROM edge_camera_media_viewers v JOIN edge_camera_media_sessions s ON s.id=v.session_id
   WHERE v.id=$1 AND v.session_id=$2 AND v.user_id=$3 FOR UPDATE OF v,s`,[viewerId,sessionId,userId])).rows[0];
  if(!viewer)return null;
  if(!viewer.ended_at)await db.query(`UPDATE edge_camera_media_viewers SET ended_at=now(),last_activity_at=now()
   WHERE id=$1`,[viewer.id]);
  const active=(await db.query(`SELECT count(*)::int AS count FROM edge_camera_media_viewers
   WHERE session_id=$1 AND ended_at IS NULL AND expires_at>now()`,[sessionId])).rows[0].count;
  let stop=false;
  if(active===0&&['STARTING','ACTIVE','STOPPING'].includes(viewer.state)){
   await db.query(`UPDATE edge_camera_media_sessions SET state='STOPPING',last_activity_at=now()
    WHERE id=$1 AND state IN ('STARTING','ACTIVE','STOPPING')`,[sessionId]);
   stop=true;
  }
  await record(db,req,c,'camera_media.viewer_stop','camera_media_session',sessionId,{cameraId:viewer.camera_id});
  return {stop,edgeNodeId:viewer.edge_node_id,roomName:viewer.room_name};
 });
 if(ended?.stop){
  sendEdgeMessage(ended.edgeNodeId,{type:'MEDIA_SESSION_STOP',sessionId});
  if(cameraMediaGateway.configured)await cameraMediaGateway.deleteRoom(ended.roomName).catch(()=>{});
  await pool.query(`UPDATE edge_camera_media_sessions SET state='ENDED',ended_at=COALESCE(ended_at,now()),
   last_activity_at=now() WHERE id=$1 AND state='STOPPING'`,[sessionId]);
 }
 return {stopped:!!ended};
}

cameraMedia.get('/camera-media/cameras',async(req,res)=>{
 const c=await requirePermission(req,'device.camera.live_view');
 const rows=await cameraRows(c);
 res.json({cameras:rows.map(cameraSummary)});
});

cameraMedia.post('/camera-media/cameras/:cameraId/sessions',async(req,res)=>{
 const cameraId=uuid.parse(req.params.cameraId);
 const {c,row}=await authorizedCamera(req,cameraId);
 const availability=streamState(row);
 if(!availability.available){
  const code=availability.reason==='media_provider_not_configured'?'media_provider_not_configured':
   availability.reason==='edge_offline'?'edge_offline':
   availability.reason==='camera_offline'?'camera_offline':'edge_media_agent_not_ready';
  throw new ApiError(409,code);
 }
 const roomName=`cam_${randomUUID().replaceAll('-','')}`;
 const edgeIdentity=`edge_${randomUUID().replaceAll('-','')}`;
 const participantIdentity=`viewer_${randomUUID().replaceAll('-','')}`;
 let createdSession=false;
 const result=await transaction(async db=>{
  await db.query('SELECT id FROM edge_device_inventory WHERE id=$1 FOR UPDATE',[cameraId]);
  let session=(await db.query(`SELECT * FROM edge_camera_media_sessions
   WHERE camera_id=$1 AND state IN ('STARTING','ACTIVE') AND expires_at>now()
   ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,[cameraId])).rows[0];
  if(!session){
   session=(await db.query(`INSERT INTO edge_camera_media_sessions
    (organization_id,building_id,edge_node_id,camera_id,room_name,edge_participant_identity,started_by_user_id,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval '15 minutes') RETURNING *`,
   [c.organization_id,row.building_id,row.edge_node_id,cameraId,roomName,edgeIdentity,req.user!.id])).rows[0];
   createdSession=true;
  }
  let viewer=(await db.query(`SELECT * FROM edge_camera_media_viewers
   WHERE session_id=$1 AND user_id=$2 AND ended_at IS NULL AND expires_at>now()
   ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,[session.id,req.user!.id])).rows[0];
  if(!viewer){
   viewer=(await db.query(`INSERT INTO edge_camera_media_viewers
    (session_id,organization_id,building_id,user_id,participant_identity,expires_at)
    VALUES($1,$2,$3,$4,$5,now()+interval '15 minutes') RETURNING *`,
   [session.id,c.organization_id,row.building_id,req.user!.id,participantIdentity])).rows[0];
   await record(db,req,c,'camera_media.viewer_start','camera_media_session',session.id,{cameraId});
  }
  return {session,viewer};
 });
 try{
  if(createdSession){
   await cameraMediaGateway.createRoom(result.session.room_name);
   const publisherToken=await cameraMediaGateway.createPublisherToken(result.session.room_name,result.session.edge_participant_identity);
   const sent=sendEdgeMessage(row.edge_node_id,{
    type:'MEDIA_SESSION_START',sessionId:result.session.id,cameraId:row.edge_device_id,
    edgeDeviceId:row.edge_device_id,roomName:result.session.room_name,serverUrl:cameraMediaGateway.serverUrl,
    publisherToken,
   });
   if(!sent)throw new Error('edge_disconnected');
  }
  const viewerToken=await issueViewerToken({...result.session,...result.viewer});
  res.status(202).json({sessionId:result.session.id,viewerId:result.viewer.id,
   state:result.session.state==='ACTIVE'?'ACTIVE':'STARTING',...viewerToken});
 }catch(error){
  if(createdSession){
   await pool.query(`UPDATE edge_camera_media_sessions SET state='FAILED',failure_code='media_start_failed',
    ended_at=now() WHERE id=$1`,[result.session.id]);
   if(cameraMediaGateway.configured)await cameraMediaGateway.deleteRoom(result.session.room_name).catch(()=>{});
  }
  if(error instanceof ApiError)throw error;
  throw new ApiError(503,'media_session_start_failed');
 }
});

cameraMedia.get('/camera-media/sessions/:sessionId',async(req,res)=>{
 const sessionId=uuid.parse(req.params.sessionId),viewerId=uuid.parse(req.query.viewerId);
 const c=await requirePermission(req,'device.camera.live_view');
 const viewer=await viewerRow(sessionId,viewerId,req.user!.id);
 if(!viewer)throw new ApiError(404,'not_found');
 if(viewer.ended_at||new Date(viewer.expires_at).getTime()<=Date.now())throw new ApiError(403,'viewer_expired');
 const row=(await cameraRows(c,viewer.camera_id))[0];
 if(!row)throw new ApiError(403,'camera_access_revoked');
 if(viewer.state==='STARTING'&&cameraMediaGateway.configured){
  const hasTrack=await cameraMediaGateway.hasVideoPublisher(viewer.room_name,viewer.edge_participant_identity);
  if(hasTrack)await pool.query(`UPDATE edge_camera_media_sessions SET state='ACTIVE',
   started_at=COALESCE(started_at,now()),last_activity_at=now(),failure_code=NULL
   WHERE id=$1 AND state='STARTING'`,[sessionId]);
 }
 const current=(await pool.query(`SELECT state,failure_code FROM edge_camera_media_sessions WHERE id=$1`,[sessionId])).rows[0];
 res.json({sessionId,viewerId,state:current?.state??'ENDED',failureCode:current?.failure_code??null});
});

cameraMedia.post('/camera-media/sessions/:sessionId/token',async(req,res)=>{
 const sessionId=uuid.parse(req.params.sessionId),viewerId=uuid.parse(z.object({viewerId:uuid}).parse(req.body).viewerId);
 const c=await requirePermission(req,'device.camera.live_view');
 const viewer=await viewerRow(sessionId,viewerId,req.user!.id);
 if(!viewer||viewer.ended_at||new Date(viewer.expires_at).getTime()<=Date.now())throw new ApiError(404,'not_found');
 const camera=(await cameraRows(c,viewer.camera_id))[0];
 if(!camera)throw new ApiError(403,'camera_access_revoked');
 if(!['STARTING','ACTIVE'].includes(viewer.state)||new Date(viewer.session_expires_at).getTime()<=Date.now())throw new ApiError(404,'session_not_active');
 res.json(await issueViewerToken(viewer));
});

cameraMedia.post('/camera-media/sessions/:sessionId/heartbeat',async(req,res)=>{
 const sessionId=uuid.parse(req.params.sessionId),viewerId=uuid.parse(z.object({viewerId:uuid}).parse(req.body).viewerId);
 const c=await requirePermission(req,'device.camera.live_view');
 const viewer=await viewerRow(sessionId,viewerId,req.user!.id);
 if(!viewer||viewer.ended_at||new Date(viewer.expires_at).getTime()<=Date.now())throw new ApiError(404,'not_found');
 if(!(await cameraRows(c,viewer.camera_id)).length)throw new ApiError(403,'camera_access_revoked');
  await pool.query(`UPDATE edge_camera_media_viewers SET last_activity_at=now(),
   expires_at=LEAST(now()+interval '15 minutes',created_at+interval '4 hours') WHERE id=$1 AND ended_at IS NULL`,[viewerId]);
  await pool.query(`UPDATE edge_camera_media_sessions SET last_activity_at=now(),
   expires_at=LEAST(now()+interval '15 minutes',created_at+interval '4 hours') WHERE id=$1 AND state IN ('STARTING','ACTIVE')`,[sessionId]);
 res.json({ok:true});
});

cameraMedia.delete('/camera-media/sessions/:sessionId',async(req,res)=>{
 const sessionId=uuid.parse(req.params.sessionId),viewerId=uuid.parse(req.query.viewerId);
 const c=await requirePermission(req,'device.camera.live_view');
 const viewer=await viewerRow(sessionId,viewerId,req.user!.id);
 if(!viewer)throw new ApiError(404,'not_found');
 if(!(await cameraRows(c,viewer.camera_id)).length)throw new ApiError(403,'camera_access_revoked');
 res.json(await stopCameraSession(sessionId,viewerId,req.user!.id,c,req));
});

export async function sweepCameraMediaSessions(){
 if(!cameraMediaGateway.configured)return;
 const sessions=await transaction(async db=>{
  const expired=(await db.query(`UPDATE edge_camera_media_viewers SET ended_at=COALESCE(ended_at,now())
   WHERE ended_at IS NULL AND (expires_at<=now() OR last_activity_at<=now()-interval '90 seconds')
   RETURNING session_id`)).rows;
  const sessionIds=[...new Set(expired.map((row:any)=>row.session_id))];
  const rows=(await db.query(`SELECT s.id,s.edge_node_id,s.room_name,s.state,
    (s.state='STARTING' AND s.created_at<=now()-interval '30 seconds') AS start_timed_out
   FROM edge_camera_media_sessions s
   WHERE (s.state IN ('STARTING','ACTIVE') AND
     (s.expires_at<=now() OR s.id=ANY($1::uuid[]) OR NOT EXISTS
      (SELECT 1 FROM edge_camera_media_viewers v WHERE v.session_id=s.id AND v.ended_at IS NULL AND v.expires_at>now())
      OR (s.state='STARTING' AND s.created_at<=now()-interval '30 seconds')))
    OR (s.state='STOPPING' AND s.last_activity_at<=now()-interval '2 minutes')
   FOR UPDATE SKIP LOCKED`,[sessionIds])).rows;
  for(const session of rows){
   if(session.start_timed_out){
    await db.query(`UPDATE edge_camera_media_sessions SET state='FAILED',failure_code='edge_start_timeout',
     ended_at=COALESCE(ended_at,now()),last_activity_at=now() WHERE id=$1 AND state='STARTING'`,[session.id]);
   }else{
    await db.query(`UPDATE edge_camera_media_sessions SET state='STOPPING',ended_at=COALESCE(ended_at,now()),
     last_activity_at=now() WHERE id=$1 AND state IN ('STARTING','ACTIVE','STOPPING')`,[session.id]);
   }
  }
  return rows;
 });
 for(const session of sessions){
  sendEdgeMessage(session.edge_node_id,{type:'MEDIA_SESSION_STOP',sessionId:session.id});
  await cameraMediaGateway.deleteRoom(session.room_name).catch(error=>{
   logger.warn({code:(error as {code?:string})?.code??'room_delete_failed'},'LiveKit room cleanup failed');
  });
  if(!session.start_timed_out)await pool.query(`UPDATE edge_camera_media_sessions SET state='ENDED',last_activity_at=now()
   WHERE id=$1 AND state='STOPPING'`,[session.id]);
 }
}

const cleanup=setInterval(()=>{void sweepCameraMediaSessions().catch(error=>{
 logger.error({code:(error as {code?:string})?.code??'camera_media_cleanup_failed'},'Camera media cleanup failed');
})},30_000);
cleanup.unref?.();
