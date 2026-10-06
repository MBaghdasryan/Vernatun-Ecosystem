import {Router} from 'express';
import {z} from 'zod';
import {pool} from './db.js';
import {requireAuth,requirePermission,ApiError,type Context} from './access.js';
import {transaction,idempotent,record} from './operations.js';
import {uuid,day,title,globalAdmin,globalQueueLead,operator,version} from './platform-ops-shared.js';
import type {PoolClient} from 'pg';
export const onboardingWorkflow=Router();onboardingWorkflow.use(requireAuth);
const dependencies=z.array(uuid).max(100).refine(a=>new Set(a).size===a.length),notes=z.string().max(8000);
const manager=(c:Context)=>globalAdmin(c)||globalQueueLead(c);
async function scope(db:PoolClient,c:Context,id:string,user:string){
 const s=(await db.query('SELECT * FROM onboarding_steps WHERE id=$1',[id])).rows[0];
 if(!s||(!manager(c)&&(c.organization_id||s.assigned_to!==user)))throw new ApiError(404,'not_found');
 await db.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[s.organization_id]);
 return (await db.query('SELECT * FROM onboarding_steps WHERE id=$1',[id])).rows[0];
}
async function validateDeps(db:PoolClient,org:string,id:string,order:number,ids:string[]){
 const d=(await db.query('SELECT * FROM onboarding_steps WHERE id=ANY($1::uuid[]) AND organization_id=$2',[ids,org])).rows;
 if(d.length!==ids.length||d.some(s=>s.id===id||s.sort_order>=order))throw new ApiError(400,'invalid_dependencies');
 return d;
}
async function event(db:PoolClient,id:string,actor:string,action:string,details:unknown){
 await db.query('INSERT INTO onboarding_events(step_id,actor_id,action,details) VALUES($1,$2,$3,$4)',[id,actor,action,JSON.stringify(details)]);
}
onboardingWorkflow.get('/platform/onboarding',async(req,res)=>{
 const c=await requirePermission(req,'onboarding.manage');if(c.organization_id)throw new ApiError(403,'forbidden');
 res.json((await pool.query(`SELECT s.*,o.name AS organization_name,u.name AS assignee_name,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('id',d.id,'title',d.title,'status',d.status)) FROM onboarding_dependencies x JOIN onboarding_steps d ON d.id=x.dependency_id WHERE x.step_id=s.id),'[]') AS dependencies,
 (SELECT count(*)::int FROM onboarding_steps WHERE organization_id=s.organization_id) AS total,
 (SELECT count(*)::int FROM onboarding_steps WHERE organization_id=s.organization_id AND status='completed') AS completed
 FROM onboarding_steps s JOIN organizations o ON o.id=s.organization_id JOIN users u ON u.id=s.assigned_to
 WHERE $1 OR s.assigned_to=$2 ORDER BY o.name,s.sort_order,s.id`,[manager(c),req.user!.id])).rows);
});
onboardingWorkflow.get('/platform/onboarding/:id',async(req,res)=>{
 const c=await requirePermission(req,'onboarding.manage');res.json(await transaction(async db=>{
 const s=await scope(db,c,uuid.parse(req.params.id),req.user!.id);
 return {...s,dependencies:(await db.query('SELECT dependency_id AS id FROM onboarding_dependencies WHERE step_id=$1',[s.id])).rows,
 events:(await db.query('SELECT e.*,u.name AS actor_name FROM onboarding_events e JOIN users u ON u.id=e.actor_id WHERE step_id=$1 ORDER BY created_at,id',[s.id])).rows};}));
});
onboardingWorkflow.post('/platform/onboarding',async(req,res)=>{
 const c=await requirePermission(req,'onboarding.manage');if(c.organization_id)throw new ApiError(403,'forbidden');
 const b=z.object({key:uuid,organizationId:uuid,title,category:title.default('general'),assigneeId:uuid,dueOn:day,order:z.number().int().min(0).max(100000),dependencies:dependencies.default([]),notes:notes.default('')}).strict().parse(req.body);
 if(!manager(c)&&b.assigneeId!==req.user!.id)throw new ApiError(403,'forbidden');
 res.status(201).json(await transaction(async db=>{
 if(!(await db.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[b.organizationId])).rowCount)throw new ApiError(404,'not_found');
 return idempotent(db,req,b.key,b,async()=>{
 await operator(db,b.assigneeId);await validateDeps(db,b.organizationId,'',b.order,b.dependencies);
 const s=(await db.query('INSERT INTO onboarding_steps(organization_id,assigned_to,title,due_on,category,sort_order,notes) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[b.organizationId,b.assigneeId,b.title,b.dueOn,b.category,b.order,b.notes])).rows[0];
 for(const d of b.dependencies)await db.query('INSERT INTO onboarding_dependencies(step_id,dependency_id) VALUES($1,$2)',[s.id,d]);
 await event(db,s.id,req.user!.id,'create',b);await record(db,req,{...c,organization_id:b.organizationId},'onboarding.create','onboarding_step',s.id);return s;})}));
});
onboardingWorkflow.post('/platform/onboarding/:id/change',async(req,res)=>{
 const c=await requirePermission(req,'onboarding.manage'),id=uuid.parse(req.params.id);
 const b=z.object({key:uuid,version:z.number().int().positive(),action:z.enum(['edit','assign','start','complete','reopen']),assigneeId:uuid.optional(),title:title.optional(),category:title.optional(),dueOn:day.optional(),order:z.number().int().min(0).max(100000).optional(),dependencies:dependencies.optional(),notes:notes.optional(),reason:z.string().trim().min(3).max(1000).optional(),reopenDependents:z.boolean().default(false)}).strict().parse(req.body);
 if(b.action==='assign'&&[b.title,b.category,b.dueOn,b.order,b.dependencies,b.notes].some(v=>v!==undefined)||b.action==='edit'&&b.assigneeId!==undefined)throw new ApiError(400,'validation_error');
 res.json(await transaction(async db=>{const s=await scope(db,c,id,req.user!.id);return idempotent(db,req,b.key,b,async()=>{version(s,b.version);
 const existing=(await db.query('SELECT dependency_id FROM onboarding_dependencies WHERE step_id=$1',[id])).rows.map(d=>d.dependency_id);
 const ds=await validateDeps(db,s.organization_id,id,b.order??s.sort_order,b.dependencies??existing);
 let status=s.status,completedAt=s.completed_at;
 if(b.action==='start'||b.action==='complete'){
  if(ds.some(d=>d.status!=='completed'))throw new ApiError(409,'dependencies_incomplete');
  if(b.action==='start'&&status!=='pending'||b.action==='complete'&&status==='completed')throw new ApiError(409,'invalid_transition');
  status=b.action==='start'?'in_progress':'completed';completedAt=status==='completed'?new Date():null;
 }else if(b.action==='reopen'){
  if(status==='pending'||!b.reason)throw new ApiError(409,'invalid_transition');
  const downstream=(await db.query(`WITH RECURSIVE descendants(id) AS (SELECT step_id FROM onboarding_dependencies WHERE dependency_id=$1
  UNION SELECT d.step_id FROM onboarding_dependencies d JOIN descendants x ON d.dependency_id=x.id)
  SELECT s.* FROM onboarding_steps s JOIN descendants x ON x.id=s.id WHERE s.status<>'pending'`,[id])).rows;
  if(downstream.length&&!b.reopenDependents)throw new ApiError(409,'dependents_require_reopen');
  if(!manager(c)&&downstream.some(d=>d.assigned_to!==req.user!.id))throw new ApiError(403,'forbidden');
  for(const d of downstream){await event(db,d.id,req.user!.id,'dependent_reopen',{reason:b.reason,before:d});await db.query("UPDATE onboarding_steps SET status='pending',completed_at=NULL,version=version+1 WHERE id=$1",[d.id])}
  status='pending';completedAt=null;
 }else if(b.action==='assign'){
  if(!manager(c)||!b.assigneeId)throw new ApiError(403,'forbidden');await operator(db,b.assigneeId);
 }
 if(b.action==='edit'){
  if(!manager(c)&&(b.dependencies||b.order!==undefined))throw new ApiError(403,'forbidden');
  if(status!=='pending'&&ds.some(d=>d.status!=='completed'))throw new ApiError(409,'dependencies_incomplete');
  if(b.order!==undefined&&(await db.query(`SELECT s.id FROM onboarding_dependencies d JOIN onboarding_steps s ON s.id=d.step_id WHERE d.dependency_id=$1 AND s.sort_order<=$2`,[id,b.order])).rowCount)throw new ApiError(400,'invalid_order');
 }
 // Only edit/assign may change metadata; unrelated hidden fields are rejected.
 if(!['edit','assign'].includes(b.action)&&[b.assigneeId,b.title,b.category,b.dueOn,b.order,b.dependencies,b.notes].some(v=>v!==undefined))throw new ApiError(400,'validation_error');
 const out=(await db.query(`UPDATE onboarding_steps SET assigned_to=$2,title=$3,category=$4,due_on=$5,sort_order=$6,notes=$7,status=$8,completed_at=$9,version=version+1 WHERE id=$1 RETURNING *`,
 [id,b.action==='assign'?b.assigneeId:s.assigned_to,b.title??s.title,b.category??s.category,b.dueOn??s.due_on,b.order??s.sort_order,b.notes??s.notes,status,completedAt])).rows[0];
 if(b.dependencies){await db.query('DELETE FROM onboarding_dependencies WHERE step_id=$1',[id]);for(const d of b.dependencies)await db.query('INSERT INTO onboarding_dependencies(step_id,dependency_id) VALUES($1,$2)',[id,d])}
 await event(db,id,req.user!.id,b.action,{before:s,dependenciesBefore:existing,input:b});
 await record(db,req,{...c,organization_id:s.organization_id},'onboarding.'+b.action,'onboarding_step',id);return out;})}));
});
