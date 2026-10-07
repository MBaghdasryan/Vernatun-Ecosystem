import {Router,type Request} from 'express';
import {z} from 'zod';
import {pool} from './db.js';
import {requireAuth,requirePermission,ApiError} from './access.js';
import {transaction,record,idempotent} from './operations.js';
import {uuid,day,version} from './finance-shared.js';
import {readableDocument} from './documents.js';
export const ownership=Router();ownership.use(requireAuth);
ownership.get('/ownerships',async(req,res)=>{
 const c=await requirePermission(req,'ownership.read');if(!c.organization_id)throw new ApiError(403,'forbidden');
 const unit=req.query.unitId?uuid.parse(req.query.unitId):null;
 res.json((await pool.query(`SELECT o.*,u.number,u.building_id,b.name AS building_name,p.name AS owner_name,
 COALESCE((SELECT json_agg(e ORDER BY e.created_at NULLS FIRST,e.id) FROM ownership_events e WHERE e.ownership_id=o.id),'[]') AS history
 FROM ownerships o JOIN units u ON u.id=o.unit_id JOIN buildings b ON b.id=u.building_id JOIN users p ON p.id=o.user_id
 WHERE o.organization_id=$1 AND ($2::uuid IS NULL OR u.building_id=$2) AND ($3::uuid IS NULL OR o.unit_id=$3)
 AND ($4::uuid IS NULL OR o.unit_id=$4) AND (NOT $5 OR o.user_id=$6)
 ORDER BY u.number,o.starts_on`,[c.organization_id,c.building_id,c.unit_id,unit,c.role_key==='unit_owner',req.user!.id])).rows);
});
ownership.get('/ownerships/candidates',async(req,res)=>{
 const c=await requirePermission(req,'ownership.manage');
 res.json((await pool.query(`SELECT u.id,u.name FROM users u JOIN memberships m ON m.user_id=u.id
 WHERE m.organization_id=$1 AND m.active AND NOT u.blocked ORDER BY u.name`,[c.organization_id])).rows);
});
async function basis(req:Request,id?:string){if(!id)return null;return (await readableDocument(req,id))[0].latest_version_id}
ownership.post('/ownerships',async(req,res)=>{
 const c=await requirePermission(req,'ownership.manage');if(c.unit_id)throw new ApiError(403,'forbidden');
 const b=z.object({key:uuid,unitId:uuid,userId:uuid,startsOn:day,endsOn:day.nullable().default(null),shareBasisPoints:z.number().int().min(1).max(10000),basis:z.string().trim().min(3).max(1000),basisDocumentId:uuid.optional()}).strict().parse(req.body);
 if(b.endsOn&&b.endsOn<b.startsOn)throw new ApiError(400,'invalid_dates');const bv=await basis(req,b.basisDocumentId);
 res.status(201).json(await transaction(db=>idempotent(db,req,b.key,b,async()=>{
 const u=(await db.query('SELECT id FROM units WHERE id=$1 AND organization_id=$2 AND ($3::uuid IS NULL OR building_id=$3) FOR UPDATE',[b.unitId,c.organization_id,c.building_id])).rows[0];if(!u)throw new ApiError(404,'not_found');
 if(!(await db.query('SELECT u.id FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.id=$1 AND m.organization_id=$2 AND m.active AND NOT u.blocked FOR SHARE OF u,m',[b.userId,c.organization_id])).rowCount)throw new ApiError(400,'invalid_owner');
 // The unit lock serializes all writers. Trigger additionally protects SQL writers.
 const overflow=(await db.query(`SELECT EXISTS(SELECT 1 FROM (
 SELECT $2::date AS d UNION SELECT starts_on FROM ownerships WHERE unit_id=$1 AND starts_on>=$2 AND ($3::date IS NULL OR starts_on<=$3)
 UNION SELECT ends_on+1 FROM ownerships WHERE unit_id=$1 AND ends_on>=$2 AND ($3::date IS NULL OR ends_on<$3)
 ) x WHERE COALESCE((SELECT sum(share_basis_points) FROM ownerships WHERE unit_id=$1 AND starts_on<=x.d AND (ends_on IS NULL OR ends_on>=x.d)),0)+$4>10000) AS bad`,[b.unitId,b.startsOn,b.endsOn,b.shareBasisPoints])).rows[0].bad;
 if(overflow)throw new ApiError(409,'ownership_share_overflow');
 const r=(await db.query('INSERT INTO ownerships(organization_id,unit_id,user_id,starts_on,ends_on,share_basis_points,basis,basis_version_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[c.organization_id,b.unitId,b.userId,b.startsOn,b.endsOn,b.shareBasisPoints,b.basis,bv])).rows[0];
 await db.query("INSERT INTO ownership_events(ownership_id,actor_id,action,snapshot,created_at) VALUES($1,$2,'create',$3,now())",[r.id,req.user!.id,JSON.stringify(r)]);
 await record(db,req,c,'ownership.create','ownership',r.id);return r;
 })));
});
ownership.post('/ownerships/:id/end',async(req,res)=>{
 const c=await requirePermission(req,'ownership.manage'),id=uuid.parse(req.params.id);
 const b=z.object({key:uuid,version,endsOn:day,reason:z.string().trim().min(3).max(1000)}).strict().parse(req.body);
 res.json(await transaction(db=>idempotent(db,req,b.key,b,async()=>{
 const parent=(await db.query('SELECT u.id FROM units u JOIN ownerships o ON o.unit_id=u.id WHERE o.id=$1 AND o.organization_id=$2 AND ($3::uuid IS NULL OR u.building_id=$3) FOR UPDATE OF u',[id,c.organization_id,c.building_id])).rows[0];if(!parent)throw new ApiError(404,'not_found');
 const o=(await db.query('SELECT o.*,o.starts_on::text AS starts_on,o.ends_on::text AS ends_on FROM ownerships o WHERE id=$1 FOR UPDATE',[id])).rows[0];if(o.version!==b.version)throw new ApiError(409,'stale_version');
 if(o.ends_on||b.endsOn<String(o.starts_on).slice(0,10))throw new ApiError(409,'invalid_transition');
 const r=(await db.query('UPDATE ownerships SET ends_on=$2,version=version+1 WHERE id=$1 RETURNING *',[id,b.endsOn])).rows[0];
 await db.query("INSERT INTO ownership_events(ownership_id,actor_id,action,snapshot,reason,created_at) VALUES($1,$2,'end',$3,$4,now())",[id,req.user!.id,JSON.stringify(r),b.reason]);
 await record(db,req,c,'ownership.end','ownership',id,{reason:b.reason});return r;
 })));
});
