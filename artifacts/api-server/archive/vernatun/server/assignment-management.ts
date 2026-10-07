import {Router,type Request} from 'express';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import {pool} from './db.js';
import {ApiError,requirePermission,type Context} from './access.js';
import {transaction,record} from './operations.js';
import {roleCatalog} from './roles.js';

export const assignmentManagement=Router();
const uuid=z.string().uuid();
const staffRoles=['org_admin','portfolio_owner','developer','manager','accountant','dispatcher','technician','contractor','security'] as const;
const body=z.object({
 version:z.string().regex(/^\d+$/),roleKey:z.enum(staffRoles),
 buildingId:uuid.nullable(),unitId:uuid.nullable(),
 startsAt:z.string().datetime({offset:true}),expiresAt:z.string().datetime({offset:true}).nullable(),
}).strict();
const projection=`a.id,a.user_id,a.organization_id,a.role_key,a.profile_id,a.building_id,a.unit_id,a.starts_at,a.expires_at,a.active,a.xmin::text AS version,u.name,u.email`;
function inScope(c:Context,a:any){
 if(!c.organization_id||a.organization_id!==c.organization_id||
 (c.building_id&&c.building_id!==a.building_id)||(c.unit_id&&c.unit_id!==a.unit_id))
  throw new ApiError(404,'not_found');
}
function editable(req:Request,a:any){
 return a.user_id!==req.user!.id&&a.active&&staffRoles.includes(a.role_key);
}
const snapshot=(a:any)=>Object.fromEntries(['role_key','building_id','unit_id','starts_at','expires_at','active'].map(k=>[k,a[k]]));

// All IAM writers here lock the organization before assignments. This serializes
// administrator-removal decisions and avoids opposite-order assignment deadlocks.
async function lockedActor(db:PoolClient,req:Request,initial:Context){
 await db.query('SELECT pg_advisory_xact_lock(6172924)');
 if(!initial.organization_id)throw new ApiError(403,'forbidden');
 await db.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[initial.organization_id]);
 const actor=await db.query(`SELECT a.id FROM role_assignments a JOIN users u ON u.id=a.user_id
 JOIN memberships m ON m.user_id=a.user_id AND m.organization_id=a.organization_id
 WHERE a.id=$1 AND a.active AND m.active AND NOT u.blocked
 AND a.starts_at<=now() AND (a.expires_at IS NULL OR a.expires_at>now())
 FOR SHARE OF a,u,m`,[initial.id]);
 if(!actor.rowCount)throw new ApiError(403,'forbidden');
 const fresh=await requirePermission(req,'roles.assign');
 if(fresh.id!==initial.id||fresh.organization_id!==initial.organization_id)throw new ApiError(403,'forbidden');
 return fresh;
}
async function preserveAdministrator(db:PoolClient,a:any){
 if(a.role_key!=='org_admin'||!a.active)return;
 // Keep another unrestricted, non-expiring administrator. A future or blocked
 // admin cannot provide a recovery path for today's organization.
 const remaining=await db.query(`SELECT a.id FROM role_assignments a
 JOIN users u ON u.id=a.user_id JOIN memberships m ON m.user_id=a.user_id AND m.organization_id=a.organization_id
 WHERE a.organization_id=$1 AND a.id<>$2 AND a.role_key='org_admin'
 AND a.active AND m.active AND NOT u.blocked AND a.starts_at<=now()
 AND a.expires_at IS NULL AND a.building_id IS NULL AND a.unit_id IS NULL
 FOR SHARE OF a,u,m`,[a.organization_id,a.id]);
 if(!remaining.rowCount)throw new ApiError(409,'last_administrator');
}
assignmentManagement.get('/roles/:id',async(req,res)=>{
 const c=await requirePermission(req,'roles.assign');
 const a=(await pool.query(`SELECT ${projection} FROM role_assignments a JOIN users u ON u.id=a.user_id
 WHERE a.id=$1 AND a.organization_id=$2`,[uuid.parse(req.params.id),c.organization_id])).rows[0];
 if(!a)throw new ApiError(404,'not_found');inScope(c,a);
 res.json({assignment:a,editable:editable(req,a),editableRoles:staffRoles,
 permissions:roleCatalog[a.role_key as keyof typeof roleCatalog]?.permissions??[]});
});
assignmentManagement.patch('/roles/:id',async(req,res)=>{
 const initial=await requirePermission(req,'roles.assign'),id=uuid.parse(req.params.id),b=body.parse(req.body);
 if(b.expiresAt&&Date.parse(b.expiresAt)<=Date.parse(b.startsAt))throw new ApiError(400,'invalid_dates');
 if(b.unitId&&!b.buildingId)throw new ApiError(400,'invalid_scope');
 const assignment=await transaction(async db=>{
  const c=await lockedActor(db,req,initial);
  const a=(await db.query(`SELECT ${projection} FROM role_assignments a JOIN users u ON u.id=a.user_id
   WHERE a.id=$1 AND a.organization_id=$2 FOR UPDATE OF a`,[id,c.organization_id])).rows[0];
  if(!a)throw new ApiError(404,'not_found');inScope(c,a);
  if(!editable(req,a))throw new ApiError(403,'forbidden');
  if(a.version!==b.version)throw new ApiError(409,'concurrent_change');
  if(a.role_key!==b.roleKey&&(a.profile_id||(await db.query('SELECT 1 FROM iam_assignment_rules WHERE assignment_id=$1',[id])).rowCount))
   throw new ApiError(409,'detach_policy_first');
  inScope(c,{...a,building_id:b.buildingId,unit_id:b.unitId});
  if(b.buildingId&&!(await db.query('SELECT id FROM buildings WHERE id=$1 AND organization_id=$2',[b.buildingId,c.organization_id])).rowCount)
   throw new ApiError(404,'not_found');
  if(b.unitId&&!(await db.query('SELECT id FROM units WHERE id=$1 AND organization_id=$2 AND building_id=$3',[b.unitId,c.organization_id,b.buildingId])).rowCount)
   throw new ApiError(404,'not_found');
  if(a.role_key==='org_admin'&&(b.roleKey!=='org_admin'||b.buildingId||b.unitId||b.expiresAt||Date.parse(b.startsAt)>Date.now()))
   await preserveAdministrator(db,a);
  const updated=(await db.query(`UPDATE role_assignments SET role_key=$2,building_id=$3,unit_id=$4,starts_at=$5,expires_at=$6
   WHERE id=$1 RETURNING *,xmin::text AS version`,[id,b.roleKey,b.buildingId,b.unitId,b.startsAt,b.expiresAt])).rows[0];
  await record(db,req,c,'role.update','role_assignment',id,{before:snapshot(a),after:snapshot(updated)});
  return updated;
 });
 res.json({assignment});
});
assignmentManagement.delete('/roles/:id',async(req,res)=>{
 const initial=await requirePermission(req,'roles.assign'),id=uuid.parse(req.params.id);
 await transaction(async db=>{
  const c=await lockedActor(db,req,initial);
  const a=(await db.query('SELECT * FROM role_assignments WHERE id=$1 AND organization_id=$2 FOR UPDATE',[id,c.organization_id])).rows[0];
  if(!a)throw new ApiError(404,'not_found');inScope(c,a);
  if(a.user_id===req.user!.id)throw new ApiError(403,'forbidden');
  if(!a.active)return;
  await preserveAdministrator(db,a);
  await db.query('UPDATE role_assignments SET active=false WHERE id=$1',[id]);
  await record(db,req,c,'role.revoke','role_assignment',id,{before:snapshot(a),after:{...snapshot(a),active:false}});
 });
 res.status(204).end();
});
