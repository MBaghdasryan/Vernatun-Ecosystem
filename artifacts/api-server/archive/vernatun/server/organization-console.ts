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
const organizationExportQuery=z.object({
 q:z.string().trim().max(160).default(''),createdFrom:z.string().date().optional(),createdTo:z.string().date().optional(),
}).strict().refine(b=>!b.createdFrom||!b.createdTo||b.createdFrom<=b.createdTo,{path:['createdTo'],message:'invalid_date_range'});
const csvCell=(input:unknown)=>{const value=String(input??'');const safe=/^\s*[=+\-@]/.test(value)?`'${value}`:value;return '"'+safe.replace(/"/g,'""')+'"';};
organizationConsole.get('/platform/organizations/export.csv',async(req,res)=>{
 const current=await context(req),c=await requirePermission(req,'organizations.read');if(!globalAdmin(c)||current.organization_id)throw new ApiError(403,'forbidden');
 const b=organizationExportQuery.parse(req.query),pattern='%'+b.q.replace(/[\\%_]/g,'\\$&')+'%';
 const rows=(await pool.query(`SELECT o.name,o.company_type,o.legal_name,o.tax_id,o.contact_email,o.contact_phone,o.address,o.status,o.currency,o.timezone,o.default_language,o.created_at,
  COALESCE((SELECT string_agg(m.module,', ' ORDER BY m.module) FROM module_entitlements m WHERE m.organization_id=o.id AND m.enabled),'') AS enabled_modules
  FROM organizations o WHERE ($1='' OR to_jsonb(o)::text ILIKE $2)
   AND ($3::date IS NULL OR (o.created_at AT TIME ZONE 'Asia/Yerevan')::date >= $3::date)
   AND ($4::date IS NULL OR (o.created_at AT TIME ZONE 'Asia/Yerevan')::date <= $4::date)
  ORDER BY o.created_at DESC,o.id DESC LIMIT 20001`,[b.q,pattern,b.createdFrom??null,b.createdTo??null])).rows;
 if(rows.length>20000)throw new ApiError(413,'export_limit_exceeded');
 const columns=['name','company_type','legal_name','tax_id','contact_email','contact_phone','address','status','currency','timezone','default_language','created_at','enabled_modules'];
 const csv=[columns.map(csvCell).join(','),...rows.map(row=>columns.map(key=>csvCell(row[key])).join(','))].join('\r\n');
 res.status(200).set('Content-Type','text/csv; charset=utf-8').set('Content-Disposition','attachment; filename="vernatun-organizations.csv"').send('\uFEFF'+csv);
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
const profile=z.object({key:uuid,version:z.number().int().positive(),name:title,companyType:z.enum(['developer','management_company']),legalName:z.string().trim().max(200),taxId:z.string().trim().max(80),address:z.string().trim().max(500),contactEmail:z.union([z.literal(''),z.string().email()]),contactPhone:z.string().trim().max(80),
 timezone:z.string().max(100).refine(s=>{try{new Intl.DateTimeFormat('en',{timeZone:s});return true}catch{return false}}),
 currency:z.enum(['AMD','RUB','USD']),defaultLanguage:z.enum(['hy','ru','en'])}).strict();
organizationConsole.patch('/platform/organizations/:id',async(req,res)=>{
 const c=await requirePermission(req,'organizations.manage');if(!globalAdmin(c))throw new ApiError(403,'forbidden');const id=uuid.parse(req.params.id),b=profile.parse(req.body);
 res.json(await transaction(async db=>{const o=(await db.query('SELECT * FROM organizations WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!o)throw new ApiError(404,'not_found');
 return idempotent(db,req,b.key,b,async()=>{version(o,b.version);
  const r=(await db.query(`UPDATE organizations SET name=$2,company_type=$3,legal_name=$4,tax_id=$5,address=$6,contact_email=$7,contact_phone=$8,timezone=$9,currency=$10,default_language=$11,version=version+1 WHERE id=$1 RETURNING *`,[id,b.name,b.companyType,b.legalName,b.taxId,b.address,b.contactEmail,b.contactPhone,b.timezone,b.currency,b.defaultLanguage])).rows[0];
 await record(db,req,{...c,organization_id:id},'organization.profile','organization',id,{before:o,after:r});return r;})}));
});
organizationConsole.post('/platform/organizations/:id/state',async(req,res)=>{
 const c=await requirePermission(req,'organizations.manage');if(!globalAdmin(c))throw new ApiError(403,'forbidden');const id=uuid.parse(req.params.id),b=z.object({key:uuid,version:z.number().int().positive(),status:z.enum(['active','suspended','archived']),reason:z.string().trim().min(3).max(1000)}).strict().parse(req.body);
 res.json(await transaction(async db=>{const o=(await db.query('SELECT * FROM organizations WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!o)throw new ApiError(404,'not_found');return idempotent(db,req,b.key,b,async()=>{version(o,b.version);if(o.status===b.status)throw new ApiError(409,'invalid_transition');
 const r=(await db.query('UPDATE organizations SET status=$2,version=version+1 WHERE id=$1 RETURNING *',[id,b.status])).rows[0];await record(db,req,{...c,organization_id:id},'organization.state','organization',id,{from:o.status,to:b.status,reason:b.reason});return r;})}));
});
