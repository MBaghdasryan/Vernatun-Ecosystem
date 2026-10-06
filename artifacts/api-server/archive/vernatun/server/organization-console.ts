import {Router} from 'express';
import {z} from 'zod';
import {pool} from './db.js';
import {context,requireAuth,requirePermission,ApiError} from './access.js';
import {transaction,idempotent,record} from './operations.js';
import {subscriptionPolicy} from './subscription-policy.js';
import {uuid,title,globalAdmin,version} from './platform-ops-shared.js';
export const organizationConsole=Router();organizationConsole.use(requireAuth);
organizationConsole.get('/platform/operators',async(req,res)=>{
 const current=await context(req),c=await requirePermission(req,current.permissions.includes('onboarding.manage')?'onboarding.manage':'support.assign');if(c.organization_id)throw new ApiError(403,'forbidden');
 res.json((await pool.query(`SELECT DISTINCT u.id,u.name,a.role_key FROM users u JOIN role_assignments a ON a.user_id=u.id
 WHERE NOT u.blocked AND a.active AND a.organization_id IS NULL AND a.role_key IN ('support','platform_admin')
 AND a.starts_at<=now() AND (a.expires_at IS NULL OR a.expires_at>now()) ORDER BY u.name`)).rows);
});
organizationConsole.get('/platform/organizations/:id',async(req,res)=>{
 const c=await requirePermission(req,'organizations.read');if(c.organization_id)throw new ApiError(403,'forbidden');
 const id=uuid.parse(req.params.id),o=(await pool.query('SELECT * FROM organizations WHERE id=$1',[id])).rows[0];if(!o)throw new ApiError(404,'not_found');
 const policy=await subscriptionPolicy(id);
 res.json({...o,policy,
 subscriptions:(await pool.query('SELECT s.*,p.name AS plan_name,p.building_limit FROM subscriptions s JOIN subscription_plans p ON p.id=s.plan_id WHERE s.organization_id=$1 ORDER BY s.starts_on DESC',[id])).rows,
 modules:(await pool.query('SELECT * FROM module_entitlements WHERE organization_id=$1',[id])).rows,
 buildings:(await pool.query('SELECT id,name,address FROM buildings WHERE organization_id=$1 ORDER BY name',[id])).rows,
 users:(await pool.query('SELECT u.id,u.name,m.active FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.organization_id=$1 ORDER BY u.name',[id])).rows,
 onboarding:(await pool.query("SELECT count(*)::int AS total,count(*) FILTER(WHERE status='completed')::int AS completed FROM onboarding_steps WHERE organization_id=$1",[id])).rows[0],
 supportCases:(await pool.query('SELECT id,subject,status,priority,assigned_to FROM support_cases WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 50',[id])).rows,
 audit:(await pool.query('SELECT id,action,entity_type,entity_id,created_at FROM audit_events WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 50',[id])).rows});
});
const profile=z.object({key:uuid,version:z.number().int().positive(),name:title,legalName:z.string().trim().max(200),taxId:z.string().trim().max(80),address:z.string().trim().max(500),contactEmail:z.union([z.literal(''),z.string().email()]),contactPhone:z.string().trim().max(80),
 timezone:z.string().max(100).refine(s=>{try{new Intl.DateTimeFormat('en',{timeZone:s});return true}catch{return false}}),
 currency:z.enum(['AMD','RUB','USD']),defaultLanguage:z.enum(['hy','ru','en'])}).strict();
organizationConsole.patch('/platform/organizations/:id',async(req,res)=>{
 const c=await requirePermission(req,'organizations.manage');if(!globalAdmin(c))throw new ApiError(403,'forbidden');const id=uuid.parse(req.params.id),b=profile.parse(req.body);
 res.json(await transaction(async db=>{const o=(await db.query('SELECT * FROM organizations WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!o)throw new ApiError(404,'not_found');
 return idempotent(db,req,b.key,b,async()=>{version(o,b.version);
 const r=(await db.query(`UPDATE organizations SET name=$2,legal_name=$3,tax_id=$4,address=$5,contact_email=$6,contact_phone=$7,timezone=$8,currency=$9,default_language=$10,version=version+1 WHERE id=$1 RETURNING *`,[id,b.name,b.legalName,b.taxId,b.address,b.contactEmail,b.contactPhone,b.timezone,b.currency,b.defaultLanguage])).rows[0];
 await record(db,req,{...c,organization_id:id},'organization.profile','organization',id,{before:o,after:r});return r;})}));
});
organizationConsole.post('/platform/organizations/:id/state',async(req,res)=>{
 const c=await requirePermission(req,'organizations.manage');if(!globalAdmin(c))throw new ApiError(403,'forbidden');const id=uuid.parse(req.params.id),b=z.object({key:uuid,version:z.number().int().positive(),status:z.enum(['active','suspended','archived']),reason:z.string().trim().min(3).max(1000)}).strict().parse(req.body);
 res.json(await transaction(async db=>{const o=(await db.query('SELECT * FROM organizations WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!o)throw new ApiError(404,'not_found');return idempotent(db,req,b.key,b,async()=>{version(o,b.version);if(o.status===b.status)throw new ApiError(409,'invalid_transition');
 const r=(await db.query('UPDATE organizations SET status=$2,version=version+1 WHERE id=$1 RETURNING *',[id,b.status])).rows[0];await record(db,req,{...c,organization_id:id},'organization.state','organization',id,{from:o.status,to:b.status,reason:b.reason});return r;})}));
});
