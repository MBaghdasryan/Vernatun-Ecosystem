import {Router,type Request,type RequestHandler} from 'express';
import {createHash,randomBytes} from 'node:crypto';
import {z} from 'zod';
import {pool} from './db.js';
import {ApiError,context,requireAuth,requirePermission} from './access.js';
import {requireRecentAuthentication} from './recent-auth.js';
import {transaction,record} from './operations.js';
import {closeEdgeConnection} from './edge-sockets.js';
import {requestEdgeCommand} from './edge-command-service.js';

const router=Router();
router.use(requireAuth);
const uuid=z.string().uuid();
const edgeId=z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/);
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const bootstrapSchema=z.object({
 organizationId:uuid.optional(),buildingId:uuid,edgeId,name:z.string().trim().min(2).max(120),
 siteCode:z.string().trim().min(1).max(100),expiresInMinutes:z.number().int().min(5).max(120).default(30)
}).strict();
const capabilitySchema=z.array(z.enum(['BARRIER.OPEN'])).min(1).max(1);

async function organizationScope(req:Request,permission:string){
 const c=await requirePermission(req,permission);
 if(c.organization_id)return c;
 if(c.permissions.includes('edge.fleet.read')||c.permissions.includes('edge.bootstrap.create'))return c;
 throw new ApiError(403,'organization_scope_required');
}
async function nodeInScope(req:Request,id:string,permission:string){
 const c=await organizationScope(req,permission);
 const params:any[]=[id];let where='n.id=$1';
 if(c.organization_id){params.push(c.organization_id);where+=' AND n.organization_id=$2'}
 else if(!c.permissions.includes('edge.fleet.read'))throw new ApiError(403,'organization_scope_required');
 if(c.building_id){params.push(c.building_id);where+=` AND n.building_id=$${params.length}`}
 const result=await pool.query(`SELECT n.* FROM edge_nodes n WHERE ${where}`,params);
 if(!result.rowCount)throw new ApiError(404,'edge_not_found');
 return {context:c,node:result.rows[0]};
}
async function readableEdgeScope(req:Request){
 const identity=await context(req);
 const permission=['edge.read','edge.inventory.read','edge.health.read'].find(key=>identity.permissions.includes(key));
 if(!permission)throw new ApiError(403,'edge_read_required');
 return organizationScope(req,permission);
}
const edgeStatusSql=`CASE WHEN n.status='DISABLED' THEN 'DISABLED'
 WHEN n.last_seen_at IS NULL THEN 'UNKNOWN'
 WHEN n.last_seen_at<now()-interval '90 seconds' THEN 'OFFLINE' ELSE n.status END`;

router.get('/edge-console/buildings',async(req,res)=>{
 const c=await requirePermission(req,'edge.bootstrap.create');
 if(c.organization_id){
  const result=await pool.query(`SELECT id,name,address,organization_id FROM buildings
   WHERE organization_id=$1 AND ($2::uuid IS NULL OR id=$2) ORDER BY name`,[c.organization_id,c.building_id]);
  return res.json(result.rows);
 }
 return res.json((await pool.query(`SELECT b.id,b.name,b.address,b.organization_id,o.name AS organization_name
  FROM buildings b JOIN organizations o ON o.id=b.organization_id ORDER BY o.name,b.name LIMIT 1000`)).rows);
});
router.get('/edge-console/fleet',async(req,res)=>{
 const c=await readableEdgeScope(req);
 const global=c.permissions.includes('edge.fleet.read')&&!c.organization_id;
 if(!global&&!c.organization_id)throw new ApiError(403,'organization_scope_required');
 const values:any[]=[];let where='TRUE';
 if(!global){values.push(c.organization_id);where=`n.organization_id=$${values.length}`}
 if(c.building_id){values.push(c.building_id);where+=` AND n.building_id=$${values.length}`}
 const result=await pool.query(`SELECT n.id,n.edge_id,n.organization_id,n.building_id,n.name,n.site_code,
  ${edgeStatusSql} AS status,n.registration_state,n.agent_version,n.local_authorization_status,n.queue_depth,
  n.registered_at,n.last_seen_at,n.last_connected_at,n.credential_version,o.name AS organization_name,b.name AS building_name,
  (SELECT count(*)::int FROM edge_device_inventory d WHERE d.edge_node_id=n.id) AS device_count,
  (SELECT count(*)::int FROM edge_alarms a WHERE a.edge_node_id=n.id AND a.status='active') AS active_alarms
  FROM edge_nodes n JOIN organizations o ON o.id=n.organization_id JOIN buildings b ON b.id=n.building_id
  WHERE ${where} ORDER BY n.last_seen_at DESC NULLS LAST,n.name`,values);
 const rows=result.rows.map(row=>c.permissions.includes('edge.alarms.read')||c.permissions.includes('edge.read')
  ?row:{...row,active_alarms:0});
 res.json({summary:{total:rows.length,online:rows.filter(r=>r.status==='ONLINE').length,
  degraded:rows.filter(r=>r.status==='DEGRADED').length,offline:rows.filter(r=>r.status==='OFFLINE').length,
  activeAlarms:rows.reduce((sum,r)=>sum+Number(r.active_alarms),0)},nodes:rows});
});
router.get('/edge-console/nodes/:id',async(req,res)=>{
 const identity=await context(req);
 const permission=['edge.read','edge.inventory.read','edge.health.read'].find(key=>identity.permissions.includes(key));
 if(!permission)throw new ApiError(403,'edge_read_required');
 const {context:c,node}=await nodeInScope(req,uuid.parse(req.params.id),permission);
 const devices=c.permissions.includes('edge.inventory.read')||c.permissions.includes('edge.read')
  ?await pool.query(`SELECT d.id,d.edge_device_id,d.thingsboard_id,d.name,d.profile,d.device_type,d.label,d.unit_id,
    d.capabilities,d.reported_online,d.last_seen_at,d.last_telemetry_at,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('unitId',a.unit_id,'allowedCapabilities',a.allowed_capabilities))
     FROM edge_device_access a WHERE a.device_id=d.id),'[]'::jsonb) AS access_units
    FROM edge_device_inventory d WHERE d.edge_node_id=$1 ORDER BY d.name`,[node.id])
  :{rows:[]};
 const alarms=c.permissions.includes('edge.alarms.read')||c.permissions.includes('edge.read')
  ?await pool.query(`SELECT id,external_alarm_id,alarm_type,severity,status,received_at,acknowledged_at,resolved_at
    FROM edge_alarms WHERE edge_node_id=$1 ORDER BY received_at DESC LIMIT 100`,[node.id])
  :{rows:[]};
 res.json({node:{...node,status:node.status==='ONLINE'&&node.last_seen_at&&
  Date.now()-new Date(node.last_seen_at).getTime()>90_000?'OFFLINE':node.status},devices:devices.rows,alarms:alarms.rows});
});
router.get('/edge-console/nodes/:id/devices',async(req,res)=>{
 const {node}=await nodeInScope(req,uuid.parse(req.params.id),'edge.inventory.read');
 res.json((await pool.query(`SELECT id,edge_device_id,thingsboard_id,name,profile,device_type,label,unit_id,
  capabilities,reported_online,last_seen_at,last_telemetry_at FROM edge_device_inventory
  WHERE edge_node_id=$1 ORDER BY name`,[node.id])).rows);
});
router.get('/edge-console/alarms',async(req,res)=>{
 const c=await organizationScope(req,'edge.alarms.read');
 if(!c.organization_id&&!c.permissions.includes('edge.fleet.read'))throw new ApiError(403,'organization_scope_required');
 const params:any[]=[];let where='TRUE';
 if(c.organization_id){params.push(c.organization_id);where=`a.organization_id=$${params.length}`}
 if(c.building_id){params.push(c.building_id);where+=` AND a.building_id=$${params.length}`}
 res.json((await pool.query(`SELECT a.*,n.edge_id,n.name AS edge_name,d.name AS device_name,b.name AS building_name
  FROM edge_alarms a JOIN edge_nodes n ON n.id=a.edge_node_id LEFT JOIN edge_device_inventory d ON d.id=a.device_inventory_id
  JOIN buildings b ON b.id=a.building_id WHERE ${where} ORDER BY CASE a.severity WHEN 'emergency' THEN 0 WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END,a.received_at DESC LIMIT 500`,params)).rows);
});
router.get('/edge-console/events',async(req,res)=>{
 const c=await organizationScope(req,'edge.events.read');
 if(!c.organization_id&&!c.permissions.includes('edge.fleet.read'))throw new ApiError(403,'organization_scope_required');
 const params:any[]=[];let where='TRUE';
 if(c.organization_id){params.push(c.organization_id);where=`e.organization_id=$${params.length}`}
 if(c.building_id){params.push(c.building_id);where+=` AND e.building_id=$${params.length}`}
 res.json((await pool.query(`SELECT e.*,n.edge_id,n.name AS edge_name,d.name AS device_name
  FROM edge_events e JOIN edge_nodes n ON n.id=e.edge_node_id LEFT JOIN edge_device_inventory d ON d.id=e.device_inventory_id
  WHERE ${where} ORDER BY e.received_at DESC LIMIT 500`,params)).rows);
});
router.get('/edge-console/commands',async(req,res)=>{
 const c=await organizationScope(req,'edge.commands.read');
 if(!c.organization_id&&!c.permissions.includes('edge.fleet.read'))throw new ApiError(403,'organization_scope_required');
 const params:any[]=[];let where='TRUE';
 if(c.organization_id){params.push(c.organization_id);where=`organization_id=$${params.length}`}
 if(c.building_id){params.push(c.building_id);where+=` AND building_id=$${params.length}`}
 res.json((await pool.query(`SELECT command_id,organization_id,building_id,edge_device_id,capability,requested_role,
  source_product,status,authorization_decision,authorization_reason,requested_at,completed_at,expires_at,error_code
  FROM edge_commands WHERE ${where} ORDER BY requested_at DESC LIMIT 500`,params)).rows);
});
router.post('/edge-console/bootstrap-tokens',async(req,res)=>{
 const c=await requirePermission(req,'edge.bootstrap.create');
 requireRecentAuthentication(req);
 const input=bootstrapSchema.parse(req.body);
 const organizationId=c.organization_id??input.organizationId;
 if(!organizationId)throw new ApiError(400,'organization_required');
 if(c.organization_id&&input.organizationId&&input.organizationId!==c.organization_id)throw new ApiError(403,'organization_scope_mismatch');
 if(c.building_id&&c.building_id!==input.buildingId)throw new ApiError(403,'building_scope_mismatch');
 const building=await pool.query(`SELECT b.id,b.organization_id FROM buildings b
  WHERE b.id=$1 AND b.organization_id=$2`,[input.buildingId,organizationId]);
 if(!building.rowCount)throw new ApiError(404,'building_not_found');
 const occupied=await pool.query('SELECT id FROM edge_nodes WHERE building_id=$1 OR edge_id=$2',[input.buildingId,input.edgeId]);
 if(occupied.rowCount)throw new ApiError(409,'edge_already_registered');
 const plaintext=`vne_bootstrap_${randomBytes(32).toString('base64url')}`;
 const expiresAt=new Date(Date.now()+input.expiresInMinutes*60_000);
 const result=await transaction(async db=>{
  await db.query(`UPDATE edge_bootstrap_tokens SET revoked_at=now()
   WHERE edge_id=$1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at<=now()`,[input.edgeId]);
  const active=await db.query(`SELECT id FROM edge_bootstrap_tokens
   WHERE edge_id=$1 AND used_at IS NULL AND revoked_at IS NULL`,[input.edgeId]);
  if(active.rowCount)throw new ApiError(409,'active_bootstrap_token_exists');
  const token=(await db.query(`INSERT INTO edge_bootstrap_tokens
   (edge_id,organization_id,building_id,edge_name,site_code,token_hash,expires_at,created_by_user_id)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,edge_id,organization_id,building_id,expires_at,created_at`,
   [input.edgeId,organizationId,input.buildingId,input.name,input.siteCode,hash(plaintext),expiresAt,req.user!.id])).rows[0];
  await db.query(`INSERT INTO audit_events(organization_id,actor_user_id,action,entity_type,entity_id,details)
   VALUES($1,$2,'edge.bootstrap.create','edge_bootstrap_token',$3,$4)`,
   [organizationId,req.user!.id,token.id,JSON.stringify({edgeId:input.edgeId,buildingId:input.buildingId,expiresAt})]);
  return token;
 });
 res.status(201).json({...result,bootstrapToken:plaintext,oneTime:true});
});
router.post('/edge-console/bootstrap-tokens/:id/revoke',async(req,res)=>{
 const c=await requirePermission(req,'edge.bootstrap.create');requireRecentAuthentication(req);
 const tokenId=uuid.parse(req.params.id);
 const result=await transaction(async db=>{
  const row=await db.query(`UPDATE edge_bootstrap_tokens SET revoked_at=COALESCE(revoked_at,now())
   WHERE id=$1 AND used_at IS NULL AND ($2::uuid IS NULL OR organization_id=$2)
    AND ($3::uuid IS NULL OR building_id=$3) RETURNING id,organization_id,edge_id`,[tokenId,c.organization_id,c.building_id]);
  if(!row.rowCount)throw new ApiError(404,'bootstrap_token_not_found');
  await record(db,req,{...c,organization_id:row.rows[0].organization_id},'edge.bootstrap.revoke','edge_bootstrap_token',row.rows[0].id,{edgeId:row.rows[0].edge_id});
  return row.rows[0];
 });
 res.json({status:'REVOKED',id:result.id});
});
router.post('/edge-console/nodes/:id/credentials/rotate',async(req,res)=>{
 const {context:c,node}=await nodeInScope(req,uuid.parse(req.params.id),'edge.credentials.rotate');
 requireRecentAuthentication(req);
 const plaintext=`vne_${randomBytes(32).toString('base64url')}`;
 const result=await transaction(async db=>{
  const locked=await db.query('SELECT id,credential_version FROM edge_nodes WHERE id=$1 FOR UPDATE',[node.id]);
  if(!locked.rowCount)throw new ApiError(404,'edge_not_found');
  const version=Number(locked.rows[0].credential_version)+1;
  const row=(await db.query(`INSERT INTO edge_credentials(edge_node_id,credential_hash,version,status,expires_at,created_by_user_id)
   VALUES($1,$2,$3,'pending',now()+interval '30 minutes',$4) RETURNING id,version,expires_at`,
   [node.id,hash(plaintext),version,req.user!.id])).rows[0];
  await record(db,req,c,'edge.credential.rotate','edge_node',node.id,{credentialVersion:version,expiresAt:row.expires_at});
  return row;
 });
 res.status(201).json({...result,accessToken:plaintext,oneTime:true,
  instruction:'Update the Edge Agent secret. The current credential remains valid until this new credential is used or its 30-minute expiry.'});
});
router.post('/edge-console/nodes/:id/credentials/revoke',async(req,res)=>{
 const {context:c,node}=await nodeInScope(req,uuid.parse(req.params.id),'edge.credentials.revoke');
 requireRecentAuthentication(req);
 await transaction(async db=>{
  await db.query(`UPDATE edge_credentials SET status='revoked',revoked_at=COALESCE(revoked_at,now())
   WHERE edge_node_id=$1 AND status IN ('active','pending')`,[node.id]);
  await db.query(`UPDATE edge_nodes SET status='OFFLINE',updated_at=now() WHERE id=$1`,[node.id]);
  await record(db,req,c,'edge.credential.revoke','edge_node',node.id,{edgeId:node.edge_id});
 });
 closeEdgeConnection(node.id);
 res.json({status:'REVOKED'});
});
router.put('/edge-console/devices/:deviceId/access',async(req,res)=>{
 const c=await requirePermission(req,'edge.manage');
 const input=z.object({unitId:uuid,allowedCapabilities:capabilitySchema.default(['BARRIER.OPEN'])}).strict().parse(req.body);
 if(!c.organization_id)throw new ApiError(403,'organization_scope_required');
 const deviceId=uuid.parse(req.params.deviceId);
 const result=await transaction(async db=>{
  const target=await db.query(`SELECT id,organization_id,building_id FROM edge_device_inventory
   WHERE id=$1 AND organization_id=$2 AND ($3::uuid IS NULL OR building_id=$3) FOR UPDATE`,
   [deviceId,c.organization_id,c.building_id]);
  if(!target.rowCount)throw new ApiError(404,'device_not_found');
  const unit=await db.query(`SELECT id FROM units WHERE id=$1 AND organization_id=$2 AND building_id=$3`,
   [input.unitId,c.organization_id,target.rows[0].building_id]);
  if(!unit.rowCount)throw new ApiError(400,'unit_building_mismatch');
  await db.query(`INSERT INTO edge_device_access(device_id,organization_id,building_id,unit_id,allowed_capabilities,created_by_user_id)
   VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(device_id,unit_id) DO UPDATE
   SET allowed_capabilities=EXCLUDED.allowed_capabilities,created_by_user_id=EXCLUDED.created_by_user_id,created_at=now()`,
   [deviceId,c.organization_id,target.rows[0].building_id,input.unitId,input.allowedCapabilities,req.user!.id]);
  await record(db,req,c,'edge.device.access.assign','edge_device',deviceId,{unitId:input.unitId,capabilities:input.allowedCapabilities});
  return {deviceId,unitId:input.unitId,allowedCapabilities:input.allowedCapabilities};
 });
 res.json(result);
});
router.delete('/edge-console/devices/:deviceId/access/:unitId',async(req,res)=>{
 const c=await requirePermission(req,'edge.manage');
 if(!c.organization_id)throw new ApiError(403,'organization_scope_required');
 const deviceId=uuid.parse(req.params.deviceId),unitId=uuid.parse(req.params.unitId);
 const result=await transaction(async db=>{
  const row=await db.query(`DELETE FROM edge_device_access a USING edge_device_inventory d
   WHERE a.device_id=d.id AND a.device_id=$1 AND a.unit_id=$2 AND a.organization_id=$3
    AND ($4::uuid IS NULL OR a.building_id=$4) RETURNING a.device_id`,
   [deviceId,unitId,c.organization_id,c.building_id]);
  if(!row.rowCount)throw new ApiError(404,'device_access_not_found');
  await record(db,req,c,'edge.device.access.revoke','edge_device',deviceId,{unitId});
  return row.rows[0];
 });
 res.json({status:'REVOKED',...result});
});

router.get('/me/buildings/:buildingId/devices',async(req,res)=>{
 const c=await requirePermission(req,'device.read.own'),buildingId=uuid.parse(req.params.buildingId);
 if(!['unit_owner','renter','family'].includes(c.role_key)||!c.unit_id||c.building_id!==buildingId||!c.organization_id)
  throw new ApiError(403,'resident_device_scope_required');
 const rows=await pool.query(`SELECT d.id,d.edge_device_id,d.name,d.profile,d.device_type,d.label,d.capabilities,
  d.reported_online,d.last_seen_at,n.status AS edge_status,a.allowed_capabilities
  FROM edge_device_access a JOIN edge_device_inventory d ON d.id=a.device_id
  JOIN edge_nodes n ON n.id=d.edge_node_id
  WHERE a.unit_id=$1 AND a.organization_id=$2 AND a.building_id=$3
   AND n.registration_state='REGISTERED' AND n.status<>'DISABLED'
  ORDER BY d.name`,[c.unit_id,c.organization_id,buildingId]);
 res.json(rows.rows.map(row=>({...row,permittedCapabilities:c.role_key==='unit_owner'||c.role_key==='renter'
  ?row.allowed_capabilities.filter((cap:string)=>cap==='BARRIER.OPEN'&&c.permissions.includes('device.barrier.open.own'))
  :[]})));
});
router.post('/me/buildings/:buildingId/devices/:deviceId/commands',async(req,res)=>{
 const c=await requirePermission(req,'device.read.own'),buildingId=uuid.parse(req.params.buildingId),deviceId=uuid.parse(req.params.deviceId);
 const body=z.object({capability:z.string().trim().min(1).max(80),reason:z.string().trim().min(3).max(300),
  idempotencyKey:z.string().trim().min(8).max(160).optional()}).strict().parse(req.body);
 const result=await requestEdgeCommand(req,c,{buildingId,deviceId,capability:body.capability,
  reason:body.reason,idempotencyKey:body.idempotencyKey??req.get('Idempotency-Key')??undefined});
 res.status(result.httpStatus).json(result.command);
});
router.post('/buildings/:buildingId/devices/:deviceId/commands',async(req,res)=>{
 const c=await context(req),buildingId=uuid.parse(req.params.buildingId),deviceId=uuid.parse(req.params.deviceId);
 const body=z.object({capability:z.string().trim().min(1).max(80),reason:z.string().trim().min(3).max(300),
  idempotencyKey:z.string().trim().min(8).max(160).optional()}).strict().parse(req.body);
 const result=await requestEdgeCommand(req,c,{buildingId,deviceId,capability:body.capability,
  reason:body.reason,idempotencyKey:body.idempotencyKey??req.get('Idempotency-Key')??undefined});
 res.status(result.httpStatus).json(result.command);
});
router.get('/me/edge-commands/:commandId',async(req,res)=>{
 const c=await context(req),commandId=uuid.parse(req.params.commandId);
 const row=await pool.query(`SELECT command_id,status,capability,authorization_decision,authorization_reason,
  requested_at,queued_at,delivered_at,completed_at,expires_at,error_code
  FROM edge_commands WHERE command_id=$1 AND requested_by_user_id=$2 AND organization_id=$3
   AND ($4::uuid IS NULL OR building_id=$4)`,[commandId,req.user!.id,c.organization_id,c.building_id]);
 if(!row.rowCount)throw new ApiError(404,'command_not_found');
 res.json(row.rows[0]);
});

export const edgeManagementApi:RequestHandler=router;
