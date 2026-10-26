import type {Request} from 'express';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import {pool} from './db.js';
import {ApiError,context,requirePermission,scopedUnit} from './access.js';
import {transaction,idempotent} from './operations.js';
import {activeLeasePredicate} from './lease-policy.js';

export const priorities=['low','normal','high','urgent','emergency'] as const;
const uuid=z.string().uuid(),time=z.string().datetime({offset:true});
export const operationalInput=z.object({
 key:uuid.optional(),unitId:uuid,subject:z.string().trim().min(3).max(160),description:z.string().trim().max(4000).default(''),
 categoryId:uuid.optional(),priority:z.enum(priorities).default('normal'),reportedForUserId:uuid.optional(),
 contactMethod:z.enum(['app','phone','email','none']).default('app'),preferredVisitStart:time.optional(),preferredVisitEnd:time.optional(),
 technicianId:uuid.optional(),assetId:uuid.optional()
}).strict();

export async function eligiblePeople(db:PoolClient|typeof pool,org:string,building:string,unit:string,role:'resident'|'technician',id?:string){
 return (await db.query(`SELECT DISTINCT x.id,x.name FROM users x
 JOIN role_assignments a ON a.user_id=x.id JOIN memberships m ON m.user_id=x.id AND m.organization_id=a.organization_id
 WHERE a.organization_id=$1 AND a.active AND m.active AND NOT x.blocked AND a.starts_at<=now()
 AND (a.expires_at IS NULL OR a.expires_at>now()) AND ($5::uuid IS NULL OR x.id=$5)
 AND ${activeLeasePredicate('a')}
 AND (($4='technician' AND a.role_key='technician' AND (a.building_id IS NULL OR a.building_id=$2) AND (a.unit_id IS NULL OR a.unit_id=$3))
 OR ($4='resident' AND a.role_key IN('unit_owner','renter','family') AND a.unit_id=$3))
 AND NOT EXISTS(SELECT 1 FROM resident_delegations d WHERE d.assignment_id=a.id AND
 (d.revoked_at IS NOT NULL OR d.expires_at<=now() OR NOT EXISTS(SELECT 1 FROM role_assignments owner JOIN memberships om ON om.user_id=owner.user_id AND om.organization_id=owner.organization_id JOIN users ou ON ou.id=owner.user_id WHERE owner.id=d.owner_assignment_id AND owner.active AND om.active AND NOT ou.blocked AND owner.starts_at<=now() AND (owner.expires_at IS NULL OR owner.expires_at>now()))))`,
 [org,building,unit,role,id??null])).rows;
}

export async function prepareOperationalRequest(req:Request,trustedInput?:unknown){
 const b=operationalInput.parse(trustedInput??req.body),c=await context(req);
 const staff=c.permissions.includes('requests.assign');
 const equipmentTech=c.role_key==='technician'&&!!b.assetId;
 await requirePermission(req,staff?'requests.assign':equipmentTech?'workorders.execute':'requests.create');
 const unit=await scopedUnit(c,b.unitId);
 if((staff||equipmentTech)&&(!b.categoryId||!b.key))throw new ApiError(400,'category_and_key_required');
 if(!staff&&(b.reportedForUserId||b.technicianId))throw new ApiError(403,'forbidden');
  if(b.assetId)await requirePermission(req,'assets.read');
  return {b,c,staff,equipmentTech,unit};
}
type PreparedRequest=Awaited<ReturnType<typeof prepareOperationalRequest>>;
type RequestHistory=(db:PoolClient,req:Request,row:any,action:string,to:string,note?:string)=>Promise<void>;
export async function commitPreparedRequest(db:PoolClient,req:Request,prepared:PreparedRequest,appendHistory:RequestHistory){
   const {b,c,staff,equipmentTech,unit}=prepared;
  const tech=equipmentTech?req.user!.id:b.technicianId;
  const run=async()=>{
   // Actor/unit permission is fresh on every retry. Mutable availability belongs
   // inside the new-write branch: an expired visit window or retired category
   // must not prevent acknowledging an already committed operation.
   if((b.preferredVisitStart||b.preferredVisitEnd)&&(!b.preferredVisitStart||!b.preferredVisitEnd||Date.parse(b.preferredVisitEnd)<=Date.parse(b.preferredVisitStart)||Date.parse(b.preferredVisitStart)<=Date.now()))throw new ApiError(400,'invalid_visit_window');
   if(b.categoryId&&!(await db.query('SELECT id FROM request_categories WHERE id=$1 AND organization_id=$2 AND active',[b.categoryId,c.organization_id])).rowCount)throw new ApiError(404,'category_not_found');
   if(b.reportedForUserId&&!(await eligiblePeople(db,c.organization_id!,unit.building_id,unit.id,'resident',b.reportedForUserId)).length)throw new ApiError(403,'resident_not_eligible');
   if(tech&&!(await eligiblePeople(db,c.organization_id!,unit.building_id,unit.id,'technician',tech)).length)throw new ApiError(403,'technician_not_eligible');
   if(b.assetId&&!(await db.query('SELECT id FROM assets WHERE id=$1 AND organization_id=$2 AND building_id=$3',[b.assetId,c.organization_id,unit.building_id])).rowCount)throw new ApiError(404,'asset_not_found');
   const policy=b.categoryId?(await db.query('SELECT * FROM sla_policies WHERE organization_id=$1 AND priority=$2 AND (category_id=$3 OR category_id IS NULL) ORDER BY category_id NULLS LAST LIMIT 1',[c.organization_id,b.priority,b.categoryId])).rows[0]:null;
   if(b.categoryId&&!policy)throw new ApiError(409,'sla_policy_missing');
   const source=c.role_key==='dispatcher'?'dispatcher_phone':staff?'manager':equipmentTech?'system':'resident_app';
   const row=(await db.query(`INSERT INTO resident_requests(organization_id,unit_id,author_user_id,subject,description,source,reported_for_user_id,category_id,priority,contact_method,preferred_visit_start,preferred_visit_end,asset_id,sla_snapshot)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [c.organization_id,b.unitId,req.user!.id,b.subject,b.description,source,b.reportedForUserId??null,b.categoryId??null,b.priority,b.contactMethod,b.preferredVisitStart??null,b.preferredVisitEnd??null,b.assetId??null,policy?JSON.stringify(policy):null])).rows[0];
   if(policy)for(const kind of ['response','assignment','arrival','resolution'])await db.query("INSERT INTO request_sla_deadlines(request_id,kind,due_at) VALUES($1,$2,$3::timestamptz+($4::integer*interval '1 minute'))",[row.id,kind,row.created_at,policy[kind+'_minutes']]);
   await appendHistory(db,req,row,'create','new');
   if(tech){
    await db.query('INSERT INTO work_orders(request_id,technician_id,assigned_by) VALUES($1,$2,$3)',[row.id,tech,req.user!.id]);
    await db.query("UPDATE resident_requests SET status='assigned',version=version+1 WHERE id=$1",[row.id]);
    await appendHistory(db,req,row,'assign','assigned');
    await updateSla(db,row,'assign');
    row.status='assigned';row.version++;
   }
   return row;
  };
  return b.key?idempotent(db,req,b.key,b,run):run();
}
export async function createOperationalRequest(req:Request,appendHistory:RequestHistory,trustedInput?:unknown){
 const prepared=await prepareOperationalRequest(req,trustedInput);
 return transaction(db=>commitPreparedRequest(db,req,prepared,appendHistory));
}

export async function requestExtras(id:string,db:PoolClient|typeof pool=pool){
 const sla=(await db.query('SELECT *,satisfied_at IS NULL AND due_at<now() AS overdue FROM request_sla_deadlines WHERE request_id=$1 ORDER BY due_at',[id])).rows;
 const visits=(await db.query('SELECT * FROM request_visits WHERE request_id=$1 ORDER BY created_at DESC',[id])).rows;
 const visitHistory=(await db.query('SELECT h.*,u.name AS actor FROM visit_history h JOIN request_visits v ON v.id=h.visit_id JOIN users u ON u.id=h.actor_id WHERE v.request_id=$1 ORDER BY h.created_at',[id])).rows;
 const materials=(await db.query('SELECT * FROM work_materials WHERE request_id=$1 ORDER BY created_at',[id])).rows;
 return {sla,visits,visitHistory,materials};
}
async function extendPausedDeadline(db:PoolClient,r:any){
 if(r.paused_at&&r.sla_snapshot?.pause_resolution)await db.query("UPDATE request_sla_deadlines SET due_at=due_at+greatest(interval '0 seconds',now()-$2::timestamptz) WHERE request_id=$1 AND kind='resolution' AND satisfied_at IS NULL",[r.id,r.paused_at]);
}
export async function executionAction(db:PoolClient,r:any,action:string,note:string,reason?:string){
 if(!['accept','cannot_perform','pause','resume'].includes(action))return null;
 if(!r.work_order_id||!['assigned','in_progress'].includes(r.work_status))throw new ApiError(409,'invalid_transition');
 if(action==='accept'){
  if(r.work_status!=='assigned'||r.accepted_at||r.blocked_reason)throw new ApiError(409,'invalid_transition');
  await db.query('UPDATE work_orders SET accepted_at=now() WHERE request_id=$1',[r.id]);
 }else if(action==='pause'){
  if(r.work_status!=='in_progress'||r.paused_at||r.blocked_reason)throw new ApiError(409,'invalid_transition');
  if(note.trim().length<5)throw new ApiError(400,'reason_required');
  await db.query('UPDATE work_orders SET paused_at=now() WHERE request_id=$1',[r.id]);
 }else if(action==='resume'){
  if(!r.paused_at||r.blocked_reason)throw new ApiError(409,'invalid_transition');
  await extendPausedDeadline(db,r);
  await db.query('UPDATE work_orders SET paused_at=NULL WHERE request_id=$1',[r.id]);
 }else{
  if(r.blocked_reason||!reason||reason==='other'&&note.trim().length<5)throw new ApiError(400,'reason_required');
  await extendPausedDeadline(db,r);
  await db.query('UPDATE work_orders SET blocked_reason=$2,paused_at=NULL,accepted_at=NULL WHERE request_id=$1',[r.id,reason]);
  return {state:'assigned',requestState:'assigned'};
 }
 return {state:r.work_status,requestState:r.status};
}
export async function updateSla(db:PoolClient,r:any,action:string){
 const kinds=action==='assign'?['response','assignment']:action==='accept'?['response']:action==='start'?['arrival']:['approve','confirm'].includes(action)?['resolution']:[];
 if(kinds.length)await db.query('UPDATE request_sla_deadlines SET satisfied_at=COALESCE(satisfied_at,now()) WHERE request_id=$1 AND kind=ANY($2::text[])',[r.id,kinds]);
 if(['reject','reopen'].includes(action))await db.query("UPDATE request_sla_deadlines SET satisfied_at=NULL WHERE request_id=$1 AND kind='resolution'",[r.id]);
}
export async function resetVisitTechnician(db:PoolClient,req:Request,id:string){
 const visits=(await db.query("UPDATE request_visits SET technician_confirmed_at=NULL,status='proposed',version=version+1 WHERE request_id=$1 AND status IN('proposed','confirmed') RETURNING *",[id])).rows;
 for(const v of visits)await db.query("INSERT INTO visit_history(visit_id,actor_id,action,snapshot) VALUES($1,$2,'technician_reassigned',$3)",[v.id,req.user!.id,JSON.stringify(v)]);
}
