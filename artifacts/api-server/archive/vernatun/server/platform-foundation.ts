import {Router} from 'express';
import {z} from 'zod';
import {randomBytes,createHash} from 'node:crypto';
import {pool} from './db.js';
import {ApiError,context,requireAuth,requirePermission} from './access.js';
import {record,transaction} from './operations.js';
import {moduleKeys,subscriptionPolicy} from './subscription-policy.js';
import {assertEmailConfigured} from './email.js';
import {sendInvitation} from './invitation-delivery.js';
import {organizationDelegableRoles} from './roles.js';

const uuid=z.string().uuid(),reason=z.string().trim().min(8).max(1000);
const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{
 const d=new Date(v+'T00:00:00Z');return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===v;
});
const planSchema=z.object({name:z.string().trim().min(2).max(120),amountMinor:z.string().regex(/^\d+$/).max(16),
 currency:z.enum(['AMD','RUB','USD']),buildingLimit:z.number().int().min(1).max(100000),
 allowedModules:z.array(z.enum(moduleKeys)).max(moduleKeys.length).default([...moduleKeys]),graceDays:z.number().int().min(0).max(90).default(7)}).strict();
const statuses=z.enum(['trial','active','past_due','suspended','cancelled','expired']);
export const platformFoundation=Router();platformFoundation.use(requireAuth);

platformFoundation.get('/subscriptions',async(req,res)=>{
 await requirePermission(req,'subscriptions.manage');
 const subscriptions=(await pool.query(`SELECT s.*,o.name AS organization_name,o.subscription_enforced,p.name AS plan_name,
  p.amount_minor::text,p.currency,p.building_limit,p.allowed_modules,p.grace_days,
  CASE WHEN s.status='paused' THEN 'suspended'
   WHEN s.status IN ('active','trial','past_due') AND s.ends_on<(now() AT TIME ZONE 'Asia/Yerevan')::date THEN 'expired'
   WHEN s.starts_on>(now() AT TIME ZONE 'Asia/Yerevan')::date THEN 'not_started' ELSE s.status END AS effective_status
  FROM subscriptions s JOIN organizations o ON o.id=s.organization_id JOIN subscription_plans p ON p.id=s.plan_id
  ORDER BY s.created_at DESC,s.id DESC`)).rows;
 res.json({plans:(await pool.query('SELECT *,amount_minor::text FROM subscription_plans ORDER BY name')).rows,
  subscriptions,organizations:(await pool.query('SELECT id,name,subscription_enforced FROM organizations ORDER BY name')).rows,moduleKeys});
});
platformFoundation.post('/subscription-plans',async(req,res)=>{
 const c=await requirePermission(req,'subscriptions.manage'),b=planSchema.parse(req.body);
 res.status(201).json(await transaction(async db=>{
  const r=(await db.query(`INSERT INTO subscription_plans(name,amount_minor,currency,building_limit,allowed_modules,grace_days)
   VALUES($1,$2,$3,$4,$5,$6) RETURNING *,amount_minor::text`,[b.name,b.amountMinor,b.currency,b.buildingLimit,[...new Set(b.allowedModules)],b.graceDays])).rows[0];
  await record(db,req,c,'subscription.plan.create','subscription_plan',r.id,{modules:r.allowed_modules,buildingLimit:r.building_limit});return r;
 }));
});
platformFoundation.patch('/subscription-plans/:id',async(req,res)=>{
 const c=await requirePermission(req,'subscriptions.manage'),b=planSchema.extend({reason}).parse(req.body);
 res.json(await transaction(async db=>{
  const previous=(await db.query('SELECT * FROM subscription_plans WHERE id=$1 FOR UPDATE',[uuid.parse(req.params.id)])).rows[0];
  if(!previous)throw new ApiError(404,'not_found');
  await db.query(`SELECT id FROM organizations WHERE subscription_enforced AND id IN (
   SELECT organization_id FROM subscriptions WHERE plan_id=$1 AND status IN ('active','trial','past_due'))
   ORDER BY id FOR UPDATE`,[previous.id]);
  const used=await db.query(`SELECT o.id FROM organizations o WHERE o.subscription_enforced AND
   EXISTS(SELECT 1 FROM subscriptions s WHERE s.organization_id=o.id AND s.plan_id=$1 AND s.status IN ('active','trial','past_due'))
   AND (SELECT count(*) FROM buildings b WHERE b.organization_id=o.id)>$2`,[previous.id,b.buildingLimit]);
  if(used.rowCount)throw new ApiError(409,'plan_limit');
  const r=(await db.query(`UPDATE subscription_plans SET name=$1,amount_minor=$2,currency=$3,building_limit=$4,allowed_modules=$5,grace_days=$6
   WHERE id=$7 RETURNING *,amount_minor::text`,[b.name,b.amountMinor,b.currency,b.buildingLimit,[...new Set(b.allowedModules)],b.graceDays,previous.id])).rows[0];
  await record(db,req,c,'subscription.plan.update','subscription_plan',r.id,{reason:b.reason,before:previous,after:r});return r;
 }));
});
platformFoundation.post('/subscriptions',async(req,res)=>{
 const c=await requirePermission(req,'subscriptions.manage');
 const b=z.object({organizationId:uuid,planId:uuid,startsOn:day,endsOn:day,status:z.enum(['trial','active']).default('active')}).strict().parse(req.body);
 if(b.endsOn<b.startsOn)throw new ApiError(400,'invalid_dates');
 res.status(201).json(await transaction(async db=>{
  if(!(await db.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[b.organizationId])).rowCount)throw new ApiError(404,'not_found');
  const plan=(await db.query('SELECT * FROM subscription_plans WHERE id=$1',[b.planId])).rows[0];if(!plan)throw new ApiError(404,'not_found');
  if((await db.query(`SELECT id FROM subscriptions WHERE organization_id=$1 AND status IN ('active','trial','past_due')
   AND starts_on<=$2 AND ends_on>=$3`,[b.organizationId,b.endsOn,b.startsOn])).rowCount)throw new ApiError(409,'subscription_overlap');
  if(Number((await db.query('SELECT count(*) FROM buildings WHERE organization_id=$1',[b.organizationId])).rows[0].count)>plan.building_limit)throw new ApiError(409,'plan_limit');
  const r=(await db.query(`INSERT INTO subscriptions(organization_id,plan_id,starts_on,ends_on,created_by,status)
   VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[b.organizationId,b.planId,b.startsOn,b.endsOn,req.user!.id,b.status])).rows[0];
  await db.query('UPDATE organizations SET subscription_enforced=true WHERE id=$1',[b.organizationId]);
  await record(db,req,{...c,organization_id:b.organizationId},'subscription.create','subscription',r.id,{status:r.status,enforced:true});return r;
 }));
});
platformFoundation.patch('/subscriptions/:id',async(req,res)=>{
 const c=await requirePermission(req,'subscriptions.manage');
 const b=z.object({status:statuses,reason,graceUntil:z.string().datetime({offset:true}).nullable().optional()}).strict().parse(req.body);
 res.json(await transaction(async db=>{
  const row=(await db.query("SELECT *,ends_on>=(now() AT TIME ZONE 'Asia/Yerevan')::date AS within_dates FROM subscriptions WHERE id=$1 FOR UPDATE",[uuid.parse(req.params.id)])).rows[0];
  if(!row)throw new ApiError(404,'not_found');
  if(['expired','cancelled'].includes(row.status)&&!['expired','cancelled'].includes(b.status))throw new ApiError(409,'invalid_transition');
  if(['active','trial'].includes(b.status)&&!row.within_dates)throw new ApiError(409,'subscription_expired');
  await db.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[row.organization_id]);
  if(['active','trial','past_due'].includes(b.status)){
   if((await db.query(`SELECT id FROM subscriptions WHERE organization_id=$1 AND id<>$2
    AND status IN ('active','trial','past_due') AND starts_on<=$3 AND ends_on>=$4`,
    [row.organization_id,row.id,row.ends_on,row.starts_on])).rowCount)throw new ApiError(409,'subscription_overlap');
   const capacity=(await db.query('SELECT building_limit FROM subscription_plans WHERE id=$1',[row.plan_id])).rows[0];
   if(Number((await db.query('SELECT count(*) FROM buildings WHERE organization_id=$1',[row.organization_id])).rows[0].count)>capacity.building_limit)
    throw new ApiError(409,'plan_limit');
  }
  const r=(await db.query(`UPDATE subscriptions s SET status=$1,updated_at=now(),
   grace_until=CASE WHEN $1='past_due' THEN CASE WHEN $4::boolean THEN $2::timestamptz
    ELSE now()+(SELECT grace_days FROM subscription_plans WHERE id=s.plan_id)*interval '1 day' END ELSE NULL END
   WHERE id=$3 RETURNING *`,[b.status,b.graceUntil??null,row.id,b.graceUntil!==undefined])).rows[0];
  await record(db,req,{...c,organization_id:row.organization_id},'subscription.status','subscription',row.id,{reason:b.reason,before:row.status,after:r.status,graceUntil:r.grace_until});return r;
 }));
});
platformFoundation.get('/organizations/:id/subscription-policy',async(req,res)=>{
 await requirePermission(req,'subscriptions.manage');const id=uuid.parse(req.params.id);
 if(!(await pool.query('SELECT id FROM organizations WHERE id=$1',[id])).rowCount)throw new ApiError(404,'not_found');
 res.json(await subscriptionPolicy(id));
});
platformFoundation.patch('/organizations/:id/subscription-policy',async(req,res)=>{
 const c=await requirePermission(req,'subscriptions.manage'),id=uuid.parse(req.params.id);
 const b=z.object({enabled:z.boolean(),reason}).strict().parse(req.body);
 await transaction(async db=>{
  const previous=(await db.query('SELECT subscription_enforced FROM organizations WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(!previous)throw new ApiError(404,'not_found');
  await db.query('UPDATE organizations SET subscription_enforced=$1 WHERE id=$2',[b.enabled,id]);
  await record(db,req,{...c,organization_id:id},'subscription.policy','organization',id,{reason:b.reason,before:previous.subscription_enforced,after:b.enabled});
 });
 res.json(await subscriptionPolicy(id));
});
platformFoundation.patch('/organizations/:id/module-overrides/:module',async(req,res)=>{
 const c=await requirePermission(req,'subscriptions.manage'),org=uuid.parse(req.params.id),module=z.enum(moduleKeys).parse(req.params.module);
 const b=z.object({state:z.enum(['inherited','enabled','disabled']),reason}).strict().parse(req.body);
 await transaction(async db=>{
  if(!(await db.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[org])).rowCount)throw new ApiError(404,'not_found');
  const before=(await db.query('SELECT * FROM module_entitlements WHERE organization_id=$1 AND module=$2 FOR UPDATE',[org,module])).rows[0];
  await db.query(`INSERT INTO module_entitlements(organization_id,module,override_state,override_reason,updated_by)
   VALUES($1,$2,$3,$4,$5) ON CONFLICT(organization_id,module) DO UPDATE SET
   override_state=$3,override_reason=$4,updated_by=$5,updated_at=now()`,[org,module,b.state,b.reason,req.user!.id]);
  await record(db,req,{...c,organization_id:org},'subscription.module.override','module',module,{reason:b.reason,before:before?.override_state??'inherited',after:b.state});
 });
 res.json(await subscriptionPolicy(org));
});

platformFoundation.get('/audit',async(req,res)=>{
 const c=await context(req),platform=c.permissions.includes('platform.audit');
 await requirePermission(req,platform?'platform.audit':'audit.read');
 const q=z.object({paged:z.enum(['true','false']).optional(),page:z.coerce.number().int().min(1).max(10000).default(1),
  pageSize:z.coerce.number().int().min(1).max(100).default(25),organizationId:uuid.optional(),actorId:uuid.optional(),
  actor:z.string().trim().max(100).optional(),action:z.string().trim().max(100).optional(),entityType:z.string().trim().max(80).optional(),
  result:z.enum(['success','failure']).optional(),from:z.string().datetime({offset:true}).optional(),to:z.string().datetime({offset:true}).optional(),
  sort:z.enum(['created_at','action','actor']).default('created_at'),direction:z.enum(['asc','desc']).default('desc')}).strict().parse(req.query);
 if(q.from&&q.to&&Date.parse(q.from)>Date.parse(q.to))throw new ApiError(400,'invalid_dates');
 if(!platform&&q.organizationId&&q.organizationId!==c.organization_id)throw new ApiError(403,'forbidden');
 const values:unknown[]=[],where:string[]=[];
 const add=(expression:string,value:unknown)=>{values.push(value);where.push(expression.replace('?',`$${values.length}`))};
 const org=platform?q.organizationId:c.organization_id;if(org)add('a.organization_id=?',org);
 if(q.actorId)add('a.actor_user_id=?',q.actorId);
 if(q.actor)add('u.name ILIKE ?',`%${q.actor}%`);
 if(q.action)add('a.action=?',q.action);
 if(q.entityType)add('a.entity_type=?',q.entityType);
 if(q.from)add('a.created_at>=?::timestamptz',q.from);
 if(q.to)add('a.created_at<=?::timestamptz',q.to);
 const result=`CASE WHEN a.action LIKE '%.failed' THEN 'failure' ELSE COALESCE(a.details->>'result','success') END`;
 if(q.result)add(result+'=?',q.result);
 const predicate=where.join(' AND ')||'TRUE',sort={created_at:'a.created_at',action:'a.action',actor:'u.name'}[q.sort];
 const total=Number((await pool.query(`SELECT count(*) FROM audit_events a LEFT JOIN users u ON u.id=a.actor_user_id WHERE ${predicate}`,values)).rows[0].count);
 const limit=q.paged==='true'?q.pageSize:100,offset=q.paged==='true'?(q.page-1)*limit:0;
 const items=(await pool.query(`SELECT a.*,u.name AS actor,o.name AS organization_name,${result} AS result
  FROM audit_events a LEFT JOIN users u ON u.id=a.actor_user_id LEFT JOIN organizations o ON o.id=a.organization_id
  WHERE ${predicate} ORDER BY ${sort} ${q.direction},a.id ${q.direction} LIMIT $${values.length+1} OFFSET $${values.length+2}`,[...values,limit,offset])).rows;
 res.json(q.paged==='true'?{items,total,page:q.page,pageSize:limit}:items);
});
platformFoundation.get('/invitations',async(req,res)=>{
 const c=await context(req),platform=c.permissions.includes('platform.invite');
 await requirePermission(req,platform?'platform.invite':'people.invite');
 const values:unknown[]=platform?[]:[c.organization_id,c.building_id,c.unit_id];
 res.json((await pool.query(`SELECT i.id,i.email,i.role_key,i.organization_id,o.name AS organization_name,
  i.expires_at,i.accepted_at,i.revoked_at,i.email_delivery_status,i.email_delivery_at,i.delegation_id,
  d.outcome AS delivery_outcome,d.outcome_at AS delivery_outcome_at,d.provider AS delivery_provider,
  COALESCE(d.delivery_evidence,false) AS delivery_evidence,
  CASE WHEN i.revoked_at IS NOT NULL THEN 'revoked' WHEN i.accepted_at IS NOT NULL THEN 'accepted'
   WHEN i.expires_at<=now() THEN 'expired' ELSE 'pending' END AS status
   FROM invitations i LEFT JOIN organizations o ON o.id=i.organization_id
  JOIN invitation_delivery_outcomes d ON d.invitation_id=i.id WHERE ${platform?'TRUE':
   'i.organization_id=$1 AND ($2::uuid IS NULL OR i.building_id=$2) AND ($3::uuid IS NULL OR i.unit_id=$3)'}
  ORDER BY i.expires_at DESC,i.id DESC`,values)).rows);
});
platformFoundation.post('/invitations/:id/resend',async(req,res)=>{
 const c=await context(req),platform=c.permissions.includes('platform.invite');
 await requirePermission(req,platform?'platform.invite':'people.invite');assertEmailConfigured();
 const body=z.object({email:z.string().email().max(254).optional()}).strict().parse(req.body??{});
 const token=randomBytes(32).toString('hex'),id=uuid.parse(req.params.id);
 const row=await transaction(async db=>{
  const i=(await db.query('SELECT * FROM invitations WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(!i||(!platform&&i.organization_id!==c.organization_id))throw new ApiError(404,'not_found');
   if((platform&&i.role_key!=='support'&&!organizationDelegableRoles.includes(i.role_key))||
    (!i.organization_id&&i.role_key!=='support')||i.delegation_id||
   (c.building_id&&c.building_id!==i.building_id)||(c.unit_id&&c.unit_id!==i.unit_id))throw new ApiError(403,'forbidden');
  if(i.accepted_at||i.revoked_at)throw new ApiError(409,'invalid_transition');
  const updated=(await db.query(`UPDATE invitations SET token_hash=$1,expires_at=now()+interval '48 hours',
   email_delivery_status='unknown',email_delivery_at=NULL,current_email_attempt_id=NULL,
   email=COALESCE($3,email) WHERE id=$2 RETURNING id,expires_at`,
   [createHash('sha256').update(token).digest('hex'),id,body.email?.toLowerCase()??null])).rows[0];
  await record(db,req,{...c,organization_id:i.organization_id},'invitation.resend','invitation',id,{addressChanged:!!body.email&&body.email.toLowerCase()!==i.email});return updated;
 });
 res.json({...row,...await sendInvitation(req,c,id,token)});
});
