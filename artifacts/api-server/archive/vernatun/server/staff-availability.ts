import {Router} from 'express';
import {z} from 'zod';
import {pool} from './db.js';
import {requireAuth,requirePermission,context,scopedUnit,ApiError,type Context} from './access.js';
import {permissionDecision} from './iam-evaluator.js';
import {eligiblePeople} from './core-operation-store.js';
import {transaction,idempotent,record} from './operations.js';
import {intervalCovered} from './availability-logic.js';
import type {PoolClient} from 'pg';
export const staffAvailability=Router();staffAvailability.use(requireAuth);
const uuid=z.string().uuid(),time=z.string().datetime({offset:true}),kind=z.enum(['shift','absence']);
const input=z.object({key:uuid,unitId:uuid,technicianId:uuid,scope:z.enum(['building','unit']),kind,startsAt:time,endsAt:time}).strict();
const change=z.object({key:uuid,version:z.number().int().positive(),action:z.enum(['update','cancel']),kind:kind.optional(),startsAt:time.optional(),endsAt:time.optional()}).strict();
function windowCheck(from:string,to:string,k?:string){
 const span=Date.parse(to)-Date.parse(from);
 if(span<=0||span>62*864e5||k==='shift'&&span>864e5)throw new ApiError(400,'invalid_availability_window');
}
function inScope(c:Context,r:any){
 return r.organization_id===c.organization_id&&(!c.building_id||r.building_id===c.building_id)&&(!c.unit_id||r.unit_id===c.unit_id);
}
async function eligible(db:PoolClient|typeof pool,c:Context,unit:any,technician:string,from:string,to:string){
 return !!(await db.query(`SELECT 1 FROM role_assignments a JOIN users x ON x.id=a.user_id
  JOIN memberships m ON m.user_id=x.id AND m.organization_id=a.organization_id
  WHERE a.user_id=$1 AND a.organization_id=$2 AND a.role_key='technician' AND NOT x.blocked AND m.active
  AND a.active AND a.starts_at<=now() AND (a.expires_at IS NULL OR a.expires_at>now())
  AND a.starts_at<=$3 AND (a.expires_at IS NULL OR a.expires_at>=$4)
  AND (a.building_id IS NULL OR a.building_id=$5) AND (a.unit_id IS NULL OR a.unit_id=$6) LIMIT 1`,
 [technician,c.organization_id,from,to,unit.building_id,unit.id])).rowCount;
}
staffAvailability.get('/operations/availability/options',async(req,res)=>{
 const current=await context(req),c=await requirePermission(req,current.permissions.includes('requests.read')?'requests.read':'workorders.assigned');
 const rows=(await pool.query(`SELECT u.id,u.number,u.building_id,b.name AS building_name FROM units u JOIN buildings b ON b.id=u.building_id
  WHERE u.organization_id=$1 AND ($2::uuid IS NULL OR u.building_id=$2) AND ($3::uuid IS NULL OR u.id=$3)
  AND ($4 OR EXISTS(SELECT 1 FROM work_orders w JOIN resident_requests r ON r.id=w.request_id WHERE r.unit_id=u.id AND w.technician_id=$5))
  ORDER BY b.name,u.number,u.id LIMIT 1001`,[c.organization_id,c.building_id,c.unit_id,c.permissions.includes('requests.read'),req.user!.id])).rows;
 if(rows.length>1000)throw new ApiError(400,'visit_window_too_large');
 res.json(rows);
});
staffAvailability.get('/operations/availability',async(req,res)=>{
 const current=await context(req),c=await requirePermission(req,current.permissions.includes('requests.read')?'requests.read':'workorders.assigned');
 const unitId=uuid.parse(req.query.unitId),from=time.parse(req.query.from),to=time.parse(req.query.to);windowCheck(from,to);
 const unit=await scopedUnit(c,unitId);
 const all=await eligiblePeople(pool,c.organization_id!,unit.building_id,unit.id,'technician',c.permissions.includes('requests.read')?undefined:req.user!.id);
 const manage=(await permissionDecision(c,'requests.assign','POST')).allowed;
 const blocks=(await pool.query(`SELECT * FROM staff_availability WHERE organization_id=$1 AND building_id=$2
  AND (unit_id IS NULL OR unit_id=$3) AND technician_id=ANY($4::uuid[]) AND cancelled_at IS NULL
  AND starts_at<$6 AND ends_at>$5 ORDER BY starts_at,id LIMIT 1001`,[c.organization_id,unit.building_id,unitId,all.map(p=>p.id),from,to])).rows;
 if(blocks.length>1000)throw new ApiError(400,'visit_window_too_large');
 // Only visits visible to this context contribute; never imply global availability.
 const visits=(await pool.query(`SELECT w.technician_id,count(*)::int AS n FROM request_visits v
  JOIN resident_requests r ON r.id=v.request_id JOIN work_orders w ON w.request_id=r.id
  LEFT JOIN units u ON u.id=r.unit_id WHERE r.organization_id=$1
  AND ($2::uuid IS NULL OR COALESCE(r.building_id,u.building_id)=$2)
  AND ($3::uuid IS NULL OR r.unit_id=$3) AND w.technician_id=ANY($4::uuid[])
  AND v.status IN('proposed','confirmed') AND r.status<>'closed' AND v.starts_at<$6 AND v.ends_at>$5
  GROUP BY w.technician_id`,[c.organization_id,c.building_id,c.unit_id,all.map(p=>p.id),from,to])).rows;
 const counts=new Map(visits.map(v=>[v.technician_id,v.n]));
 const people=await Promise.all(all.map(async p=>{
  const own=blocks.filter(b=>b.technician_id===p.id),visitCount=counts.get(p.id)??0;
  const status=own.some(b=>b.kind==='absence')?'absent':visitCount?'busy':
   await eligible(pool,c,unit,p.id,from,to)&&intervalCovered(Date.parse(from),Date.parse(to),own.filter(b=>b.kind==='shift'))?'available_in_scope':'unknown';
  return {...p,status,visitCount};
 }));
 res.json({canManage:manage,canManageBuilding:manage&&!c.unit_id,people,
  blocks:blocks.map(b=>({...b,canEdit:manage&&inScope(c,b)}))});
});
staffAvailability.post('/operations/availability',async(req,res)=>{
 const c=await requirePermission(req,'requests.assign'),b=input.parse(req.body);windowCheck(b.startsAt,b.endsAt,b.kind);
 const unit=await scopedUnit(c,b.unitId);
 if(b.scope==='building'&&c.unit_id)throw new ApiError(403,'forbidden');
 res.status(201).json(await transaction(async db=>{
  if(!(await eligible(db,c,{...unit,id:b.scope==='building'?null:unit.id},b.technicianId,b.startsAt,b.endsAt)))throw new ApiError(403,'ineligible_technician');
  const live=(await db.query('SELECT organization_id,building_id FROM units WHERE id=$1 FOR SHARE',[unit.id])).rows[0];
  if(!live||live.organization_id!==c.organization_id||live.building_id!==unit.building_id)throw new ApiError(404,'not_found');
  return idempotent(db,req,b.key,b,async()=>{
   const row=(await db.query(`INSERT INTO staff_availability(organization_id,building_id,unit_id,technician_id,kind,starts_at,ends_at,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[c.organization_id,unit.building_id,b.scope==='unit'?unit.id:null,b.technicianId,b.kind,b.startsAt,b.endsAt,req.user!.id])).rows[0];
   await record(db,req,c,'availability.create','staff_availability',row.id,{after:row});return row;
  });
 }));
});
staffAvailability.post('/operations/availability/:id/change',async(req,res)=>{
 const c=await requirePermission(req,'requests.assign'),id=uuid.parse(req.params.id),b=change.parse(req.body);
 if(b.action==='update'){
  if(!b.kind||!b.startsAt||!b.endsAt)throw new ApiError(400,'validation_error');
  windowCheck(b.startsAt,b.endsAt,b.kind);
 }
 res.json(await transaction(async db=>{
  const row=(await db.query('SELECT * FROM staff_availability WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(!row||!inScope(c,row))throw new ApiError(404,'not_found');
  return idempotent(db,req,b.key,b,async()=>{
   if(row.version!==b.version||row.cancelled_at)throw new ApiError(409,'stale_version');
   if(b.action==='update'&&!(await eligible(db,c,{id:row.unit_id,building_id:row.building_id},row.technician_id,b.startsAt!,b.endsAt!)))throw new ApiError(403,'ineligible_technician');
   const updated=(await db.query(`UPDATE staff_availability SET kind=COALESCE($2,kind),starts_at=COALESCE($3,starts_at),
    ends_at=COALESCE($4,ends_at),cancelled_at=CASE WHEN $5 THEN now() ELSE NULL END,version=version+1 WHERE id=$1 RETURNING *`,
   [id,b.action==='update'?b.kind:null,b.action==='update'?b.startsAt:null,b.action==='update'?b.endsAt:null,b.action==='cancel'])).rows[0];
   await record(db,req,c,'availability.'+b.action,'staff_availability',id,{before:row,after:updated});return updated;
  });
 }));
});
