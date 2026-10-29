import {assertEmailConfigured,emailProviderState} from './email.js';
import {sendInvitation} from './invitation-delivery.js';
import {subscriptionPolicy} from './subscription-policy.js';
import {transaction,idempotent,record} from './operations.js';
import {invoiceAmounts} from './operations.js';
import {Router} from 'express';
import {z} from 'zod';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {pool,audit} from './db.js';
import {config} from './config.js';
import {ApiError,context,requireAuth,requirePermission,scopedUnit,requireUnitRead} from './access.js';
import {organizationDelegableRoles,roleKeys} from './roles.js';
import {assignmentManagement} from './assignment-management.js';
import {iam} from './iam.js';
import {moduleKeys} from './subscription-policy.js';
import {globalAdmin} from './platform-ops-shared.js';
export const api=Router();api.use(requireAuth);api.use(iam);api.use(assignmentManagement);
const uuid=z.string().uuid();
api.get('/dashboard',async(req,res)=>{const c=await context(req);const metrics:Record<string,number>={};if(c.permissions.includes('organizations.read')){metrics.organizations=Number((await pool.query('SELECT count(*) FROM organizations')).rows[0].count);metrics.buildings=Number((await pool.query('SELECT count(*) FROM buildings')).rows[0].count);metrics.accounts=Number((await pool.query('SELECT count(*) FROM users WHERE NOT blocked')).rows[0].count);metrics.roles=Number((await pool.query('SELECT count(*) FROM roles')).rows[0].count)}else if(c.organization_id){if(c.permissions.includes('properties.read')||c.permissions.includes('properties.own')){metrics.buildings=Number((await pool.query('SELECT count(*) FROM buildings WHERE organization_id=$1 AND ($2::uuid IS NULL OR id=$2)',[c.organization_id,c.building_id])).rows[0].count);metrics.units=Number((await pool.query('SELECT count(*) FROM units WHERE organization_id=$1 AND ($2::uuid IS NULL OR building_id=$2) AND ($3::uuid IS NULL OR id=$3)',[c.organization_id,c.building_id,c.unit_id])).rows[0].count)}if(c.permissions.includes('people.read'))metrics.team=Number((await pool.query(`SELECT count(DISTINCT a.user_id) FROM role_assignments a JOIN memberships m ON m.user_id=a.user_id AND m.organization_id=a.organization_id WHERE a.organization_id=$1 AND a.active AND m.active AND ($2::uuid IS NULL OR a.building_id=$2)`,[c.organization_id,c.building_id])).rows[0].count);if(c.permissions.includes('modules.read'))metrics.modules=Number((await pool.query('SELECT count(*) FROM module_entitlements WHERE organization_id=$1 AND enabled',[c.organization_id])).rows[0].count)}res.json({context:c,metrics,stage:1,currencies:['AMD','RUB','USD'],timezone:'Asia/Yerevan',integrations:{payments:'not_connected',email:emailProviderState(),door:'not_connected',mfa:'totp_available'}})});
api.get('/organizations',async(req,res)=>{await requirePermission(req,'organizations.read');res.json((await pool.query('SELECT id,name,company_type,status,version,timezone,currency,is_demo,created_at FROM organizations ORDER BY created_at')).rows)});
api.post('/organizations',async(req,res)=>{
 const c=await requirePermission(req,'organizations.manage');if(!globalAdmin(c))throw new ApiError(403,'forbidden');
 const b=z.object({
  key:uuid.optional(),companyType:z.enum(['developer','management_company']).default('management_company'),
  name:z.string().trim().min(2).max(200),legalName:z.string().trim().max(200).default(''),
  taxId:z.string().trim().max(80).default(''),address:z.string().trim().max(500).default(''),
  contactEmail:z.union([z.literal(''),z.string().email()]).default(''),contactPhone:z.string().trim().max(80).default(''),
  timezone:z.string().max(100).default('Asia/Yerevan').refine(s=>{try{new Intl.DateTimeFormat('en',{timeZone:s});return true}catch{return false}}),
  currency:z.enum(['AMD','RUB','USD']).default('AMD'),defaultLanguage:z.enum(['hy','ru','en']).default('hy'),
  modules:z.array(z.enum(moduleKeys)).min(1).max(moduleKeys.length).default([...moduleKeys]),
 }).strict().parse(req.body);
 const result=await transaction(async db=>idempotent(db,req,b.key??randomUUID(),b,async()=>{
  const organization=(await db.query(`INSERT INTO organizations(name,company_type,legal_name,tax_id,address,contact_email,contact_phone,timezone,currency,default_language)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
   [b.name,b.companyType,b.legalName,b.taxId,b.address,b.contactEmail,b.contactPhone,b.timezone,b.currency,b.defaultLanguage])).rows[0];
  const enabled=new Set(b.modules);
  for(const module of moduleKeys){
   const active=enabled.has(module);
   await db.query(`INSERT INTO module_entitlements(organization_id,module,enabled,override_state)
    VALUES($1,$2,$3,$4) ON CONFLICT(organization_id,module) DO UPDATE SET
    enabled=EXCLUDED.enabled,override_state=EXCLUDED.override_state,override_reason='Initial organization setup',updated_at=now()`,
    [organization.id,module,active,active?'inherited':'disabled']);
  }
  await record(db,req,{...c,organization_id:organization.id},'organization.create','organization',organization.id,{companyType:b.companyType,modules:b.modules});
  return organization;
 }));
 res.status(201).json(result);
});
api.get('/properties',async(req,res)=>{const c=await context(req);await requirePermission(req,c.permissions.includes('properties.read')?'properties.read':'properties.own');res.json((await pool.query('SELECT b.id,b.name,b.address,b.is_demo,(SELECT count(*)::int FROM units u WHERE u.building_id=b.id AND ($3::uuid IS NULL OR u.id=$3)) AS units FROM buildings b WHERE organization_id=$1 AND ($2::uuid IS NULL OR id=$2) ORDER BY name',[c.organization_id,c.building_id,c.unit_id])).rows)});
api.post('/properties',async(req,res)=>{const c=await requirePermission(req,'properties.manage');if(!c.organization_id||c.building_id||c.unit_id)throw new ApiError(403,'forbidden');const b=z.object({name:z.string().trim().min(2).max(120),address:z.string().trim().min(3).max(200)}).strict().parse(req.body);res.status(201).json(await transaction(async db=>{await db.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[c.organization_id]);const plan=(await db.query("SELECT min(p.building_limit) AS maximum FROM subscriptions s JOIN subscription_plans p ON p.id=s.plan_id WHERE s.organization_id=$1 AND s.status='active' AND s.starts_on<=current_date AND s.ends_on>=current_date",[c.organization_id])).rows[0];const effectivePolicy=await subscriptionPolicy(c.organization_id!,db);if(effectivePolicy.enforced)plan.maximum=effectivePolicy.buildingLimit;if(plan.maximum!==null&&Number((await db.query('SELECT count(*) FROM buildings WHERE organization_id=$1',[c.organization_id])).rows[0].count)>=plan.maximum)throw new ApiError(409,'plan_limit');const r=(await db.query('INSERT INTO buildings(organization_id,name,address) VALUES($1,$2,$3) RETURNING *',[c.organization_id,b.name,b.address])).rows[0];await record(db,req,c,'building.create','building',r.id);return r}))});
api.get('/units',async(req,res)=>{const c=await context(req);await requirePermission(req,c.permissions.includes('properties.read')?'properties.read':'properties.own');res.json((await pool.query('SELECT u.id,u.number,u.area,u.building_id,b.name AS building_name FROM units u JOIN buildings b ON b.id=u.building_id WHERE u.organization_id=$1 AND ($2::uuid IS NULL OR u.building_id=$2) AND ($3::uuid IS NULL OR u.id=$3) ORDER BY u.number',[c.organization_id,c.building_id,c.unit_id])).rows)});
api.get('/units/:id',async(req,res)=>{res.json(await requireUnitRead(req,uuid.parse(req.params.id)))});
api.post('/units',async(req,res)=>{const c=await requirePermission(req,'properties.manage');const b=z.object({buildingId:uuid,number:z.string().trim().min(1).max(20),area:z.coerce.number().positive().max(100000)}).strict().parse(req.body);if(c.unit_id||(c.building_id&&c.building_id!==b.buildingId))throw new ApiError(403,'forbidden');const building=await pool.query('SELECT id FROM buildings WHERE id=$1 AND organization_id=$2',[b.buildingId,c.organization_id]);if(!building.rowCount)throw new ApiError(404,'not_found');const r=await pool.query('INSERT INTO units(organization_id,building_id,number,area) VALUES($1,$2,$3,$4) RETURNING *',[c.organization_id,b.buildingId,b.number,b.area]);await audit(req.user!.id,c.organization_id,'unit.create','unit',r.rows[0].id);res.status(201).json(r.rows[0])});
api.get('/people',async(req,res)=>{const c=await requirePermission(req,'people.read');res.json((await pool.query(`SELECT a.id,u.name,u.email,a.role_key,a.building_id,a.unit_id,a.active,a.expires_at FROM role_assignments a JOIN users u ON u.id=a.user_id WHERE a.organization_id=$1 AND ($2::uuid IS NULL OR a.building_id=$2) ORDER BY u.name`,[c.organization_id,c.building_id])).rows)});
api.get('/modules',async(req,res)=>{
 const c=await requirePermission(req,'modules.read');
 if(!c.organization_id)throw new ApiError(403,'forbidden');
 const policy=await subscriptionPolicy(c.organization_id);
 const modules=policy.overrides.filter(e=>policy.planModules.includes(e.module)).map(e=>({
  module:e.module,enabled:e.effective,override_state:e.override_state,updatedAt:e.updated_at,
 }));
 res.set('Cache-Control','private, no-store').json({modules,enforced:policy.enforced,state:policy.state,readOnly:policy.readOnly});
});
api.patch('/modules/:module',async(req,res)=>{
 const c=await requirePermission(req,'modules.manage');
 if(!c.organization_id||c.building_id||c.unit_id)throw new ApiError(403,'forbidden');
 const {enabled,expectedUpdatedAt}=z.object({enabled:z.boolean(),expectedUpdatedAt:z.string().min(1).max(64)}).strict().parse(req.body);
 const module=z.enum(['finance','requests','handover','access','community','maintenance','meters','documents']).parse(req.params.module);
 res.json(await transaction(async db=>{
  await db.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[c.organization_id]);
  const policy=await subscriptionPolicy(c.organization_id!,db);
  if(policy.readOnly)throw new ApiError(403,'subscription_restricted');
  if(policy.enforced&&!policy.planModules.includes(module))throw new ApiError(403,'plan_module_not_available');
  const before=(await db.query('SELECT enabled,override_state,updated_at::text AS updated_at FROM module_entitlements WHERE organization_id=$1 AND module=$2 FOR UPDATE',[c.organization_id,module])).rows[0];
  if(!before)throw new ApiError(404,'not_found');
  if(before.updated_at!==expectedUpdatedAt)throw new ApiError(409,'stale_module_state');
  const r=(await db.query(`UPDATE module_entitlements SET enabled=$1,override_state=$2,
   override_reason='Organization module setting',updated_by=$3,updated_at=clock_timestamp()
   WHERE organization_id=$4 AND module=$5 RETURNING module,enabled,override_state,updated_at::text AS "updatedAt"`,
   [enabled,enabled?'inherited':'disabled',req.user!.id,c.organization_id,module])).rows[0];
  await record(db,req,c,'module.update','module',module,{
   before:{enabled:before.enabled,overrideState:before.override_state},
   after:{enabled:r.enabled,overrideState:r.override_state},reason:'Organization module setting',
  });
  return r;
 }));
});
api.get('/invoices',async(req,res)=>{const c=await context(req);const own=!c.permissions.includes('billing.read');await requirePermission(req,own?'billing.own':'billing.read');const currency=z.enum(['AMD','RUB','USD']).parse(req.query.currency??req.user!.currency);const r=await pool.query(`SELECT i.id,i.period,${invoiceAmounts},i.currency,i.status,u.number FROM invoices i JOIN units u ON u.id=i.unit_id WHERE i.organization_id=$1 AND i.currency=$2 AND ($3::uuid IS NULL OR u.building_id=$3) AND ($4::uuid IS NULL OR u.id=$4) AND (NOT $5::boolean OR (i.payer_user_id=$6 AND i.status='published')) ORDER BY i.period DESC`,[c.organization_id,currency,c.building_id,c.unit_id,own,req.user!.id]);res.json(r.rows)});
api.get('/audit',async(req,res)=>{const c=await context(req);const platform=c.permissions.includes('platform.audit');await requirePermission(req,platform?'platform.audit':'audit.read');const r=await pool.query(`SELECT a.id,a.organization_id,a.actor_user_id,a.action,a.entity_type,a.entity_id,a.details,a.created_at,u.name AS actor FROM audit_events a LEFT JOIN users u ON u.id=a.actor_user_id WHERE ${platform?'TRUE':'a.organization_id=$1'} ORDER BY a.created_at DESC,a.id DESC LIMIT 100`,platform?[]:[c.organization_id]);res.json(r.rows)});
api.get('/invitations',async(req,res)=>{const c=await context(req);const platform=c.permissions.includes('platform.invite');await requirePermission(req,platform?'platform.invite':'people.invite');res.json((await pool.query(`SELECT i.id,i.organization_id,o.name AS organization_name,i.email,i.role_key,i.expires_at,i.accepted_at,i.revoked_at FROM invitations i JOIN organizations o ON o.id=i.organization_id WHERE ${platform?'TRUE':'i.organization_id=$1'} ORDER BY i.expires_at DESC`,platform?[]:[c.organization_id])).rows)});
api.post('/invitations',async(req,res)=>{const c=await context(req);const platform=c.permissions.includes('platform.invite');await requirePermission(req,platform?'platform.invite':'people.invite');assertEmailConfigured();const b=z.object({email:z.string().email().max(254),role:z.enum(roleKeys as [typeof roleKeys[number],...typeof roleKeys[number][]]),organizationId:uuid.optional(),buildingId:uuid.optional(),unitId:uuid.optional()}).strict().parse(req.body);if(!organizationDelegableRoles.includes(b.role)||(platform&&b.role!=='org_admin'))throw new ApiError(403,'forbidden');const org=platform?b.organizationId:c.organization_id;if(!org||(!platform&&b.organizationId&&b.organizationId!==org))throw new ApiError(403,'forbidden');if(c.building_id&&b.buildingId!==c.building_id)throw new ApiError(403,'forbidden');if(c.unit_id&&b.unitId!==c.unit_id)throw new ApiError(403,'forbidden');if(['unit_owner','renter','family'].includes(b.role)&&!b.unitId)throw new ApiError(400,'unit_required');if(b.unitId&&!b.buildingId)throw new ApiError(400,'unit_required');if(b.buildingId){const building=await pool.query('SELECT id FROM buildings WHERE id=$1 AND organization_id=$2',[b.buildingId,org]);if(!building.rowCount)throw new ApiError(404,'not_found')}if(b.unitId){await scopedUnit({...c,organization_id:org,building_id:b.buildingId!,unit_id:null},b.unitId)}const token=randomBytes(32).toString('hex');const r=await transaction(async db=>{const inserted=await db.query('INSERT INTO invitations(organization_id,email,role_key,building_id,unit_id,token_hash,invited_by,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval \'48 hours\') RETURNING id,expires_at',[org,b.email.toLowerCase(),b.role,b.buildingId??null,b.unitId??null,createHash('sha256').update(token).digest('hex'),req.user!.id]);await record(db,req,{...c,organization_id:org},'invitation.create','invitation',inserted.rows[0].id);return inserted.rows[0]});res.status(201).json({...r,...await sendInvitation(req,c,r.id,token)})});
api.delete('/invitations/:id',async(req,res)=>{
 const c=await context(req),platform=c.permissions.includes('platform.invite');
 await requirePermission(req,platform?'platform.invite':'people.invite');
 await transaction(async db=>{
  const r=await db.query(`UPDATE invitations SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1
   ${platform?'':`AND organization_id=$2 AND ($3::uuid IS NULL OR building_id=$3) AND ($4::uuid IS NULL OR unit_id=$4)`}
   AND accepted_at IS NULL RETURNING id,organization_id`,
   platform?[uuid.parse(req.params.id)]:[uuid.parse(req.params.id),c.organization_id,c.building_id,c.unit_id]);
  if(!r.rowCount)throw new ApiError(404,'not_found');
  await record(db,req,{...c,organization_id:r.rows[0].organization_id},'invitation.revoke','invitation',r.rows[0].id);
 });
 res.status(204).end();
});
