import {Router,type Request,type RequestHandler} from 'express';
import {createHash,randomBytes} from 'node:crypto';
import {z} from 'zod';
import {pool} from './db.js';
import {ApiError,context,requireAuth,requirePermission} from './access.js';
import {requireRecentAuthentication} from './recent-auth.js';
import {transaction,record} from './operations.js';
import {closeEdgeConnection} from './edge-sockets.js';
import {requestEdgeCommand} from './edge-command-service.js';
import edgeWorkspaceRouter from './edge-workspace-api.js';

const router=Router();
router.use(edgeWorkspaceRouter);
const uuid=z.string().uuid();
const edgeId=z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/);
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const bootstrapSchema=z.object({
 organizationId:uuid.optional(),buildingId:uuid,edgeId,name:z.string().trim().min(2).max(120),
 siteCode:z.string().trim().min(1).max(100),expiresInMinutes:z.number().int().min(5).max(120).default(30)
}).strict();
const blockSchema=z.object({
 organizationId:uuid.optional(),code:z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/),
 name:z.string().trim().min(2).max(120),buildingIds:z.array(uuid).min(1).max(1000)
}).strict();
const blockBootstrapSchema=z.object({
 edgeId,name:z.string().trim().min(2).max(120),siteCode:z.string().trim().min(1).max(100),
 expiresInMinutes:z.number().int().min(5).max(120).default(30)
}).strict();
const blockUpdateSchema=z.object({
 code:z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/).optional(),
 name:z.string().trim().min(2).max(120).optional(),
 buildingIds:z.array(uuid).min(1).max(1000).optional()
}).strict().refine(value=>Object.keys(value).length>0);
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
 if(c.building_id){params.push(c.building_id);where+=` AND EXISTS(
  SELECT 1 FROM edge_node_buildings scope WHERE scope.edge_node_id=n.id
   AND scope.organization_id=n.organization_id AND scope.building_id=$${params.length})`}
 const result=await pool.query(`SELECT n.* FROM edge_nodes n WHERE ${where}`,params);
 if(!result.rowCount)throw new ApiError(404,'edge_not_found');
 if(c.building_id&&(await pool.query(`SELECT 1 FROM edge_node_buildings
  WHERE edge_node_id=$1 AND building_id<>$2 LIMIT 1`,[id,c.building_id])).rowCount)
  throw new ApiError(404,'edge_not_found');
 return {context:c,node:result.rows[0]};
}

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
router.get('/edge-console/blocks',async(req,res)=>{
 const c=await requirePermission(req,'edge.bootstrap.create');
 if(!c.organization_id&&!c.permissions.includes('edge.fleet.read'))throw new ApiError(403,'organization_scope_required');
 const values:any[]=[];let where='TRUE';
 if(c.organization_id){values.push(c.organization_id);where=`b.organization_id=$${values.length}`}
 if(c.building_id){values.push(c.building_id);where+=` AND EXISTS(
  SELECT 1 FROM edge_block_buildings allowed WHERE allowed.block_id=b.id AND allowed.building_id=$${values.length})
  AND NOT EXISTS(SELECT 1 FROM edge_block_buildings other WHERE other.block_id=b.id AND other.building_id<>$${values.length})`}
 if(req.query.includeArchived!=='true')where+=` AND b.archived_at IS NULL`;
 const result=await pool.query(`SELECT b.id,b.organization_id,b.code,b.name,b.created_at,
  b.archived_at,
  o.name AS organization_name,count(DISTINCT bb.building_id)::int AS building_count,
  count(DISTINCT n.id)::int AS edge_node_count,
  COALESCE(jsonb_agg(DISTINCT jsonb_build_object('id',bl.id,'name',bl.name)) FILTER(WHERE bl.id IS NOT NULL),'[]'::jsonb) AS buildings
  FROM edge_blocks b JOIN organizations o ON o.id=b.organization_id
  LEFT JOIN edge_block_buildings bb ON bb.block_id=b.id AND bb.organization_id=b.organization_id
  LEFT JOIN buildings bl ON bl.id=bb.building_id
  LEFT JOIN edge_nodes n ON n.block_id=b.id AND n.organization_id=b.organization_id
  WHERE ${where} GROUP BY b.id,o.name ORDER BY o.name,b.name`,values);
 res.json({blocks:result.rows});
});
router.post('/edge-console/blocks',async(req,res)=>{
 const c=await requirePermission(req,'edge.bootstrap.create');requireRecentAuthentication(req);
 const input=blockSchema.parse(req.body);
 const organizationId=c.organization_id??input.organizationId;
 if(!organizationId)throw new ApiError(400,'organization_required');
 if(c.organization_id&&input.organizationId&&input.organizationId!==c.organization_id)throw new ApiError(403,'organization_scope_mismatch');
 if(c.building_id&&input.buildingIds.some(id=>id!==c.building_id))throw new ApiError(403,'building_scope_mismatch');
 const uniqueIds=[...new Set(input.buildingIds)];
 if(uniqueIds.length!==input.buildingIds.length)throw new ApiError(400,'duplicate_building');
 const result=await transaction(async db=>{
  const codeExists=await db.query('SELECT 1 FROM edge_blocks WHERE organization_id=$1 AND code=$2',[organizationId,input.code]);
  if(codeExists.rowCount)throw new ApiError(409,'edge_block_code_exists');
  const buildings=await db.query(`SELECT id FROM buildings WHERE organization_id=$1 AND id=ANY($2::uuid[]) FOR UPDATE`,
   [organizationId,uniqueIds]);
  if(buildings.rowCount!==uniqueIds.length)throw new ApiError(400,'block_buildings_must_share_organization');
  const assigned=await db.query(`SELECT building_id FROM edge_block_buildings
   WHERE organization_id=$1 AND building_id=ANY($2::uuid[]) LIMIT 1`,[organizationId,uniqueIds]);
  if(assigned.rowCount)throw new ApiError(409,'building_already_assigned_to_block');
  const block=(await db.query(`INSERT INTO edge_blocks(organization_id,code,name,created_by_user_id)
   VALUES($1,$2,$3,$4) RETURNING id,organization_id,code,name,created_at`,
   [organizationId,input.code,input.name,req.user!.id])).rows[0];
  for(const buildingId of uniqueIds)await db.query(`INSERT INTO edge_block_buildings(block_id,organization_id,building_id)
   VALUES($1,$2,$3)`,[block.id,organizationId,buildingId]);
  await record(db,req,{...c,organization_id:organizationId},'edge.block.create','edge_block',block.id,
   {code:input.code,buildingCount:uniqueIds.length});
  return {...block,buildingIds:uniqueIds};
 });
 res.status(201).json(result);
});
router.patch('/edge-console/blocks/:id',async(req,res)=>{
 const c=await requirePermission(req,'edge.manage');requireRecentAuthentication(req);
 if(!c.organization_id&&!c.permissions.includes('edge.fleet.read'))throw new ApiError(403,'organization_scope_required');
 const blockId=uuid.parse(req.params.id),input=blockUpdateSchema.parse(req.body);
 if(c.building_id&&input.buildingIds?.some(id=>id!==c.building_id))throw new ApiError(403,'building_scope_mismatch');
 const values:any[]=[blockId];let where='id=$1';
 if(c.organization_id){values.push(c.organization_id);where+=` AND organization_id=$${values.length}`}
 if(c.building_id){values.push(c.building_id);where+=` AND EXISTS(
   SELECT 1 FROM edge_block_buildings scope WHERE scope.block_id=edge_blocks.id
    AND scope.organization_id=edge_blocks.organization_id AND scope.building_id=$${values.length})`}
 if(c.building_id)where+=` AND NOT EXISTS(SELECT 1 FROM edge_block_buildings other
  WHERE other.block_id=edge_blocks.id AND other.building_id<>$${values.length})`;
 const result=await transaction(async db=>{
  const locked=await db.query(`SELECT id,organization_id,code,name,archived_at FROM edge_blocks
   WHERE ${where} FOR UPDATE`,values);
  if(!locked.rowCount)throw new ApiError(404,'edge_block_not_found');
  if(locked.rows[0].archived_at)throw new ApiError(409,'edge_block_archived');
  const current=locked.rows[0];
  const oldBuildings=await db.query(`SELECT building_id FROM edge_block_buildings
   WHERE block_id=$1 AND organization_id=$2 ORDER BY building_id`,[blockId,current.organization_id]);
  const nextBuildings=input.buildingIds?[...new Set(input.buildingIds)]:oldBuildings.rows.map(row=>row.building_id);
  if(input.buildingIds&&nextBuildings.length!==input.buildingIds.length)throw new ApiError(400,'duplicate_building');
  const changedScope=!!input.buildingIds&&(
   nextBuildings.length!==oldBuildings.rowCount||
   nextBuildings.some(id=>!oldBuildings.rows.some(row=>row.building_id===id))
  );
  if(changedScope){
   const nodes=await db.query('SELECT 1 FROM edge_nodes WHERE block_id=$1 LIMIT 1',[blockId]);
   if(nodes.rowCount)throw new ApiError(409,'edge_block_scope_locked');
   const buildings=await db.query(`SELECT id FROM buildings WHERE organization_id=$1 AND id=ANY($2::uuid[]) FOR UPDATE`,
    [current.organization_id,nextBuildings]);
   if(buildings.rowCount!==nextBuildings.length)throw new ApiError(400,'block_buildings_must_share_organization');
   const assigned=await db.query(`SELECT building_id FROM edge_block_buildings
    WHERE organization_id=$1 AND building_id=ANY($2::uuid[]) AND block_id<>$3 LIMIT 1`,
    [current.organization_id,nextBuildings,blockId]);
   if(assigned.rowCount)throw new ApiError(409,'building_already_assigned_to_block');
   await db.query('DELETE FROM edge_block_buildings WHERE block_id=$1 AND organization_id=$2',[blockId,current.organization_id]);
   for(const buildingId of nextBuildings)await db.query(`INSERT INTO edge_block_buildings(block_id,organization_id,building_id)
    VALUES($1,$2,$3)`,[blockId,current.organization_id,buildingId]);
   await db.query(`UPDATE edge_bootstrap_tokens SET revoked_at=COALESCE(revoked_at,now())
    WHERE block_id=$1 AND used_at IS NULL AND revoked_at IS NULL`,[blockId]);
  }
  const updated=(await db.query(`UPDATE edge_blocks SET code=$2,name=$3
   WHERE id=$1 RETURNING id,organization_id,code,name,created_at,archived_at`,
   [blockId,input.code??current.code,input.name??current.name])).rows[0];
  await record(db,req,{...c,organization_id:current.organization_id},'edge.block.update','edge_block',blockId,
   {code:updated.code,name:updated.name,buildingIdsChanged:changedScope});
  return {...updated,buildingIds:nextBuildings};
 });
 res.json(result);
});
router.delete('/edge-console/blocks/:id',async(req,res)=>{
 const c=await requirePermission(req,'edge.manage');requireRecentAuthentication(req);
 if(!c.organization_id&&!c.permissions.includes('edge.fleet.read'))throw new ApiError(403,'organization_scope_required');
 const blockId=uuid.parse(req.params.id),values:any[]=[blockId];let where='id=$1';
 if(c.organization_id){values.push(c.organization_id);where+=` AND organization_id=$${values.length}`}
 if(c.building_id){values.push(c.building_id);where+=` AND EXISTS(
  SELECT 1 FROM edge_block_buildings scope WHERE scope.block_id=edge_blocks.id
   AND scope.organization_id=edge_blocks.organization_id AND scope.building_id=$${values.length})`}
 if(c.building_id)where+=` AND NOT EXISTS(SELECT 1 FROM edge_block_buildings other
  WHERE other.block_id=edge_blocks.id AND other.building_id<>$${values.length})`;
 const result=await transaction(async db=>{
  const locked=await db.query(`SELECT id,organization_id,archived_at FROM edge_blocks WHERE ${where} FOR UPDATE`,values);
  if(!locked.rowCount)throw new ApiError(404,'edge_block_not_found');
  const block=locked.rows[0];
  if(block.archived_at)return {status:'ARCHIVED',id:blockId};
  const activeNodes=await db.query(`SELECT 1 FROM edge_nodes
   WHERE block_id=$1 AND archived_at IS NULL LIMIT 1`,[blockId]);
  if(activeNodes.rowCount)throw new ApiError(409,'edge_block_has_active_nodes');
  await db.query(`UPDATE edge_bootstrap_tokens SET revoked_at=COALESCE(revoked_at,now())
   WHERE block_id=$1 AND used_at IS NULL AND revoked_at IS NULL`,[blockId]);
  await db.query('UPDATE edge_blocks SET archived_at=now() WHERE id=$1',[blockId]);
  await record(db,req,{...c,organization_id:block.organization_id},'edge.block.archive','edge_block',blockId,{});
  return {status:'ARCHIVED',id:blockId};
 });
 res.json(result);
});
router.post('/edge-console/blocks/:id/restore',async(req,res)=>{
 const c=await requirePermission(req,'edge.manage');requireRecentAuthentication(req);
 if(!c.organization_id&&!c.permissions.includes('edge.fleet.read'))throw new ApiError(403,'organization_scope_required');
 const blockId=uuid.parse(req.params.id),values:any[]=[blockId];let where='id=$1';
 if(c.organization_id){values.push(c.organization_id);where+=` AND organization_id=$${values.length}`}
 if(c.building_id){values.push(c.building_id);where+=` AND EXISTS(
  SELECT 1 FROM edge_block_buildings scope WHERE scope.block_id=edge_blocks.id
   AND scope.organization_id=edge_blocks.organization_id AND scope.building_id=$${values.length})`}
 if(c.building_id)where+=` AND NOT EXISTS(SELECT 1 FROM edge_block_buildings other
  WHERE other.block_id=edge_blocks.id AND other.building_id<>$${values.length})`;
 const result=await transaction(async db=>{
  const row=await db.query(`UPDATE edge_blocks SET archived_at=NULL WHERE ${where} AND archived_at IS NOT NULL
   RETURNING id,organization_id,code,name,created_at,archived_at`,values);
  if(!row.rowCount)throw new ApiError(404,'archived_edge_block_not_found');
  await record(db,req,{...c,organization_id:row.rows[0].organization_id},'edge.block.restore','edge_block',blockId,{});
  return row.rows[0];
 });
 res.json(result);
});
router.get('/edge-console/bootstrap-tokens',async(req,res)=>{
 const c=await requirePermission(req,'edge.bootstrap.create');
 if(!c.organization_id&&!c.permissions.includes('edge.fleet.read'))throw new ApiError(403,'organization_scope_required');
 const values:any[]=[];let where='TRUE';
 if(c.organization_id){values.push(c.organization_id);where=`t.organization_id=$${values.length}`}
  if(c.building_id){values.push(c.building_id);where+=` AND (t.building_id=$${values.length} OR (EXISTS(
  SELECT 1 FROM edge_block_buildings bb WHERE bb.block_id=t.block_id AND bb.organization_id=t.organization_id
    AND bb.building_id=$${values.length}) AND NOT EXISTS(
     SELECT 1 FROM edge_block_buildings other WHERE other.block_id=t.block_id AND other.building_id<>$${values.length})))`}
 const rows=await pool.query(`SELECT t.id,t.edge_id,t.organization_id,t.building_id,t.block_id,t.protocol_version,
  t.edge_name,t.site_code,t.expires_at,t.used_at,t.revoked_at,t.created_at,o.name AS organization_name,
  b.name AS building_name,bl.name AS block_name,
  CASE WHEN t.used_at IS NOT NULL THEN 'USED' WHEN t.revoked_at IS NOT NULL THEN 'REVOKED'
   WHEN t.expires_at<=now() THEN 'EXPIRED' ELSE 'PENDING' END AS status
  FROM edge_bootstrap_tokens t JOIN organizations o ON o.id=t.organization_id
  LEFT JOIN buildings b ON b.id=t.building_id LEFT JOIN edge_blocks bl ON bl.id=t.block_id
  WHERE ${where} ORDER BY t.created_at DESC LIMIT 500`,values);
 res.json({tokens:rows.rows});
});
router.delete('/edge-console/nodes/:id',async(req,res)=>{
 const {context:c,node}=await nodeInScope(req,uuid.parse(req.params.id),'edge.manage');
 requireRecentAuthentication(req);
 await transaction(async db=>{
  await db.query(`UPDATE edge_nodes SET archived_at=COALESCE(archived_at,now()),
   status='DISABLED',registration_state='REVOKED',updated_at=now() WHERE id=$1`,[node.id]);
  await db.query(`UPDATE edge_credentials SET status='revoked',revoked_at=COALESCE(revoked_at,now())
   WHERE edge_node_id=$1 AND status IN ('active','pending')`,[node.id]);
  await db.query(`UPDATE edge_bootstrap_tokens SET revoked_at=COALESCE(revoked_at,now())
   WHERE edge_id=$1 AND used_at IS NULL AND revoked_at IS NULL`,[node.edge_id]);
  await record(db,req,{...c,organization_id:node.organization_id},'edge.node.archive','edge_node',node.id,{edgeId:node.edge_id});
 });
 closeEdgeConnection(node.id);
 res.json({id:node.id,status:'ARCHIVED',historyPreserved:true});
});
router.post('/edge-console/nodes/:id/restore',async(req,res)=>{
 const {context:c,node}=await nodeInScope(req,uuid.parse(req.params.id),'edge.manage');
 requireRecentAuthentication(req);
 const result=await transaction(async db=>{
  const restored=await db.query(`UPDATE edge_nodes SET archived_at=NULL,status='OFFLINE',
   registration_state='REGISTERED',updated_at=now() WHERE id=$1 AND archived_at IS NOT NULL
   RETURNING id,edge_id,name,site_code`,[node.id]);
  if(!restored.rowCount)throw new ApiError(404,'archived_edge_node_not_found');
  await record(db,req,{...c,organization_id:node.organization_id},'edge.node.restore','edge_node',node.id,{edgeId:node.edge_id,credentialsMustBeRotated:true});
  return restored.rows[0];
 });
 res.json({...result,credentialsMustBeRotated:true});
});
router.post('/edge-console/blocks/:id/bootstrap-tokens',async(req,res)=>{
 const c=await requirePermission(req,'edge.bootstrap.create');requireRecentAuthentication(req);
 const blockId=uuid.parse(req.params.id),input=blockBootstrapSchema.parse(req.body);
 const params:any[]=[blockId];let where='id=$1';
 if(c.organization_id){params.push(c.organization_id);where+=` AND organization_id=$${params.length}`}
 const block=await pool.query(`SELECT id,organization_id FROM edge_blocks WHERE ${where}`,params);
 if(!block.rowCount)throw new ApiError(404,'edge_block_not_found');
 const organizationId=block.rows[0].organization_id;
 if(c.building_id){
  const scope=await pool.query(`SELECT building_id FROM edge_block_buildings
   WHERE block_id=$1 AND organization_id=$2`,[blockId,organizationId]);
  if(scope.rowCount!==1||scope.rows[0].building_id!==c.building_id)
   throw new ApiError(403,'building_scope_mismatch');
 }
 const occupied=await pool.query('SELECT id FROM edge_nodes WHERE edge_id=$1',[input.edgeId]);
 if(occupied.rowCount)throw new ApiError(409,'edge_already_registered');
 const plaintext=`vne_bootstrap_${randomBytes(32).toString('base64url')}`;
 const expiresAt=new Date(Date.now()+input.expiresInMinutes*60_000);
 const token=await transaction(async db=>{
  const active=await db.query(`SELECT id FROM edge_bootstrap_tokens
   WHERE edge_id=$1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at>now()`,[input.edgeId]);
  if(active.rowCount)throw new ApiError(409,'active_bootstrap_token_exists');
  const row=(await db.query(`INSERT INTO edge_bootstrap_tokens
   (edge_id,organization_id,building_id,block_id,protocol_version,edge_name,site_code,token_hash,expires_at,created_by_user_id)
   VALUES($1,$2,NULL,$3,2,$4,$5,$6,$7,$8)
   RETURNING id,edge_id,organization_id,block_id,protocol_version,expires_at,created_at`,
   [input.edgeId,organizationId,blockId,input.name,input.siteCode,hash(plaintext),expiresAt,req.user!.id])).rows[0];
  await record(db,req,{...c,organization_id:organizationId},'edge.bootstrap.v2.create','edge_bootstrap_token',row.id,
   {edgeId:input.edgeId,blockId,protocolVersion:2,expiresAt});
  return row;
 });
 res.status(201).json({...token,bootstrapToken:plaintext,oneTime:true});
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
     AND ($3::uuid IS NULL OR building_id=$3 OR (EXISTS(
     SELECT 1 FROM edge_block_buildings bb WHERE bb.block_id=edge_bootstrap_tokens.block_id
       AND bb.organization_id=edge_bootstrap_tokens.organization_id AND bb.building_id=$3) AND NOT EXISTS(
        SELECT 1 FROM edge_block_buildings other WHERE other.block_id=edge_bootstrap_tokens.block_id AND other.building_id<>$3)))
   RETURNING id,organization_id,edge_id`,[tokenId,c.organization_id,c.building_id]);
  if(!row.rowCount)throw new ApiError(404,'bootstrap_token_not_found');
  await record(db,req,{...c,organization_id:row.rows[0].organization_id},'edge.bootstrap.revoke','edge_bootstrap_token',row.rows[0].id,{edgeId:row.rows[0].edge_id});
  return row.rows[0];
 });
 res.json({status:'REVOKED',id:result.id});
});
router.post('/edge-console/nodes/:id/credentials/rotate',async(req,res)=>{
 const actor=await context(req);
 if(actor.role_key!=='platform_admin'||actor.organization_id)throw new ApiError(403,'platform_edge_security_required');
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
 const actor=await context(req);
 if(actor.role_key!=='platform_admin'||actor.organization_id)throw new ApiError(403,'platform_edge_security_required');
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
 if(!c.organization_id&&!c.permissions.includes('edge.fleet.read'))throw new ApiError(403,'organization_scope_required');
 const deviceId=uuid.parse(req.params.deviceId);
 const result=await transaction(async db=>{
  const target=await db.query(`SELECT id,organization_id,building_id FROM edge_device_inventory
   WHERE id=$1 AND ($2::uuid IS NULL OR organization_id=$2) AND ($3::uuid IS NULL OR building_id=$3) FOR UPDATE`,
   [deviceId,c.organization_id,c.building_id]);
  if(!target.rowCount)throw new ApiError(404,'device_not_found');
  const unit=await db.query(`SELECT id FROM units WHERE id=$1 AND organization_id=$2 AND building_id=$3`,
   [input.unitId,target.rows[0].organization_id,target.rows[0].building_id]);
  if(!unit.rowCount)throw new ApiError(400,'unit_building_mismatch');
  await db.query(`INSERT INTO edge_device_access(device_id,organization_id,building_id,unit_id,allowed_capabilities,created_by_user_id)
   VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(device_id,unit_id) DO UPDATE
   SET allowed_capabilities=EXCLUDED.allowed_capabilities,created_by_user_id=EXCLUDED.created_by_user_id,created_at=now()`,
   [deviceId,target.rows[0].organization_id,target.rows[0].building_id,input.unitId,input.allowedCapabilities,req.user!.id]);
  await record(db,req,{...c,organization_id:target.rows[0].organization_id},'edge.device.access.assign','edge_device',deviceId,{unitId:input.unitId,capabilities:input.allowedCapabilities});
  return {deviceId,unitId:input.unitId,allowedCapabilities:input.allowedCapabilities};
 });
 res.json(result);
});
router.delete('/edge-console/devices/:deviceId/access/:unitId',async(req,res)=>{
 const c=await requirePermission(req,'edge.manage');
 if(!c.organization_id&&!c.permissions.includes('edge.fleet.read'))throw new ApiError(403,'organization_scope_required');
 const deviceId=uuid.parse(req.params.deviceId),unitId=uuid.parse(req.params.unitId);
 const result=await transaction(async db=>{
  const row=await db.query(`DELETE FROM edge_device_access a USING edge_device_inventory d
   WHERE a.device_id=d.id AND a.device_id=$1 AND a.unit_id=$2
    AND ($3::uuid IS NULL OR a.organization_id=$3) AND ($4::uuid IS NULL OR a.building_id=$4)
    RETURNING a.device_id,a.organization_id`,
   [deviceId,unitId,c.organization_id,c.building_id]);
  if(!row.rowCount)throw new ApiError(404,'device_access_not_found');
  await record(db,req,{...c,organization_id:row.rows[0].organization_id},'edge.device.access.revoke','edge_device',deviceId,{unitId});
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
