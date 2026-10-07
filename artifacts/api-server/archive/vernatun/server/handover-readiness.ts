import {Router} from 'express';
import {z} from 'zod';
import {pool} from './db.js';
import {requireAuth,requirePermission,scopedUnit,ApiError} from './access.js';
import {permissionDecision} from './iam-evaluator.js';
import {building} from './services.js';
import {transaction,idempotent,record} from './operations.js';
import {readinessStatus} from './readiness-status.js';
export const handoverReadiness=Router();handoverReadiness.use(requireAuth);
const uuid=z.string().uuid();
handoverReadiness.get('/handover-readiness',async(req,res)=>{
 const c=await requirePermission(req,'handover.read');
 const units=(await pool.query(`SELECT u.id,u.number,u.building_id AS "buildingId",b.name AS "buildingName",
 l.floor_id AS "floorId",COALESCE(l.revision,0) AS revision,
 h.id AS "handoverId",h.status AS "handoverStatus",
 (SELECT count(*)::int FROM defects d WHERE d.unit_id=u.id AND d.status<>'accepted') AS "openDefects",
 (SELECT count(*)::int FROM inspections i JOIN handover_cases hc ON hc.id=i.handover_id WHERE hc.unit_id=u.id AND i.completed_at IS NULL) AS "pendingInspections",
 (SELECT count(*)::int FROM inspections i JOIN handover_cases hc ON hc.id=i.handover_id WHERE hc.unit_id=u.id AND i.completed_at IS NOT NULL) AS "completedInspections"
 FROM units u JOIN buildings b ON b.id=u.building_id
 LEFT JOIN unit_floor_links l ON l.unit_id=u.id
 LEFT JOIN LATERAL (SELECT id,status FROM handover_cases WHERE unit_id=u.id ORDER BY created_at DESC,id DESC LIMIT 1) h ON true
 WHERE u.organization_id=$1 AND ($2::uuid IS NULL OR u.building_id=$2) AND ($3::uuid IS NULL OR u.id=$3)
 ORDER BY b.name,u.number,u.id LIMIT 1001`,[c.organization_id,c.building_id,c.unit_id])).rows;
 if(units.length>1000)throw new ApiError(422,'too_many_units');
 const floors=(await pool.query(`SELECT f.id,f.building_id AS "buildingId",f.number,e.name AS entrance
 FROM floors f JOIN entrances e ON e.id=f.entrance_id WHERE f.organization_id=$1
 AND ($2::uuid IS NULL OR f.building_id=$2)
 AND (NOT $3::boolean OR f.building_id=ANY($4::uuid[]))
 ORDER BY e.name,f.number DESC,f.id LIMIT 2001`,[c.organization_id,c.building_id,!!c.unit_id,units.map(u=>u.buildingId)])).rows;
 if(floors.length>2000)throw new ApiError(422,'too_many_floors');
 const canManage=(await permissionDecision(c,'handover.manage','POST')).allowed;
 res.json({canManage,canCreateFloor:canManage&&!c.unit_id,floors,units:units.map(u=>({...u,status:readinessStatus(u.handoverStatus,u.openDefects,u.pendingInspections,u.completedInspections)}))});
});
handoverReadiness.post('/handover-floors',async(req,res)=>{
 const c=await requirePermission(req,'handover.manage');
 if(c.unit_id)throw new ApiError(403,'forbidden');
 const b=z.object({key:uuid,buildingId:uuid,entrance:z.string().trim().min(1).max(100),number:z.number().int().min(-20).max(300)}).strict().parse(req.body);
 await building(c,b.buildingId);
 res.status(201).json(await transaction(async db=>{
  if(!(await db.query('SELECT id FROM buildings WHERE id=$1 AND organization_id=$2 FOR UPDATE',[b.buildingId,c.organization_id])).rowCount)throw new ApiError(404,'not_found');
  return idempotent(db,req,b.key,b,async()=>{
   let e=(await db.query('SELECT id FROM entrances WHERE building_id=$1 AND name=$2 ORDER BY id LIMIT 1',[b.buildingId,b.entrance])).rows[0];
   if(!e)e=(await db.query('INSERT INTO entrances(organization_id,building_id,name) VALUES($1,$2,$3) RETURNING id',[c.organization_id,b.buildingId,b.entrance])).rows[0];
   let f=(await db.query('SELECT id FROM floors WHERE entrance_id=$1 AND number=$2 ORDER BY id LIMIT 1',[e.id,b.number])).rows[0];
   if(!f){
    f=(await db.query('INSERT INTO floors(organization_id,building_id,entrance_id,number) VALUES($1,$2,$3,$4) RETURNING id',[c.organization_id,b.buildingId,e.id,b.number])).rows[0];
    await record(db,req,c,'handover.floor.create','floor',f.id,{entranceId:e.id,number:b.number});
   }
   return {id:f.id};
  });
 }));
});
handoverReadiness.post('/handover-readiness/:unitId/floor',async(req,res)=>{
 const c=await requirePermission(req,'handover.manage'),u=await scopedUnit(c,uuid.parse(req.params.unitId));
 const b=z.object({key:uuid,revision:z.number().int().nonnegative(),floorId:uuid.nullable()}).strict().parse(req.body);
 res.json(await transaction(async db=>{
  if(!(await db.query('SELECT id FROM units WHERE id=$1 AND organization_id=$2 AND building_id=$3 FOR UPDATE',[u.id,u.organization_id,u.building_id])).rowCount)throw new ApiError(404,'not_found');
  return idempotent(db,req,b.key,b,async()=>{
   const old=(await db.query('SELECT floor_id,revision FROM unit_floor_links WHERE unit_id=$1',[u.id])).rows[0];
   if((old?.revision??0)!==b.revision)throw new ApiError(409,'stale_version');
   if(b.floorId&&!(await db.query('SELECT id FROM floors WHERE id=$1 AND building_id=$2 AND organization_id=$3 FOR SHARE',[b.floorId,u.building_id,u.organization_id])).rowCount)throw new ApiError(404,'not_found');
   const result=(await db.query(`INSERT INTO unit_floor_links(unit_id,organization_id,building_id,floor_id)
    VALUES($1,$2,$3,$4) ON CONFLICT(unit_id) DO UPDATE SET floor_id=EXCLUDED.floor_id,revision=unit_floor_links.revision+1
    RETURNING unit_id AS id,revision`,[u.id,u.organization_id,u.building_id,b.floorId])).rows[0];
   await record(db,req,c,'handover.unit.floor','unit',u.id,{before:old?.floor_id??null,after:b.floorId,revision:result.revision});
   return result;
  });
 }));
});
