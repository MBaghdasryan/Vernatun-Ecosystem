import {Router,type Request} from 'express';
import {z} from 'zod';
import {pool} from './db.js';
import {ApiError,context,requireAuth,requirePermission,scopedUnit} from './access.js';
import {transaction,idempotent,record} from './operations.js';
import {accessibleRequests} from './workflow.js';
import {eligiblePeople,priorities} from './core-operation-store.js';
export const coreOperations=Router();coreOperations.use(requireAuth);
const uuid=z.string().uuid(),version=z.number().int().positive(),time=z.string().datetime({offset:true});
async function readScope(req:Request){const c=await context(req);return requirePermission(req,['requests.configure','requests.read','requests.create','requests.own','workorders.assigned'].find(p=>c.permissions.includes(p))??'requests.read')}
coreOperations.get('/operations/categories',async(req,res)=>{const c=await readScope(req);res.json((await pool.query('SELECT * FROM request_categories WHERE organization_id=$1 ORDER BY key',[c.organization_id])).rows)});
coreOperations.post('/operations/categories',async(req,res)=>{
 const c=await requirePermission(req,'requests.configure'),b=z.object({key:z.string().regex(/^[a-z][a-z0-9_]{0,59}$/),name:z.string().trim().min(1).max(160)}).strict().parse(req.body);
 res.status(201).json(await transaction(async db=>{const r=(await db.query('INSERT INTO request_categories(organization_id,key,name) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING *',[c.organization_id,b.key,b.name])).rows[0];if(!r)throw new ApiError(409,'category_exists');await record(db,req,c,'request_category.create','request_category',r.id);return r}));
});
coreOperations.patch('/operations/categories/:id',async(req,res)=>{
 const c=await requirePermission(req,'requests.configure'),id=uuid.parse(req.params.id),b=z.object({version,name:z.string().trim().min(1).max(160),active:z.boolean()}).strict().parse(req.body);
 res.json(await transaction(async db=>{const r=(await db.query('SELECT * FROM request_categories WHERE id=$1 AND organization_id=$2 FOR UPDATE',[id,c.organization_id])).rows[0];if(!r)throw new ApiError(404,'not_found');if(r.version!==b.version)throw new ApiError(409,'stale_version');const result=(await db.query('UPDATE request_categories SET name=$2,active=$3,version=version+1 WHERE id=$1 RETURNING *',[id,b.name,b.active])).rows[0];await record(db,req,c,'request_category.update','request_category',id,{active:b.active});return result}));
});
coreOperations.get('/operations/sla-policies',async(req,res)=>{const c=await readScope(req);res.json((await pool.query('SELECT * FROM sla_policies WHERE organization_id=$1 ORDER BY category_id NULLS FIRST,priority',[c.organization_id])).rows)});
coreOperations.post('/operations/sla-policies',async(req,res)=>{
 const c=await requirePermission(req,'requests.configure'),minutes=z.number().int().min(1).max(43200);
 const b=z.object({categoryId:uuid.nullable(),priority:z.enum(priorities),responseMinutes:minutes,assignmentMinutes:minutes,arrivalMinutes:minutes,resolutionMinutes:minutes,pauseResolution:z.boolean(),version:version.optional()}).strict().parse(req.body);
 res.json(await transaction(async db=>{
  if(b.categoryId&&!(await db.query('SELECT id FROM request_categories WHERE id=$1 AND organization_id=$2',[b.categoryId,c.organization_id])).rowCount)throw new ApiError(404,'not_found');
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['sla-policy:'+c.organization_id+':'+b.categoryId+':'+b.priority]);
  const old=(await db.query('SELECT * FROM sla_policies WHERE organization_id=$1 AND category_id IS NOT DISTINCT FROM $2::uuid AND priority=$3 FOR UPDATE',[c.organization_id,b.categoryId,b.priority])).rows[0];
  if(old&&old.version!==b.version)throw new ApiError(409,'stale_version');
  const r=(await db.query(`INSERT INTO sla_policies(organization_id,category_id,priority,response_minutes,assignment_minutes,arrival_minutes,resolution_minutes,pause_resolution) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
   ON CONFLICT(organization_id,category_id,priority) DO UPDATE SET response_minutes=excluded.response_minutes,assignment_minutes=excluded.assignment_minutes,arrival_minutes=excluded.arrival_minutes,resolution_minutes=excluded.resolution_minutes,pause_resolution=excluded.pause_resolution,version=sla_policies.version+1 RETURNING *`,
   [c.organization_id,b.categoryId,b.priority,b.responseMinutes,b.assignmentMinutes,b.arrivalMinutes,b.resolutionMinutes,b.pauseResolution])).rows[0];
  await record(db,req,c,'sla_policy.save','sla_policy',r.id,{priority:b.priority,categoryId:b.categoryId});return r;
 }));
});
coreOperations.get('/operations/setup',async(req,res)=>{
 const c=await requirePermission(req,'requests.assign'),building=uuid.optional().parse(req.query.buildingId),unitId=uuid.optional().parse(req.query.unitId);
 const buildings=(await pool.query('SELECT id,name FROM buildings WHERE organization_id=$1 AND ($2::uuid IS NULL OR id=$2) AND ($3::uuid IS NULL OR id=(SELECT building_id FROM units WHERE id=$3)) ORDER BY name',[c.organization_id,c.building_id,c.unit_id])).rows;
 if(building&&!buildings.some(b=>b.id===building))throw new ApiError(404,'not_found');
 const units=(await pool.query('SELECT id,number,building_id FROM units WHERE organization_id=$1 AND ($2::uuid IS NULL OR building_id=$2) AND ($3::uuid IS NULL OR id=$3) AND ($4::uuid IS NULL OR building_id=$4) ORDER BY number',[c.organization_id,c.building_id,c.unit_id,building??null])).rows;
 if(unitId){const unit=await scopedUnit(c,unitId);if(building&&unit.building_id!==building)throw new ApiError(404,'not_found');return res.json({buildings,units,residents:await eligiblePeople(pool,c.organization_id!,unit.building_id,unitId,'resident'),technicians:await eligiblePeople(pool,c.organization_id!,unit.building_id,unitId,'technician')})}
 return res.json({buildings,units,residents:[],technicians:[]});
});
async function appendVisit(db:import('pg').PoolClient,req:Request,row:any,action:string){await db.query('INSERT INTO visit_history(visit_id,actor_id,action,snapshot) VALUES($1,$2,$3,$4)',[row.id,req.user!.id,action,JSON.stringify(row)])}
async function incrementRequest(db:import('pg').PoolClient,req:Request,c:any,r:any,action:string,note=''){
 await db.query('UPDATE resident_requests SET version=version+1 WHERE id=$1',[r.id]);
 await db.query('INSERT INTO request_history(request_id,actor_id,actor_role,action,from_status,to_status,note) VALUES($1,$2,$3,$4,$5,$5,$6)',[r.id,req.user!.id,c.role_key,action,r.work_status??r.status,note]);
 await record(db,req,c,'request.'+action,'resident_request',r.id);
}
coreOperations.post('/requests/:id/visits',async(req,res)=>{
 const current=await context(req),c=await requirePermission(req,current.permissions.includes('requests.assign')?'requests.assign':'workorders.execute'),id=uuid.parse(req.params.id),b=z.object({key:uuid,version,startsAt:time,endsAt:time}).strict().parse(req.body);
 res.json(await transaction(async db=>{
  const r=(await accessibleRequests(req,id,db,true))[0];
  if(!c.permissions.includes('requests.assign')&&r.technician_id!==req.user!.id)throw new ApiError(403,'forbidden');
  return idempotent(db,req,b.key,b,async()=>{
   if(r.version!==b.version)throw new ApiError(409,'stale_version');if(r.status==='closed')throw new ApiError(409,'invalid_transition');
   if(Date.parse(b.startsAt)<=Date.now()||Date.parse(b.endsAt)<=Date.parse(b.startsAt)||Date.parse(b.endsAt)-Date.parse(b.startsAt)>86400000)throw new ApiError(400,'invalid_visit_window');
   const previous=(await db.query("UPDATE request_visits SET status='superseded',version=version+1 WHERE request_id=$1 AND status IN('proposed','confirmed') RETURNING *",[id])).rows;
   for(const v of previous)await appendVisit(db,req,v,'rescheduled');
   const needed=(await eligiblePeople(db,r.organization_id,r.building_id,r.unit_id,'resident')).length>0;
   const visit=(await db.query('INSERT INTO request_visits(request_id,starts_at,ends_at,created_by,resident_required) VALUES($1,$2,$3,$4,$5) RETURNING *',[id,b.startsAt,b.endsAt,req.user!.id,needed])).rows[0];
   await appendVisit(db,req,visit,'proposed');await incrementRequest(db,req,c,r,'visit_proposed');
   return {...visit,request_version:r.version+1};
  });
 }));
});
coreOperations.post('/requests/:id/visits/:visitId',async(req,res)=>{
 const id=uuid.parse(req.params.id),vid=uuid.parse(req.params.visitId),b=z.object({key:uuid,version,visitVersion:version,action:z.enum(['confirm','cancel','request_another_time']),note:z.string().trim().max(4000).default(''),suggestedStart:time.optional(),suggestedEnd:time.optional()}).strict().parse(req.body);
 res.json(await transaction(async db=>{
  const r=(await accessibleRequests(req,id,db,true))[0],c=await context(req);
  const resident=c.permissions.includes('requests.own'),tech=c.permissions.includes('workorders.execute')&&r.technician_id===req.user!.id,staff=c.permissions.includes('requests.assign');
  await requirePermission(req,b.action==='confirm'?(resident?'requests.own':'workorders.execute'):staff?'requests.assign':resident?'requests.own':'workorders.execute');
  if(b.action==='request_another_time'&&!resident)throw new ApiError(403,'forbidden');
  if(b.action==='confirm'&&!resident&&!tech||b.action==='cancel'&&!staff&&!resident&&!tech)throw new ApiError(403,'forbidden');
  return idempotent(db,req,b.key,b,async()=>{
   const v=(await db.query('SELECT * FROM request_visits WHERE id=$1 AND request_id=$2 FOR UPDATE',[vid,id])).rows[0];
   if(!v)throw new ApiError(404,'not_found');if(r.version!==b.version||v.version!==b.visitVersion)throw new ApiError(409,'stale_version');
   if(r.status==='closed'||!['proposed','confirmed'].includes(v.status))throw new ApiError(409,'invalid_transition');
   if(b.action==='cancel'&&b.note.length<3)throw new ApiError(400,'reason_required');
   if(b.action==='request_another_time'){
    if(b.note.length<3)throw new ApiError(400,'reason_required');
    if((b.suggestedStart||b.suggestedEnd)&&(!b.suggestedStart||!b.suggestedEnd||Date.parse(b.suggestedStart)<=Date.now()||Date.parse(b.suggestedEnd)<=Date.parse(b.suggestedStart)||Date.parse(b.suggestedEnd)-Date.parse(b.suggestedStart)>86400000))throw new ApiError(400,'invalid_visit_window');
    const result=(await db.query("UPDATE request_visits SET status='cancelled',version=version+1 WHERE id=$1 RETURNING *",[vid])).rows[0];
    if(b.suggestedStart)await db.query('UPDATE resident_requests SET preferred_visit_start=$2,preferred_visit_end=$3 WHERE id=$1',[id,b.suggestedStart,b.suggestedEnd]);
    await appendVisit(db,req,{...result,reason:b.note,suggestedStart:b.suggestedStart??null,suggestedEnd:b.suggestedEnd??null},'reschedule_requested');
    await incrementRequest(db,req,c,r,'visit_request_another_time',b.note);
    return {...result,request_version:r.version+1};
   }
   if(b.action==='confirm'&&(resident?v.resident_confirmed_at:v.technician_confirmed_at))throw new ApiError(409,'already_confirmed');
   if(b.action==='confirm')v[resident?'resident_confirmed_at':'technician_confirmed_at']=new Date().toISOString();
   const status=b.action==='cancel'?'cancelled':v.technician_confirmed_at&&(!v.resident_required||v.resident_confirmed_at)?'confirmed':'proposed';
   const result=(await db.query('UPDATE request_visits SET status=$2,resident_confirmed_at=$3,technician_confirmed_at=$4,version=version+1 WHERE id=$1 RETURNING *',[vid,status,v.resident_confirmed_at,v.technician_confirmed_at])).rows[0];
   await appendVisit(db,req,result,b.action==='cancel'?'cancelled':resident?'resident_confirmed':'technician_confirmed');
   await incrementRequest(db,req,c,r,'visit_'+b.action,b.note);return {...result,request_version:r.version+1};
  });
 }));
});
coreOperations.post('/requests/:id/materials',async(req,res)=>{
 const c=await requirePermission(req,'workorders.execute'),id=uuid.parse(req.params.id);
 const b=z.object({key:uuid,version,kind:z.enum(['material','service']),name:z.string().trim().min(1).max(160),quantity:z.number().min(.001).max(999999999).refine(n=>Math.abs(n*1000-Math.round(n*1000))<.00001),unit:z.string().trim().min(1).max(30),unitCostMinor:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),comment:z.string().trim().max(1000).default('')}).strict().parse(req.body);
 res.status(201).json(await transaction(async db=>{const r=(await accessibleRequests(req,id,db,true))[0];if(r.technician_id!==req.user!.id)throw new ApiError(403,'forbidden');return idempotent(db,req,b.key,b,async()=>{
  if(r.version!==b.version)throw new ApiError(409,'stale_version');if(r.work_status!=='in_progress'||r.paused_at||r.blocked_reason)throw new ApiError(409,'invalid_transition');
  const result=(await db.query('INSERT INTO work_materials(request_id,actor_id,kind,name,quantity,unit,unit_cost_minor,comment) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[id,req.user!.id,b.kind,b.name,b.quantity,b.unit,b.unitCostMinor??null,b.comment])).rows[0];
  await incrementRequest(db,req,c,r,'material_added');return {...result,request_version:r.version+1};
 })}));
});
coreOperations.get('/assets/lookup',async(req,res)=>{
 const c=await requirePermission(req,'assets.read'),identifier=z.string().trim().min(1).max(160).parse(req.query.identifier);
 const rows=(await pool.query('SELECT a.*,b.name AS building_name FROM assets a JOIN buildings b ON b.id=a.building_id WHERE a.organization_id=$1 AND ($2::uuid IS NULL OR a.building_id=$2) AND ($3::uuid IS NULL OR a.building_id=(SELECT building_id FROM units WHERE id=$3)) AND (a.id::text=$4 OR a.serial_number=$4) LIMIT 2',[c.organization_id,c.building_id,c.unit_id,identifier])).rows;
 if(rows.length!==1)throw new ApiError(rows.length?409:404,rows.length?'ambiguous_identifier':'not_found');
 const asset=rows[0],plans=(await pool.query('SELECT * FROM maintenance_plans WHERE asset_id=$1',[asset.id])).rows;
 const works=(await pool.query('SELECT r.id,r.subject,r.status,r.priority,r.created_at,w.status AS work_status FROM resident_requests r LEFT JOIN work_orders w ON w.request_id=r.id WHERE r.asset_id=$1 AND ($2::boolean OR w.technician_id=$3) ORDER BY r.created_at DESC LIMIT 100',[asset.id,c.permissions.includes('requests.read'),req.user!.id])).rows;
 const units=(await pool.query('SELECT id,number,building_id FROM units WHERE organization_id=$1 AND building_id=$2 AND ($3::uuid IS NULL OR id=$3) ORDER BY number',[c.organization_id,asset.building_id,c.unit_id])).rows;
 res.json({asset,plans,works,units});
});
coreOperations.get('/operations/visits',async(req,res)=>{
 const c=await readScope(req),from=time.parse(req.query.from),to=time.parse(req.query.to);
 if(Date.parse(to)<=Date.parse(from)||Date.parse(to)-Date.parse(from)>62*86400000)throw new ApiError(400,'invalid_visit_window');
 res.json((await pool.query(`SELECT v.*,r.version AS request_version,r.subject,u.number,b.name AS building_name FROM request_visits v
 JOIN resident_requests r ON r.id=v.request_id LEFT JOIN units u ON u.id=r.unit_id JOIN buildings b ON b.id=COALESCE(r.building_id,u.building_id) LEFT JOIN work_orders w ON w.request_id=r.id
 WHERE r.organization_id=$1 AND ($2::uuid IS NULL OR COALESCE(r.building_id,u.building_id)=$2) AND ($3::uuid IS NULL OR u.id=$3)
 AND v.status IN('proposed','confirmed') AND r.status<>'closed' AND v.starts_at<$5 AND v.ends_at>$4
 AND ($6::boolean OR ($7::boolean AND (r.author_user_id=$8 OR r.reported_for_user_id=$8 OR r.reported_for_user_id IS NULL AND r.source IN('dispatcher_phone','manager','system') AND u.id=$3)) OR ($9::boolean AND w.technician_id=$8))
 ORDER BY v.starts_at LIMIT 1000`,[c.organization_id,c.building_id,c.unit_id,from,to,c.permissions.includes('requests.read'),c.permissions.includes('requests.own'),req.user!.id,c.permissions.includes('workorders.assigned')])).rows);
});
coreOperations.get('/assets/:id/qr',async(req,res)=>{
 const c=await requirePermission(req,'assets.read'),id=uuid.parse(req.params.id);
 if(!(await pool.query('SELECT id FROM assets WHERE id=$1 AND organization_id=$2 AND ($3::uuid IS NULL OR building_id=$3) AND ($4::uuid IS NULL OR building_id=(SELECT building_id FROM units WHERE id=$4))',[id,c.organization_id,c.building_id,c.unit_id])).rowCount)throw new ApiError(404,'not_found');
 const QRCode=(await import('qrcode')).default;
 res.set({'Content-Type':'image/png','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}).send(await QRCode.toBuffer(id,{type:'png',width:320}));
});
