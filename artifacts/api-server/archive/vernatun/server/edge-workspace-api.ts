import {Router,type Request} from 'express';
import {randomBytes,createHash} from 'node:crypto';
import {z} from 'zod';
import {CreateEdgeDraftBody,UpdateEdgeNodeMetadataBody,GenerateEdgeDraftTokenBody,UpdateEdgeBoundBuildingsBody} from '@workspace/api-zod';
import {pool} from './db.js';
import {ApiError,context,requirePermission,type Context} from './access.js';
import {requireRecentAuthentication} from './recent-auth.js';
import {transaction,record} from './operations.js';
import {isEdgeConnected} from './edge-sockets.js';
import {edgeHealth,edgeThresholds,edgeModules,lockedEdgeCapabilities,normalizeEdgeStatus} from './edge-management-policy.js';

const router=Router(),uuid=z.string().uuid();
const configuration=z.object({
 heartbeatSeconds:z.number().int().min(10).max(300).optional(),
 inventorySeconds:z.number().int().min(30).max(86400).optional(),
 telemetrySeconds:z.number().int().min(5).max(3600).optional(),
 enabledModules:z.array(z.enum(edgeModules)).max(edgeModules.length).optional(),
});
const createSchema=CreateEdgeDraftBody.merge(configuration).extend({
 edgeId:z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/),
 name:z.string().trim().min(2).max(120),siteCode:z.string().trim().min(1).max(100),
 organizationId:uuid.optional(),buildingId:uuid.optional(),blockId:uuid.optional(),
 description:z.string().max(2000).optional(),
 projectName:z.string().trim().max(120).optional(),
 environment:z.enum(['unknown','test','staging','production']).optional(),
}).strict().refine(v=>!!v.buildingId!==!!v.blockId,{message:'Choose a v1 building or a v2 block'});
const updateSchema=UpdateEdgeNodeMetadataBody.merge(configuration).extend({
 name:z.string().trim().min(2).max(120).optional(),
 siteCode:z.string().trim().min(1).max(100).optional(),description:z.string().max(2000).optional(),
 projectName:z.string().trim().max(120).optional(),
 environment:z.enum(['unknown','test','staging','production']).optional(),
}).strict().refine(v=>Object.keys(v).length>0);

async function scope(req:Request,permission?:string){
 const identity=await context(req);
 const key=permission??['edge.read','edge.inventory.read','edge.health.read'].find(p=>identity.permissions.includes(p));
 if(!key)throw new ApiError(403,'edge_read_required');
 const c=await requirePermission(req,key);
 if(!c.organization_id&&!c.permissions.includes('edge.fleet.read'))throw new ApiError(403,'organization_scope_required');
 return c;
}
async function scopedNode(req:Request,permission?:string){
 const c=await scope(req,permission),id=uuid.parse(req.params.id);
 const node=(await pool.query(`SELECT n.*,o.name AS organization_name,b.name AS building_name,bl.name AS block_name,
 EXISTS(SELECT 1 FROM edge_credentials cr WHERE cr.edge_node_id=n.id AND cr.status='active'
  AND (cr.expires_at IS NULL OR cr.expires_at>now())) AS credential_active,
 (SELECT max(cr.issued_at) FROM edge_credentials cr WHERE cr.edge_node_id=n.id) AS credential_issued_at,
 (SELECT CASE WHEN cr.status='active' AND cr.expires_at<=now() THEN 'EXPIRED' ELSE upper(cr.status) END
  FROM edge_credentials cr WHERE cr.edge_node_id=n.id ORDER BY cr.version DESC LIMIT 1) AS credential_state
 FROM edge_nodes n JOIN organizations o ON o.id=n.organization_id
 LEFT JOIN buildings b ON b.id=n.building_id LEFT JOIN edge_blocks bl ON bl.id=n.block_id
 WHERE n.id=$1 AND ($2::uuid IS NULL OR n.organization_id=$2)
 AND ($3::uuid IS NULL OR EXISTS(SELECT 1 FROM edge_node_buildings nb
  WHERE nb.edge_node_id=n.id AND nb.building_id=$3))`,
 [id,c.organization_id,c.building_id])).rows[0];
 if(!node)throw new ApiError(404,'edge_not_found');
 // A building-scoped operator must not use one matching building to manage an entire block.
 if(c.building_id){
  const outside=await pool.query('SELECT 1 FROM edge_node_buildings WHERE edge_node_id=$1 AND building_id<>$2 LIMIT 1',[node.id,c.building_id]);
  if(outside.rowCount)throw new ApiError(403,'building_scope_mismatch');
 }
 return {c,node};
}
const can=(c:Context,p:string)=>c.permissions.includes(p);
const configResult=(node:any)=>({...node.management_config,description:node.description,
 lockedCapabilities:lockedEdgeCapabilities,thresholds:edgeThresholds(node)});
const pageSchema=z.object({
 page:z.coerce.number().int().min(1).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(25),
 search:z.string().max(200).default(''),organizationId:uuid.optional(),blockId:uuid.optional(),buildingId:uuid.optional(),
 status:z.enum(['ONLINE','OFFLINE','DEGRADED','UNKNOWN','DISABLED']).optional(),
 registration:z.enum(['PENDING_REGISTRATION','REGISTERED','REVOKED']).optional(),
 project:z.string().max(120).optional(),environment:z.enum(['unknown','test','staging','production']).optional(),
 websocket:z.enum(['CONNECTED','DISCONNECTED']).optional(),version:z.string().max(80).optional(),
 includeArchived:z.enum(['true','false']).optional(),
});

router.get('/edge-console/fleet',async(req,res)=>{
 const c=await scope(req),q=pageSchema.parse(req.query);
 if(c.organization_id&&q.organizationId&&q.organizationId!==c.organization_id)throw new ApiError(403,'organization_scope_mismatch');
 const rows=(await pool.query(`SELECT n.*,o.name AS organization_name,b.name AS building_name,bl.name AS block_name,
 EXISTS(SELECT 1 FROM edge_credentials cr WHERE cr.edge_node_id=n.id AND cr.status='active'
  AND (cr.expires_at IS NULL OR cr.expires_at>now())) AS credential_active,
 (SELECT count(*)::int FROM edge_node_buildings nb WHERE nb.edge_node_id=n.id) AS building_count,
 (SELECT count(*)::int FROM edge_device_inventory d WHERE d.edge_node_id=n.id) AS device_count,
 (SELECT count(*)::int FROM edge_alarms a WHERE a.edge_node_id=n.id AND a.status='active') AS active_alarms,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('id',b2.id,'name',b2.name)) FROM edge_node_buildings nb
 JOIN buildings b2 ON b2.id=nb.building_id WHERE nb.edge_node_id=n.id),'[]'::jsonb) AS buildings
 FROM edge_nodes n JOIN organizations o ON o.id=n.organization_id LEFT JOIN buildings b ON b.id=n.building_id
 LEFT JOIN edge_blocks bl ON bl.id=n.block_id
 WHERE ($1::uuid IS NULL OR n.organization_id=$1)
 AND ($2::uuid IS NULL OR EXISTS(SELECT 1 FROM edge_node_buildings nb WHERE nb.edge_node_id=n.id AND nb.building_id=$2))
 AND ($2::uuid IS NULL OR NOT EXISTS(SELECT 1 FROM edge_node_buildings nb WHERE nb.edge_node_id=n.id AND nb.building_id<>$2))
 AND ($3::boolean OR n.archived_at IS NULL) ORDER BY n.name,n.id`,
 [c.organization_id,c.building_id,q.includeArchived==='true'])).rows.map(n=>{
  const connected=isEdgeConnected(n.id);
  return {...n,status:normalizeEdgeStatus(n,connected),web_socket_open:connected};
 });
 const unique=(items:{id:string;name:string}[])=>[...new Map(items.filter(i=>i.id).map(i=>[i.id,i])).values()];
 const facets={
 organizations:unique(rows.map(n=>({id:n.organization_id,name:n.organization_name}))),
 blocks:unique(rows.map(n=>({id:n.block_id,name:n.block_name}))),
 buildings:unique(rows.flatMap(n=>n.buildings)),
 versions:[...new Set(rows.map(n=>n.agent_version).filter(Boolean))],
 projects:[...new Set(rows.map(n=>n.project_name).filter(Boolean))],
 environments:[...new Set(rows.map(n=>n.environment).filter(Boolean))],
 };
 const search=q.search.toLowerCase();
 const filtered=rows.filter(n=>
  (!q.organizationId||n.organization_id===q.organizationId)&&(!q.blockId||n.block_id===q.blockId)&&
  (!q.buildingId||n.buildings.some((b:any)=>b.id===q.buildingId))&&(!q.status||n.status===q.status)&&
  (!q.websocket||n.web_socket_open===(q.websocket==='CONNECTED'))&&(!q.version||n.agent_version===q.version)&&
  (!q.registration||n.registration_state===q.registration)&&(!q.project||n.project_name===q.project)&&
  (!q.environment||n.environment===q.environment)&&
  (!search||[n.name,n.edge_id,n.site_code,n.organization_name,n.block_name,...n.buildings.map((b:any)=>b.name)].some(v=>String(v??'').toLowerCase().includes(search)))
 );
 const active=filtered.filter(n=>!n.archived_at);
 const times=active.flatMap(n=>[n.last_inventory_at,n.last_telemetry_at,n.last_event_at,n.last_alarm_at]).filter(Boolean).map(v=>new Date(v).getTime());
 res.json({
 nodes:filtered.slice((q.page-1)*q.pageSize,q.page*q.pageSize),facets,
 pagination:{page:q.page,pageSize:q.pageSize,total:filtered.length,pages:Math.ceil(filtered.length/q.pageSize)},
 summary:{total:active.length,online:active.filter(n=>n.status==='ONLINE').length,offline:active.filter(n=>n.status==='OFFLINE').length,
 degraded:active.filter(n=>n.status==='DEGRADED').length,waiting:active.filter(n=>n.registration_state==='PENDING_REGISTRATION').length,
 syncErrors:active.filter(n=>{const t=edgeThresholds(n);return n.queue_depth>=t.warningQueueDepth||
  (n.last_inventory_at&&Date.now()-new Date(n.last_inventory_at).getTime()>t.inventoryStaleAfterSeconds*1000)||
  (n.last_telemetry_at&&Date.now()-new Date(n.last_telemetry_at).getTime()>t.telemetryStaleAfterSeconds*1000)}).length,
 activeAlarms:active.reduce((s,n)=>s+n.active_alarms,0),
 devices:active.reduce((s,n)=>s+n.device_count,0),lastSync:times.length?new Date(Math.max(...times)).toISOString():null},
 });
});

router.post('/edge-console/nodes',async(req,res)=>{
 const c=await scope(req,'edge.manage');requireRecentAuthentication(req);
 const v=createSchema.parse(req.body),org=c.organization_id??v.organizationId;
 if(!org)throw new ApiError(400,'organization_required');
 if(c.organization_id&&v.organizationId&&v.organizationId!==c.organization_id)throw new ApiError(403,'organization_scope_mismatch');
 const result=await transaction(async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[v.edgeId]);
  const existing=await db.query('SELECT 1 FROM edge_nodes WHERE edge_id=$1',[v.edgeId]);
  if(existing.rowCount)throw new ApiError(409,'edge_already_registered');
  let buildings:{id:string;name:string}[];
  if(v.blockId){
   const block=await db.query('SELECT id FROM edge_blocks WHERE id=$1 AND organization_id=$2 AND archived_at IS NULL FOR UPDATE',[v.blockId,org]);
   if(!block.rowCount)throw new ApiError(404,'edge_block_not_found');
   buildings=(await db.query(`SELECT b.id,b.name FROM edge_block_buildings bb JOIN buildings b ON b.id=bb.building_id
    WHERE bb.block_id=$1 AND bb.organization_id=$2 ORDER BY b.name`,[v.blockId,org])).rows;
  }else{
   buildings=(await db.query('SELECT id,name FROM buildings WHERE id=$1 AND organization_id=$2 FOR UPDATE',[v.buildingId,org])).rows;
   if((await db.query('SELECT 1 FROM edge_nodes WHERE building_id=$1',[v.buildingId])).rowCount)
    throw new ApiError(409,'edge_already_registered');
  }
  if(!buildings.length)throw new ApiError(400,'building_not_found');
  if(c.building_id&&buildings.some(b=>b.id!==c.building_id))throw new ApiError(403,'building_scope_mismatch');
  const cfg={heartbeatSeconds:v.heartbeatSeconds??30,inventorySeconds:v.inventorySeconds??300,
   telemetrySeconds:v.telemetrySeconds??30,enabledModules:v.enabledModules??[]};
  const node=(await db.query(`INSERT INTO edge_nodes(edge_id,organization_id,building_id,block_id,protocol_version,
   name,site_code,description,management_config,project_name,environment,registration_state)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'PENDING_REGISTRATION') RETURNING *`,
   [v.edgeId,org,v.buildingId??null,v.blockId??null,v.blockId?2:1,v.name,v.siteCode,v.description??'',JSON.stringify(cfg),v.projectName??'',v.environment??'unknown'])).rows[0];
  for(const b of buildings)await db.query(`INSERT INTO edge_node_buildings(edge_node_id,organization_id,building_id,block_id)
   VALUES($1,$2,$3,$4)`,[node.id,org,b.id,v.blockId??null]);
  await record(db,req,{...c,organization_id:org},'edge.node.create','edge_node',node.id,{edgeId:v.edgeId,buildingCount:buildings.length});
  return {...node,buildings};
 });
 res.status(201).json(result);
});

router.post('/edge-console/nodes/:id/bootstrap-token',async(req,res)=>{
 const {c,node}=await scopedNode(req,'edge.bootstrap.create');requireRecentAuthentication(req);
 const {expiresInMinutes}=GenerateEdgeDraftTokenBody.extend({expiresInMinutes:z.number().int().min(5).max(120).default(30)}).strict().parse(req.body??{});
 if(node.archived_at||node.registration_state!=='PENDING_REGISTRATION')throw new ApiError(409,'edge_already_registered');
 const plaintext=`vne_bootstrap_${randomBytes(32).toString('base64url')}`,expiresAt=new Date(Date.now()+expiresInMinutes*60000);
 const result=await transaction(async db=>{
  // Machine registration locks its bootstrap token before its node. Keep the
  // same order so regeneration cannot deadlock a simultaneous registration.
  await db.query('SELECT id FROM edge_bootstrap_tokens WHERE edge_id=$1 ORDER BY id FOR UPDATE',[node.edge_id]);
  const locked=(await db.query('SELECT * FROM edge_nodes WHERE id=$1 FOR UPDATE',[node.id])).rows[0];
  if(locked.archived_at||locked.registration_state!=='PENDING_REGISTRATION')throw new ApiError(409,'edge_already_registered');
  // A new one-time value explicitly replaces any unconsumed value; the old one cannot be recovered.
  const revoked=await db.query(`UPDATE edge_bootstrap_tokens SET revoked_at=now()
   WHERE edge_id=$1 AND used_at IS NULL AND revoked_at IS NULL RETURNING id`,[node.edge_id]);
  for(const previous of revoked.rows)await record(db,req,{...c,organization_id:node.organization_id},
   'edge.bootstrap.revoke','edge_bootstrap_token',previous.id,{reason:'replaced_by_generation'});
  const token=(await db.query(`INSERT INTO edge_bootstrap_tokens(edge_id,organization_id,building_id,block_id,
   protocol_version,edge_name,site_code,token_hash,expires_at,created_by_user_id)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id,edge_id,organization_id,building_id,block_id,
   protocol_version,edge_name,site_code,expires_at,created_at`,
   [node.edge_id,node.organization_id,node.building_id,node.block_id,node.protocol_version,node.name,node.site_code,
    createHash('sha256').update(plaintext).digest('hex'),expiresAt,req.user!.id])).rows[0];
  await record(db,req,{...c,organization_id:node.organization_id},'edge.bootstrap.create','edge_bootstrap_token',token.id,{edgeId:node.edge_id,expiresAt});
  return token;
 });
 const buildings=(await pool.query(`SELECT b.id,b.name FROM edge_node_buildings nb JOIN buildings b ON b.id=nb.building_id
  WHERE nb.edge_node_id=$1 ORDER BY b.name`,[node.id])).rows;
 res.status(201).json({...result,buildings,bootstrapToken:plaintext,oneTime:true});
});

router.patch('/edge-console/nodes/:id',async(req,res)=>{
 const {c,node}=await scopedNode(req,'edge.manage');requireRecentAuthentication(req);
 if(node.archived_at)throw new ApiError(409,'edge_node_archived');
 const v=updateSchema.parse(req.body);
 if(Object.keys(configuration.parse(Object.fromEntries(Object.entries(v).filter(([k])=>k in configuration.shape)))).length)
  await requirePermission(req,'edge.config.manage');
 const result=await transaction(async db=>{
  if(v.name||v.siteCode)
   await db.query('SELECT id FROM edge_bootstrap_tokens WHERE edge_id=$1 ORDER BY id FOR UPDATE',[node.edge_id]);
  const current=(await db.query('SELECT * FROM edge_nodes WHERE id=$1 FOR UPDATE',[node.id])).rows[0];
  if(current.archived_at)throw new ApiError(409,'edge_node_archived');
  const cfg={...current.management_config,...Object.fromEntries(Object.entries(v).filter(([k])=>k in configuration.shape))};
  const updated=(await db.query(`UPDATE edge_nodes SET name=$2,site_code=$3,description=$4,management_config=$5,project_name=$6,environment=$7,
   config_version=config_version+1,updated_at=now() WHERE id=$1 RETURNING *`,
   [node.id,v.name??current.name,v.siteCode??current.site_code,v.description??current.description,JSON.stringify(cfg),v.projectName??current.project_name,v.environment??current.environment])).rows[0];
  // Pending setup must still match the latest editable name/site binding.
  if(current.registration_state==='PENDING_REGISTRATION'&&(v.name||v.siteCode)){
   await db.query(`UPDATE edge_bootstrap_tokens SET revoked_at=now() WHERE edge_id=$1 AND used_at IS NULL AND revoked_at IS NULL`,[node.edge_id]);
  }
  await record(db,req,{...c,organization_id:node.organization_id},'edge.config.update','edge_node',node.id,{fields:Object.keys(v)});
  return updated;
 });
 res.json(result);
});

router.get('/edge-console/nodes/:id/buildings',async(req,res)=>{
 const {node}=await scopedNode(req);
 res.json((await pool.query(`SELECT b.id,b.name,b.address,b.id=n.building_id AS is_primary FROM edge_node_buildings nb
  JOIN buildings b ON b.id=nb.building_id JOIN edge_nodes n ON n.id=nb.edge_node_id WHERE n.id=$1 ORDER BY b.name`,[node.id])).rows);
});
router.patch('/edge-console/nodes/:id/buildings',async(req,res)=>{
 const {c,node}=await scopedNode(req,'edge.manage');requireRecentAuthentication(req);
 if(node.protocol_version!==2)throw new ApiError(409,'v1_building_scope_immutable');
 if(node.archived_at)throw new ApiError(409,'edge_node_archived');
 const v=UpdateEdgeBoundBuildingsBody.extend({buildingIds:z.array(uuid).min(1).max(1000),primaryBuildingId:uuid.optional()}).strict().parse(req.body);
 if(v.primaryBuildingId)throw new ApiError(400,'v2_uses_explicit_buildings_not_primary');
 if(c.building_id&&v.buildingIds.some(id=>id!==c.building_id))throw new ApiError(403,'building_scope_mismatch');
 const ids=[...new Set(v.buildingIds)];
 if(ids.length!==v.buildingIds.length)throw new ApiError(400,'duplicate_building');
 await transaction(async db=>{
  const current=(await db.query('SELECT archived_at FROM edge_nodes WHERE id=$1 FOR UPDATE',[node.id])).rows[0];
  if(current.archived_at)throw new ApiError(409,'edge_node_archived');
  const matches=await db.query(`SELECT building_id FROM edge_block_buildings WHERE block_id=$1 AND organization_id=$2
   AND building_id=ANY($3::uuid[])`,[node.block_id,node.organization_id,ids]);
  if(matches.rowCount!==ids.length)throw new ApiError(400,'building_outside_edge_block');
  const referenced=await db.query(`SELECT 1 FROM edge_device_inventory WHERE edge_node_id=$1 AND NOT(building_id=ANY($2::uuid[]))
   UNION ALL SELECT 1 FROM edge_commands WHERE edge_node_id=$1 AND NOT(building_id=ANY($2::uuid[]))
   UNION ALL SELECT 1 FROM edge_events WHERE edge_node_id=$1 AND NOT(building_id=ANY($2::uuid[]))
   UNION ALL SELECT 1 FROM edge_alarms WHERE edge_node_id=$1 AND NOT(building_id=ANY($2::uuid[])) LIMIT 1`,[node.id,ids]);
  if(referenced.rowCount)throw new ApiError(409,'building_has_edge_history');
  await db.query('DELETE FROM edge_node_buildings WHERE edge_node_id=$1 AND NOT(building_id=ANY($2::uuid[]))',[node.id,ids]);
  for(const id of ids)await db.query(`INSERT INTO edge_node_buildings(edge_node_id,organization_id,building_id,block_id)
   VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,[node.id,node.organization_id,id,node.block_id]);
  await db.query('UPDATE edge_nodes SET config_version=config_version+1 WHERE id=$1',[node.id]);
  await record(db,req,{...c,organization_id:node.organization_id},'edge.buildings.update','edge_node',node.id,{buildingIds:ids});
 });
 res.json({buildingIds:ids});
});

router.get('/edge-console/nodes/:id/connection-check',async(req,res)=>{
 const {c,node}=await scopedNode(req),now=Date.now(),connected=isEdgeConnected(node.id);
 const age=node.last_heartbeat_at?Math.max(0,Math.floor((now-new Date(node.last_heartbeat_at).getTime())/1000)):null;
 const sync=(at:string|null,threshold?:number)=>({status:!at?'UNKNOWN':threshold&&(now-new Date(at).getTime())/1000>threshold?'WARNING':'OK',lastReceivedAt:at});
 const checks={
 cloud:{status:'OK'},registration:{status:node.registration_state==='REGISTERED'?'OK':'FAILED',state:node.registration_state},
 credential:{status:node.credential_active?'OK':'FAILED'},websocket:{status:connected?'OK':'FAILED'},
 heartbeat:{status:age===null?'UNKNOWN':age<=edgeThresholds(node).offlineAfterSeconds?'OK':'FAILED',lastSeenAt:node.last_heartbeat_at,ageSeconds:age},
 inventory:sync(node.last_inventory_at,edgeThresholds(node).inventoryStaleAfterSeconds),telemetry:sync(node.last_telemetry_at,edgeThresholds(node).telemetryStaleAfterSeconds),
 events:sync(node.last_event_at),alarms:sync(node.last_alarm_at),
 queue:{status:node.last_seen_at?(node.queue_depth>=edgeHealth.criticalQueueDepth?'FAILED':node.queue_depth>=edgeHealth.warningQueueDepth?'WARNING':'OK'):'UNKNOWN',depth:node.last_seen_at?node.queue_depth:null},
 localAuthorization:{status:node.local_authorization_status==='OK'?'OK':node.local_authorization_status==='UNKNOWN'?'UNKNOWN':'FAILED'},
 };
 const statuses=Object.values(checks).map(v=>v.status),overallStatus=statuses.includes('FAILED')?'FAILED':statuses.includes('WARNING')?'WARNING':statuses.includes('UNKNOWN')?'UNKNOWN':'OK';
 await transaction(db=>record(db,req,{...c,organization_id:node.organization_id},'edge.connection.test','edge_node',node.id,{overallStatus}));
 res.json({edgeId:node.edge_id,checkedAt:new Date(now).toISOString(),overallStatus,checks,
  webSocketOpen:connected,heartbeatFresh:age!==null&&age<=edgeHealth.offlineAfterSeconds,heartbeatAgeSeconds:age,
  reachable:connected&&age!==null&&age<=edgeHealth.offlineAfterSeconds,probe:'server_observed_state_no_device_commands'});
});

router.get('/edge-console/nodes/:id',async(req,res)=>{
 const {c,node}=await scopedNode(req),id=node.id;
 const [buildings,devices,alarms,telemetry,events,commands,audit,tokens]=await Promise.all([
  pool.query(`SELECT b.id,b.name,b.address,b.id=$2::uuid AS is_primary FROM edge_node_buildings nb JOIN buildings b ON b.id=nb.building_id
   WHERE nb.edge_node_id=$1 ORDER BY b.name`,[id,node.building_id]),
  can(c,'edge.inventory.read')?pool.query(`SELECT d.*,b.name AS building_name,
   COALESCE((SELECT jsonb_agg(jsonb_build_object('unitId',a.unit_id,'allowedCapabilities',a.allowed_capabilities))
    FROM edge_device_access a WHERE a.device_id=d.id),'[]'::jsonb) AS access_units,
   (SELECT max(e.received_at) FROM edge_events e WHERE e.device_inventory_id=d.id) AS last_event_at,
   (SELECT max(a.received_at) FROM edge_alarms a WHERE a.device_inventory_id=d.id) AS last_alarm_at
   FROM edge_device_inventory d JOIN buildings b ON b.id=d.building_id
   WHERE d.edge_node_id=$1 ORDER BY d.name LIMIT 500`,[id]):{rows:[]},
  can(c,'edge.alarms.read')?pool.query(`SELECT a.*,d.name AS device_name,b.name AS building_name FROM edge_alarms a
   LEFT JOIN edge_device_inventory d ON d.id=a.device_inventory_id JOIN buildings b ON b.id=a.building_id
   WHERE a.edge_node_id=$1 ORDER BY a.received_at DESC LIMIT 100`,[id]):{rows:[]},
  can(c,'edge.inventory.read')?pool.query(`SELECT t.*,d.name AS device_name,d.edge_device_id,d.building_id,b.name AS building_name
   FROM edge_telemetry_current t JOIN edge_device_inventory d ON d.id=t.device_inventory_id JOIN buildings b ON b.id=d.building_id
   WHERE d.edge_node_id=$1 ORDER BY t.received_at DESC LIMIT 100`,[id]):{rows:[]},
  can(c,'edge.events.read')?pool.query(`SELECT e.*,d.name AS device_name,b.name AS building_name FROM edge_events e
   LEFT JOIN edge_device_inventory d ON d.id=e.device_inventory_id JOIN buildings b ON b.id=e.building_id
   WHERE e.edge_node_id=$1 ORDER BY e.received_at DESC LIMIT 100`,[id]):{rows:[]},
  can(c,'edge.commands.read')?pool.query(`SELECT command_id,requested_at,requested_role,source_product,capability,authorization_decision,
   authorization_reason,status,error_code,completed_at,delivered_at,acknowledged_at,edge_device_id,reason,requested_by_user_id,
   (SELECT name FROM users WHERE id=requested_by_user_id) AS actor_name,
   result_json->>'status' AS edge_decision,EXTRACT(epoch FROM(completed_at-requested_at))*1000 AS duration_ms
   FROM edge_commands WHERE edge_node_id=$1 ORDER BY requested_at DESC LIMIT 100`,[id]):{rows:[]},
  can(c,'edge.commands.audit')?pool.query(`SELECT a.id,a.created_at,a.actor_user_id,u.name AS actor,a.action,a.entity_type,a.entity_id,a.details
   FROM audit_events a LEFT JOIN users u ON u.id=a.actor_user_id WHERE a.organization_id=$2 AND
   (a.entity_id=$1 OR (a.entity_type='edge_bootstrap_token' AND a.entity_id IN(SELECT id::text FROM edge_bootstrap_tokens WHERE edge_id=$3)))
   ORDER BY a.created_at DESC LIMIT 100`,[id,node.organization_id,node.edge_id]):{rows:[]},
  can(c,'edge.bootstrap.create')?pool.query(`SELECT id,edge_id,edge_name,site_code,created_at,expires_at,used_at,revoked_at,
   CASE WHEN used_at IS NOT NULL THEN 'USED' WHEN revoked_at IS NOT NULL THEN 'REVOKED'
   WHEN expires_at<=now() THEN 'EXPIRED' ELSE 'PENDING' END AS status
   FROM edge_bootstrap_tokens WHERE edge_id=$1 ORDER BY created_at DESC LIMIT 20`,[node.edge_id]):{rows:[]},
 ]);
 const connected=isEdgeConnected(id);
 res.json({node:{...node,status:normalizeEdgeStatus(node,connected),web_socket_open:connected,building_count:buildings.rows.length,
  device_count:devices.rows.length,active_alarms:alarms.rows.filter(a=>a.status==='active').length},
  buildings:buildings.rows,devices:devices.rows,alarms:alarms.rows,telemetry:telemetry.rows,events:events.rows,
  commands:commands.rows,audit:audit.rows,tokens:tokens.rows,configuration:configResult(node),
  limits:{devices:500,history:100,tokens:20}});
});
export default router;
