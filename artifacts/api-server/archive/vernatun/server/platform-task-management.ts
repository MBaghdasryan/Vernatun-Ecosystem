import {Router,type Request} from 'express';
import {z} from 'zod';
import {pool} from './db.js';
import {ApiError,context,requireAuth,type Context} from './access.js';
import {notifyPlatformTask,record,transaction} from './operations.js';

export const platformTaskManagement=Router();
platformTaskManagement.use('/platform/tasks',requireAuth);

const uuid=z.string().uuid();
const statuses=['todo','in_progress','blocked','done'] as const;
const priorities=['low','normal','high','urgent'] as const;
const title=z.string().trim().min(2).max(160);
const description=z.string().max(4000);

async function admin(req:Request):Promise<Context>{
 const c=await context(req);
 if(c.role_key!=='platform_admin'||c.organization_id)throw new ApiError(403,'forbidden');
 return c;
}

async function validateOrganization(db:any,id:string|null|undefined){
 if(id==null)return;
 if(!(await db.query('SELECT id FROM organizations WHERE id=$1',[id])).rowCount)
  throw new ApiError(400,'invalid_organization');
}

async function validateAssignee(db:any,id:string|null|undefined){
 if(id==null)return;
 const row=(await db.query(`SELECT u.id FROM users u
  WHERE u.id=$1 AND u.account_status='active' AND EXISTS(
   SELECT 1 FROM role_assignments a JOIN roles r ON r.key=a.role_key
   WHERE a.user_id=u.id AND a.organization_id IS NULL AND a.active
    AND a.assignment_status='active' AND a.starts_at<=now()
    AND (a.expires_at IS NULL OR a.expires_at>now()) AND r.shell='platform'
  )`,[id])).rowCount;
 if(!row)throw new ApiError(400,'invalid_assignee');
}

async function selectTask(db:any,id:string){
 return (await db.query(`SELECT t.id,t.title,t.description,t.status,t.priority,
  t.organization_id AS "organizationId",o.name AS "organizationName",
  t.assignee_id AS "assigneeId",u.name AS "assigneeName",t.due_on::text AS "dueOn",
  t.version,t.created_at AS "createdAt",t.updated_at AS "updatedAt"
  FROM platform_tasks t LEFT JOIN organizations o ON o.id=t.organization_id
  LEFT JOIN users u ON u.id=t.assignee_id WHERE t.id=$1`,[id])).rows[0];
}
const taskNotificationBody=(task:{status:string;dueOn:string|null})=>`Status: ${task.status}. Due: ${task.dueOn??'—'}`;
async function assignedTask(req:Request,id:string){
 const task=(await pool.query(`SELECT t.id,t.title,t.description,t.status,t.priority,
  t.organization_id AS "organizationId",o.name AS "organizationName",
  t.assignee_id AS "assigneeId",u.name AS "assigneeName",t.due_on::text AS "dueOn",
  t.version,t.created_at AS "createdAt",t.updated_at AS "updatedAt"
  FROM platform_tasks t LEFT JOIN organizations o ON o.id=t.organization_id
  LEFT JOIN users u ON u.id=t.assignee_id WHERE t.id=$1 AND t.assignee_id=$2
   AND EXISTS(SELECT 1 FROM users member WHERE member.id=$2 AND member.account_status='active' AND NOT member.blocked
    AND EXISTS(SELECT 1 FROM role_assignments a JOIN roles r ON r.key=a.role_key
     WHERE a.user_id=member.id AND a.organization_id IS NULL AND a.active AND a.assignment_status='active'
      AND a.starts_at<=now() AND (a.expires_at IS NULL OR a.expires_at>now()) AND r.shell='platform'))`,
  [id,req.user!.id])).rows[0];
 if(!task)throw new ApiError(404,'not_found');
 return task;
}

const listQuery=z.object({
 q:z.string().trim().max(160).default(''),
 status:z.enum(statuses).optional(),
 priority:z.enum(priorities).optional(),
 organizationId:uuid.optional(),
 assigneeId:uuid.optional(),
 dueFrom:z.string().date().optional(),
 dueTo:z.string().date().optional(),
 }).strict().refine(v=>!v.dueFrom||!v.dueTo||v.dueFrom<=v.dueTo,{path:['dueTo'],message:'invalid_date_range'});

platformTaskManagement.get('/platform/tasks',async(req,res)=>{
 await admin(req);
 const filter=listQuery.parse(req.query),values:unknown[]=[],where=['t.archived_at IS NULL'];
 const add=(sql:(index:number)=>string,value:unknown)=>{values.push(value);where.push(sql(values.length))};
 if(filter.q)add(i=>`(t.title ILIKE $${i} OR t.description ILIKE $${i} OR COALESCE(o.name,'') ILIKE $${i})`,`%${filter.q}%`);
 if(filter.status)add(i=>`t.status=$${i}`,filter.status);
 if(filter.priority)add(i=>`t.priority=$${i}`,filter.priority);
 if(filter.organizationId)add(i=>`t.organization_id=$${i}`,filter.organizationId);
 if(filter.assigneeId)add(i=>`t.assignee_id=$${i}`,filter.assigneeId);
 if(filter.dueFrom)add(i=>`t.due_on >= $${i}::date`,filter.dueFrom);
 if(filter.dueTo)add(i=>`t.due_on <= $${i}::date`,filter.dueTo);
 const tasks=(await pool.query(`SELECT t.id,t.title,t.description,t.status,t.priority,
   t.organization_id AS "organizationId",o.name AS "organizationName",
   t.assignee_id AS "assigneeId",u.name AS "assigneeName",t.due_on::text AS "dueOn",
   t.version,t.created_at AS "createdAt",t.updated_at AS "updatedAt"
   FROM platform_tasks t LEFT JOIN organizations o ON o.id=t.organization_id
   LEFT JOIN users u ON u.id=t.assignee_id WHERE ${where.join(' AND ')}
   ORDER BY CASE t.priority WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'normal' THEN 2 ELSE 1 END DESC,
    t.due_on ASC NULLS LAST,t.updated_at DESC LIMIT 501`,values)).rows;
 if(tasks.length>500)throw new ApiError(413,'too_many_tasks');
 const [organizations,assignees]=await Promise.all([
  pool.query('SELECT id,name FROM organizations ORDER BY name,id'),
  pool.query(`SELECT DISTINCT u.id,u.name FROM users u JOIN role_assignments a ON a.user_id=u.id
   JOIN roles r ON r.key=a.role_key WHERE u.account_status='active' AND a.organization_id IS NULL
   AND a.active AND a.assignment_status='active' AND a.starts_at<=now()
   AND (a.expires_at IS NULL OR a.expires_at>now()) AND r.shell='platform' ORDER BY u.name,u.id`),
 ]);
 res.json({tasks,organizations:organizations.rows,assignees:assignees.rows});
});
platformTaskManagement.get('/platform/tasks/:id',async(req,res)=>{
 const task=await assignedTask(req,uuid.parse(req.params.id));
 res.set('Cache-Control','private, no-store').json(task);
});

const createSchema=z.object({
 title,description:z.string().max(4000).default(''),
 status:z.enum(statuses).default('todo'),priority:z.enum(priorities).default('normal'),
 organizationId:uuid.nullable().optional(),assigneeId:uuid.nullable().optional(),
 dueOn:z.string().date().nullable().optional(),
}).strict();

platformTaskManagement.post('/platform/tasks',async(req,res)=>{
 const c=await admin(req),body=createSchema.parse(req.body);
 const organizationId=body.organizationId??null,assigneeId=body.assigneeId??null,dueOn=body.dueOn??null;
 const task=await transaction(async db=>{
  await validateOrganization(db,organizationId);await validateAssignee(db,assigneeId);
  const created=(await db.query(`INSERT INTO platform_tasks
   (title,description,status,priority,organization_id,assignee_id,due_on,created_by,updated_by)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING id`,
   [body.title,body.description,body.status,body.priority,organizationId,assigneeId,dueOn,req.user!.id])).rows[0];
  const result=await selectTask(db,created.id);
  await record(db,req,c,'platform.task.created','platform_task',created.id,
   {status:result.status,priority:result.priority,organizationId,assigneeId,dueOn});
  if(assigneeId){
   await record(db,req,c,'platform.task.assigned','platform_task',created.id,
    {assigneeId,status:result.status,dueOn,version:result.version});
   await notifyPlatformTask(db,assigneeId,organizationId,'platform_task_assigned',created.id,
    `platform-task:${created.id}:assigned:${result.version}`,result.title,taskNotificationBody(result));
  }
  return result;
 });
 res.status(201).json(task);
});

const updateSchema=z.object({
 version:z.number().int().min(1),
 title:title.optional(),description:description.optional(),
 status:z.enum(statuses).optional(),priority:z.enum(priorities).optional(),
 organizationId:uuid.nullable().optional(),assigneeId:uuid.nullable().optional(),
 dueOn:z.string().date().nullable().optional(),
}).strict().refine(value=>Object.keys(value).some(key=>key!=='version'),{message:'no_changes'});

platformTaskManagement.patch('/platform/tasks/:id',async(req,res)=>{
 const c=await admin(req),id=uuid.parse(req.params.id),body=updateSchema.parse(req.body);
 const task=await transaction(async db=>{
  const prior=(await db.query('SELECT *,due_on::text AS due_on_text FROM platform_tasks WHERE id=$1 AND archived_at IS NULL FOR UPDATE',[id])).rows[0];
  if(!prior)throw new ApiError(404,'not_found');
  if(prior.version!==body.version)throw new ApiError(409,'version_conflict');
  const organizationId=body.organizationId===undefined?prior.organization_id:body.organizationId;
  const assigneeId=body.assigneeId===undefined?prior.assignee_id:body.assigneeId;
  const dueOn=body.dueOn===undefined?prior.due_on_text:body.dueOn;
  const assignmentChanged=prior.assignee_id!==assigneeId;
  const deadlineChanged=(prior.due_on_text??null)!==(dueOn??null);
  await validateOrganization(db,body.organizationId);await validateAssignee(db,body.assigneeId);
  const changedFields=Object.keys(body).filter(key=>key!=='version').sort();
  const updated=(await db.query(`UPDATE platform_tasks SET title=$2,description=$3,status=$4,priority=$5,
   organization_id=$6,assignee_id=$7,due_on=$8,updated_by=$9,updated_at=now(),version=version+1
   WHERE id=$1 RETURNING id`,
   [id,body.title??prior.title,body.description??prior.description,body.status??prior.status,
    body.priority??prior.priority,organizationId,assigneeId,
    body.dueOn===undefined?prior.due_on:body.dueOn,req.user!.id])).rows[0];
  const result=await selectTask(db,updated.id);
  await record(db,req,c,'platform.task.updated','platform_task',id,
   {changedFields,fromStatus:prior.status,toStatus:result.status,version:result.version});
  if(assignmentChanged){
   const action=assigneeId?(prior.assignee_id?'platform.task.reassigned':'platform.task.assigned'):'platform.task.unassigned';
   await record(db,req,c,action,'platform_task',id,
    {previousAssigneeId:prior.assignee_id,newAssigneeId:assigneeId,status:result.status,dueOn:result.dueOn,version:result.version});
   if(assigneeId)await notifyPlatformTask(db,assigneeId,organizationId,'platform_task_assigned',id,
    `platform-task:${id}:assigned:${result.version}`,result.title,taskNotificationBody(result));
  }
  if(deadlineChanged){
   await record(db,req,c,'platform.task.deadline_changed','platform_task',id,
    {fromDueOn:prior.due_on_text??null,toDueOn:result.dueOn,assigneeId:result.assigneeId,status:result.status,version:result.version});
   if(result.assigneeId)await notifyPlatformTask(db,result.assigneeId,organizationId,'platform_task_deadline_changed',id,
    `platform-task:${id}:deadline:${result.version}`,result.title,taskNotificationBody(result));
  }
  return result;
 });
 res.json(task);
});

platformTaskManagement.post('/platform/tasks/:id/archive',async(req,res)=>{
 const c=await admin(req),id=uuid.parse(req.params.id),body=z.object({version:z.number().int().min(1)}).strict().parse(req.body);
 await transaction(async db=>{
  const prior=(await db.query('SELECT id,version FROM platform_tasks WHERE id=$1 AND archived_at IS NULL FOR UPDATE',[id])).rows[0];
  if(!prior)throw new ApiError(404,'not_found');
  if(prior.version!==body.version)throw new ApiError(409,'version_conflict');
  await db.query('UPDATE platform_tasks SET archived_at=now(),updated_at=now(),updated_by=$2,version=version+1 WHERE id=$1',[id,req.user!.id]);
  await record(db,req,c,'platform.task.archived','platform_task',id,{version:body.version});
 });
 res.json({archived:true,id});
});
