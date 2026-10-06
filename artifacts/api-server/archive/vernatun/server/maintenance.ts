import {Router} from 'express';
import {z} from 'zod';
import type {PoolClient} from 'pg';
import {pool} from './db.js';
import {ApiError,requireAuth,requirePermission} from './access.js';
import {transaction,record} from './operations.js';
import {maintenanceDueOn} from './maintenance-calendar.js';

export const maintenance=Router();maintenance.use(requireAuth);
const uuid=z.string().uuid();
const planInput=z.object({
 assetId:uuid,title:z.string().trim().min(2).max(160),dueOn:z.string().date(),
 frequency:z.enum(['once','daily','weekly','monthly','quarterly','semiannual','annual','custom']).default('once'),
 intervalDays:z.number().int().min(1).max(36600).nullable().optional(),
 categoryId:uuid,priority:z.enum(['low','normal','high','urgent','emergency']).default('normal'),
 instructions:z.string().trim().max(4000).default(''),
 checklist:z.array(z.string().trim().min(1).max(200)).max(30).default([]),
 active:z.boolean().default(false),automatic:z.boolean().default(false)
}).strict().refine(b=>b.frequency!=='custom'||!!b.intervalDays,{message:'Custom interval required'});

// The plan lock and unique cycle constraint are shared by manual and scheduled
// generation. A retry returns the existing event, never a second work order.
export async function generateMaintenance(db:PoolClient,planId:string,today:string,expectedCycle?:number){
 const p=(await db.query(`SELECT p.*,p.due_on::text AS due_on,p.anchor_on::text AS anchor_on,a.building_id FROM maintenance_plans p JOIN assets a ON a.id=p.asset_id WHERE p.id=$1 FOR UPDATE OF p`,[planId])).rows[0];
 if(!p)throw new ApiError(404,'not_found');
 const cycle=expectedCycle??p.cycle_no;
 const old=(await db.query('SELECT * FROM maintenance_events WHERE plan_id=$1 AND cycle_no=$2',[p.id,cycle])).rows[0];
 if(old)return {...old,replayed:true};
 if(cycle!==p.cycle_no)throw new ApiError(409,'stale_cycle');
 if(!p.active||p.frequency==='once'&&p.cycle_no>0||String(p.due_on).slice(0,10)>today)throw new ApiError(409,'maintenance_not_due');
 const category=(await db.query('SELECT id FROM request_categories WHERE id=$1 AND organization_id=$2 AND active',[p.category_id,p.organization_id])).rows[0];
 if(!category)throw new ApiError(409,'category_not_available');
 const policy=(await db.query('SELECT * FROM sla_policies WHERE organization_id=$1 AND priority=$2 AND (category_id=$3 OR category_id IS NULL) ORDER BY category_id NULLS LAST LIMIT 1',[p.organization_id,p.priority,p.category_id])).rows[0];
 if(!policy)throw new ApiError(409,'sla_policy_missing');
 const r=(await db.query(`INSERT INTO resident_requests(organization_id,building_id,unit_id,author_user_id,subject,description,source,category_id,priority,asset_id,contact_method,sla_snapshot)
 VALUES($1,$2,NULL,NULL,$3,$4,'system',$5,$6,$7,'none',$8) RETURNING *`,[p.organization_id,p.building_id,p.title,p.instructions,p.category_id,p.priority,p.asset_id,JSON.stringify(policy)])).rows[0];
 const w=(await db.query(`INSERT INTO work_orders(request_id,technician_id,assigned_by,status,checklist) VALUES($1,NULL,NULL,'queued',$2) RETURNING *`,[r.id,JSON.stringify(p.checklist.map((text:string)=>({text,done:false})))])).rows[0];
 for(const kind of ['response','assignment','arrival','resolution'])await db.query("INSERT INTO request_sla_deadlines(request_id,kind,due_at) VALUES($1,$2,$3::timestamptz+($4::integer*interval '1 minute'))",[r.id,kind,r.created_at,policy[kind+'_minutes']]);
 const event=(await db.query(`INSERT INTO maintenance_events(organization_id,plan_id,cycle_no,due_on,request_id,work_order_id,plan_snapshot)
 VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[p.organization_id,p.id,p.cycle_no,p.due_on,r.id,w.id,JSON.stringify({title:p.title,frequency:p.frequency,intervalDays:p.interval_days,anchorOn:p.anchor_on,instructions:p.instructions,checklist:p.checklist,priority:p.priority})])).rows[0];
 await db.query('UPDATE maintenance_plans SET current_event_id=$2,last_error=NULL WHERE id=$1',[p.id,event.id]);
 await db.query("INSERT INTO request_history(request_id,actor_id,actor_role,action,from_status,to_status,note) VALUES($1,NULL,'system','maintenance.generate','new','queued',$2)",[r.id,p.title]);
 await db.query("INSERT INTO audit_events(organization_id,actor_user_id,action,entity_type,entity_id,details) VALUES($1,NULL,'maintenance.generate','maintenance_event',$2,$3)",[p.organization_id,event.id,JSON.stringify({planId:p.id,requestId:r.id})]);
 return event;
}

// Only the existing independent manager approval can finish maintenance.
export async function finishMaintenance(db:PoolClient,requestId:string,actorId:string){
 const event=(await db.query('SELECT * FROM maintenance_events WHERE request_id=$1 AND completed_at IS NULL FOR UPDATE',[requestId])).rows[0];
 if(!event)return;
 const p=(await db.query('SELECT *,anchor_on::text AS anchor_on FROM maintenance_plans WHERE id=$1 FOR UPDATE',[event.plan_id])).rows[0];
 const next=maintenanceDueOn(String(p.anchor_on).slice(0,10),p.frequency,p.cycle_no+1,p.interval_days);
 await db.query('UPDATE maintenance_events SET completed_at=now() WHERE id=$1',[event.id]);
 await db.query(`UPDATE maintenance_plans SET cycle_no=cycle_no+1,due_on=COALESCE($2::date,due_on),active=active AND $2::date IS NOT NULL,
 current_event_id=NULL,last_completed_at=now(),completed_at=CASE WHEN $2::date IS NULL THEN now() ELSE completed_at END,
 completed_by=$3,report=(SELECT report FROM work_orders WHERE id=$4),version=version+1 WHERE id=$1`,[p.id,next,actorId,event.work_order_id]);
}
export async function runMaintenanceGeneration(today=new Date().toISOString().slice(0,10)){
 const plans=(await pool.query("SELECT p.id FROM maintenance_plans p JOIN organizations o ON o.id=p.organization_id WHERE p.active AND p.automatic AND p.due_on<=$1 AND p.current_event_id IS NULL ORDER BY p.due_on,p.id LIMIT 50",[today])).rows;
 for(const p of plans){
  try{
   // Subscription policy is checked at execution, not just when activating.
   const {subscriptionPolicy}=await import('./subscription-policy.js');
   const org=(await pool.query('SELECT organization_id FROM maintenance_plans WHERE id=$1',[p.id])).rows[0];
   const policy=await subscriptionPolicy(org.organization_id);
   if(policy.readOnly||!policy.modules.includes('maintenance')||!policy.modules.includes('requests'))continue;
   await transaction(db=>generateMaintenance(db,p.id,today));
  }catch(e){await pool.query('UPDATE maintenance_plans SET last_error=$2 WHERE id=$1',[p.id,e instanceof ApiError?e.code:'generation_failed'])}
 }
}
maintenance.post('/maintenance',async(req,res)=>{
 const c=await requirePermission(req,'assets.manage'),b=planInput.parse(req.body);
 maintenanceDueOn(b.dueOn,b.frequency,0,b.intervalDays??undefined);
 res.status(201).json(await transaction(async db=>{
  const a=(await db.query('SELECT id FROM assets WHERE id=$1 AND organization_id=$2 AND ($3::uuid IS NULL OR building_id=$3)',[b.assetId,c.organization_id,c.building_id])).rows[0];
  if(!a)throw new ApiError(404,'not_found');
  const cat=(await db.query('SELECT id FROM request_categories WHERE id=$1 AND organization_id=$2 AND active',[b.categoryId,c.organization_id])).rows[0];
  if(!cat)throw new ApiError(404,'category_not_found');
  const p=(await db.query(`INSERT INTO maintenance_plans(organization_id,asset_id,title,due_on,anchor_on,frequency,interval_days,category_id,priority,instructions,checklist,active,automatic,configured_by)
  VALUES($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,[c.organization_id,a.id,b.title,b.dueOn,b.frequency,b.intervalDays??null,b.categoryId,b.priority,b.instructions,JSON.stringify(b.checklist),b.active,b.automatic,req.user!.id])).rows[0];
  await record(db,req,c,'maintenance.plan','maintenance_plan',p.id);return p;
 }));
});
maintenance.post('/maintenance/:id/configure',async(req,res)=>{
 const c=await requirePermission(req,'assets.manage');
 const b=z.object({version:z.number().int().positive(),active:z.boolean(),automatic:z.boolean(),categoryId:uuid.optional()}).strict().parse(req.body);
 res.json(await transaction(async db=>{
  const p=(await db.query('SELECT p.* FROM maintenance_plans p JOIN assets a ON a.id=p.asset_id WHERE p.id=$1 AND p.organization_id=$2 AND ($3::uuid IS NULL OR a.building_id=$3) FOR UPDATE OF p',[uuid.parse(req.params.id),c.organization_id,c.building_id])).rows[0];
  if(!p)throw new ApiError(404,'not_found');
  if(p.version!==b.version)throw new ApiError(409,'stale_version');
  if(b.active&&p.completed_at&&!p.current_event_id)throw new ApiError(409,'historical_plan_closed');
  const category=b.categoryId??p.category_id;
  if(b.active&&!(await db.query('SELECT id FROM request_categories WHERE id=$1 AND organization_id=$2 AND active',[category,c.organization_id])).rowCount)throw new ApiError(400,'category_required');
  const r=(await db.query('UPDATE maintenance_plans SET active=$2,automatic=$3,category_id=$4,version=version+1 WHERE id=$1 RETURNING *',[p.id,b.active,b.automatic,category])).rows[0];
  await record(db,req,c,'maintenance.configure','maintenance_plan',p.id);return r;
 }));
});
maintenance.post('/maintenance/:id/generate',async(req,res)=>{
 const c=await requirePermission(req,'assets.manage'),id=uuid.parse(req.params.id);
 const b=z.object({cycleNo:z.number().int().nonnegative().optional()}).strict().parse(req.body??{});
 if(!(await pool.query('SELECT p.id FROM maintenance_plans p JOIN assets a ON a.id=p.asset_id WHERE p.id=$1 AND p.organization_id=$2 AND ($3::uuid IS NULL OR a.building_id=$3)',[id,c.organization_id,c.building_id])).rowCount)throw new ApiError(404,'not_found');
 await requirePermission(req,'requests.assign');
 res.json(await transaction(async db=>{
  const event=await generateMaintenance(db,id,new Date().toISOString().slice(0,10),b.cycleNo);
  if(!event.replayed)await record(db,req,c,'maintenance.generate_requested','maintenance_event',event.id);
  return event;
 }));
});
maintenance.get('/maintenance/:id/events',async(req,res)=>{
 const c=await requirePermission(req,'assets.read'),id=uuid.parse(req.params.id);
 if(!(await pool.query('SELECT p.id FROM maintenance_plans p JOIN assets a ON a.id=p.asset_id WHERE p.id=$1 AND p.organization_id=$2 AND ($3::uuid IS NULL OR a.building_id=$3)',[id,c.organization_id,c.building_id])).rowCount)throw new ApiError(404,'not_found');
 res.json((await pool.query(`SELECT e.*,r.status,w.status AS work_status,w.report,w.checklist,t.name AS technician_name,
 (SELECT json_agg(json_build_object('id',p.id,'photo_type',p.photo_type)) FROM request_photos p WHERE p.request_id=r.id) AS photos
 FROM maintenance_events e JOIN resident_requests r ON r.id=e.request_id JOIN work_orders w ON w.id=e.work_order_id LEFT JOIN users t ON t.id=w.technician_id WHERE e.plan_id=$1 ORDER BY e.cycle_no DESC`,[id])).rows);
});
