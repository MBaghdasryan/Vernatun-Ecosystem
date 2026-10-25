import {Server} from 'node:http';
import {WebSocket,WebSocketServer} from 'ws';
import {pool} from './db.js';
import {ApiError} from './access.js';
import {authenticateEdgeToken} from './edge-auth.js';
import {edgeTimestampedRecord} from './edge-timestamp.js';
import {logger} from '../../../src/lib/logger.js';

const SOCKET_PATH_V1='/api/edge/v1/connect';
const SOCKET_PATH_V2='/api/edge/v2/connect';
const connected=new Map<string,WebSocket>();

export function sendEdgeMessage(edgeNodeId:string,message:unknown){
 const socket=connected.get(edgeNodeId);
 if(!socket||socket.readyState!==WebSocket.OPEN)return false;
 socket.send(JSON.stringify(message));
 return true;
}
export function isEdgeConnected(edgeNodeId:string){
 const socket=connected.get(edgeNodeId);
 return !!socket&&socket.readyState===WebSocket.OPEN;
}
export function closeEdgeConnection(edgeNodeId:string,code=4001,reason='credential_revoked'){
 const socket=connected.get(edgeNodeId);
 if(socket&&socket.readyState< WebSocket.CLOSING)socket.close(code,reason);
}

async function authenticateUpgrade(token:string,edgeId:string|null){
 const node=await authenticateEdgeToken(token);
 if(!node||(edgeId!==null&&node.edge_id!==edgeId))throw new ApiError(401,'edge_unauthorized');
 return node;
}

export async function recordEdgeCommandResult(edgeNodeId:string,result:any){
 result=edgeTimestampedRecord.parse(result);
 const commandId=String(result?.commandId??'');
 if(!commandId)throw new ApiError(400,'invalid_command_result');
 const status=String(result?.status??'').toUpperCase();
 if(!['SUCCESS','REJECTED','FAILED','DENIED'].includes(status))throw new ApiError(400,'invalid_command_result');
 const command=await pool.query(`SELECT id,status,expires_at,organization_id,building_id FROM edge_commands
  WHERE command_id=$1 AND edge_node_id=$2`,[commandId,edgeNodeId]);
 if(!command.rowCount)throw new ApiError(404,'command_not_found');
 const prior=command.rows[0];
 const next=status==='SUCCESS'?'SUCCESS':'FAILED';
 if(['SUCCESS','FAILED','DENIED','TIMEOUT','CANCELLED'].includes(prior.status)){
  const existing=await pool.query('SELECT result_json=$2::jsonb AS same FROM edge_commands WHERE id=$1',[prior.id,JSON.stringify(result)]);
  if(existing.rows[0]?.same!==true)throw new ApiError(409,'command_result_conflict');
  return {status:prior.status,idempotent:true};
 }
 if(new Date(prior.expires_at).getTime()<Date.now()){
  await pool.query(`UPDATE edge_commands SET status='TIMEOUT',authorization_reason='command_expired',
   error_code='command_expired',failed_at=COALESCE(failed_at,now()),updated_at=now()
   WHERE id=$1 AND status NOT IN ('SUCCESS','FAILED','DENIED','TIMEOUT','CANCELLED')`,[prior.id]);
  return {status:'TIMEOUT',idempotent:false};
 }
 const updated=await pool.query(`UPDATE edge_commands SET status=$2,result_json=$3,
  completed_at=now(),failed_at=CASE WHEN $2='FAILED' THEN now() ELSE NULL END,
  error_code=CASE WHEN $2='FAILED' THEN 'edge_command_rejected' ELSE NULL END,
  updated_at=now()
  WHERE id=$1 AND status IN ('QUEUED','DELIVERED','ACKNOWLEDGED','AUTHORIZED')
  RETURNING status`,[prior.id,next,JSON.stringify(result)]);
 if(!updated.rowCount)throw new ApiError(409,'command_state_conflict');
 await pool.query(`INSERT INTO audit_events(organization_id,action,entity_type,entity_id,details)
  VALUES($1,$2,'edge_command',$3,$4)`,[prior.organization_id,`edge.command.${next.toLowerCase()}`,commandId,
  JSON.stringify({status:next,buildingId:prior.building_id})]);
 return {status:updated.rows[0].status,idempotent:false};
}

export function attachEdgeWebSocket(server:Server){
 const wss=new WebSocketServer({noServer:true,maxPayload:64*1024,perMessageDeflate:false});
 const upgradeNodes=new WeakMap<WebSocket,any>();
 server.on('upgrade',(request,socket,head)=>{
  const url=new URL(request.url??'/',`http://${request.headers.host??'localhost'}`);
  if(url.pathname!==SOCKET_PATH_V1&&url.pathname!==SOCKET_PATH_V2)return;
  const protocolVersion=url.pathname===SOCKET_PATH_V2?2:1;
  void (async()=>{
   try{
    const authorization=request.headers.authorization??'';
    const token=authorization.startsWith('Bearer ')?authorization.slice(7):'';
    if(token.length<20||token.length>256)throw new ApiError(401,'edge_unauthorized');
    const edgeId=url.searchParams.get('edgeId');
    const node=await authenticateUpgrade(token,edgeId);
    if(node.protocol_version!==protocolVersion||
     (protocolVersion===1&&!node.building_id)||(protocolVersion===2&&!node.block_id))
     throw new ApiError(401,'edge_protocol_mismatch');
    for(const [header,expected] of [
     ['x-vernatun-edge-id',node.edge_id],['x-vernatun-tenant-id',node.organization_id],
     [protocolVersion===1?'x-vernatun-building-id':'x-vernatun-block-id',
      protocolVersion===1?node.building_id:node.block_id]
    ] as const){
     const supplied=request.headers[header];
     if(typeof supplied!=='string'||supplied.toLowerCase()!==String(expected).toLowerCase())throw new ApiError(401,'edge_identity_mismatch');
    }
    for(const [key,expected] of [
     ['tenantId',node.organization_id],
     [protocolVersion===1?'buildingId':'blockId',protocolVersion===1?node.building_id:node.block_id],
    ] as const){
     const supplied=url.searchParams.get(key);
     if(supplied!==null&&supplied.toLowerCase()!==String(expected).toLowerCase())throw new ApiError(401,'edge_identity_mismatch');
    }
    logger.info({code:'edge_authenticated',edgeNodeId:node.id,edgeId:node.edge_id},'Edge authenticated');
    wss.handleUpgrade(request,socket,head,client=>{
     logger.info({code:'edge_websocket_upgraded',edgeNodeId:node.id},'Edge WebSocket upgraded');
     upgradeNodes.set(client,node);wss.emit('connection',client,request);
    });
   }catch(error){
    logger.warn({code:'edge_websocket_rejected',reason:error instanceof ApiError?error.code:'edge_authentication_failed'},'Edge WebSocket rejected');
    if(!socket.destroyed){socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');socket.destroy();}
   }
  })();
 });
 wss.on('connection',(socket)=>{
  const node=upgradeNodes.get(socket);
  if(!node){socket.close(4003,'edge_identity_mismatch');return}
  const old=connected.get(node.id);
  if(old&&old!==socket)old.close(4002,'connection_replaced');
  connected.set(node.id,socket);
  logger.info({code:'edge_connected',edgeNodeId:node.id,edgeId:node.edge_id},'Edge connected');
  void pool.query(`UPDATE edge_nodes SET last_connected_at=now(),last_seen_at=now(),
   status=CASE WHEN local_authorization_status='OK' THEN 'ONLINE' ELSE 'DEGRADED' END,
   updated_at=now() WHERE id=$1`,[node.id]);
  socket.on('message',raw=>{
   void (async()=>{
    try{
     const message=JSON.parse(raw.toString());
     const type=String(message?.type??'').toUpperCase();
     if(type==='EDGE_HELLO'){
      const scopeMatches=node.protocol_version===2
       ?message.protocolVersion===2&&message.blockId===node.block_id
       :message.buildingId===node.building_id;
      if(message.edgeId!==node.edge_id||message.tenantId!==node.organization_id||!scopeMatches){
       socket.close(4003,'edge_identity_mismatch');return;
      }
      await pool.query(`UPDATE edge_nodes SET agent_version=$2,last_seen_at=now(),status='ONLINE',updated_at=now()
       WHERE id=$1`,[node.id,typeof message.agentVersion==='string'?message.agentVersion.slice(0,80):null]);
     }else if(type==='COMMAND_RESULT'){
      await recordEdgeCommandResult(node.id,message.result);
     }else if(type==='PONG'){
      await pool.query("UPDATE edge_nodes SET last_seen_at=now(),updated_at=now() WHERE id=$1",[node.id]);
     }else if(type==='CONFIG_REQUEST'){
      const info=(await pool.query(`SELECT edge_id,organization_id AS "tenantId",building_id AS "buildingId",
       block_id AS "blockId",protocol_version AS "protocolVersion",config_version AS "configVersion"
       FROM edge_nodes WHERE id=$1`,[node.id])).rows[0];
      if(node.protocol_version===2)info.buildingIds=(await pool.query(
       'SELECT building_id FROM edge_node_buildings WHERE edge_node_id=$1 ORDER BY building_id',[node.id])).rows.map(r=>r.building_id);
      socket.send(JSON.stringify({type:'CONFIG',...info}));
     }
    }catch{
     // Do not include message bodies or credentials in logs.
     if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:'ERROR',error:'invalid_edge_message'}));
    }
   })();
  });
  socket.on('close',()=>{
   if(connected.get(node.id)===socket){
    connected.delete(node.id);
    void pool.query(`UPDATE edge_nodes SET last_disconnected_at=now(),
     status=CASE WHEN status='DISABLED' THEN status ELSE 'OFFLINE' END,updated_at=now() WHERE id=$1`,[node.id]);
   }
  });
  socket.on('error',()=>{});
 });
 return wss;
}
