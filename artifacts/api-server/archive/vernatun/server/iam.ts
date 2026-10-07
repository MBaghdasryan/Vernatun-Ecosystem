import {Router,type Request,type Response} from 'express';
import {z} from 'zod';
import {pool} from './db.js';
import {context,contexts,requirePermission,ApiError,type Context} from './access.js';
import {roleCatalog,organizationDelegableRoles} from './roles.js';
import {transaction,record} from './operations.js';
import {assignmentPermissions,permissionCatalog,permissionDecision,exceptionalGrantAllowlist} from './iam-evaluator.js';
import {unitReadDecision} from './iam-resource.js';
import {policyState} from './mfa-policy.js';
import {preserveAdministrator} from './assignment-management.js';
export const iam=Router();
const uuid=z.string().uuid(),reason=z.string().trim().min(5).max(1000);
const isPlatform=(c:Context)=>c.role_key==='platform_admin'&&!c.organization_id;
async function actor(req:Request,readOnly=false){
 const c=await context(req);
 const decision=await permissionDecision(c,isPlatform(c)?'organizations.manage':'roles.assign',readOnly?'GET':req.method);
 if(!decision.allowed)throw new ApiError(403,decision.reason);return c;
}
async function target(req:Request,id:string,readOnly=false,db?:any){
 const c=await actor(req,readOnly);
 const a=(await (db??pool).query('SELECT *,xmin::text AS version FROM role_assignments WHERE id=$1'+(db?' FOR UPDATE':''),[id])).rows[0];
 if(!a||(!isPlatform(c)&&(a.organization_id!==c.organization_id||
  (c.building_id&&c.building_id!==a.building_id)||(c.unit_id&&c.unit_id!==a.unit_id))))throw new ApiError(404,'not_found');
 return {c,a};
}
async function lockIam(db:any){await db.query('SELECT pg_advisory_xact_lock(6172924)')}
function scopeManager(c:Context){if(!isPlatform(c)&&(!c.organization_id||c.building_id||c.unit_id))throw new ApiError(403,'forbidden')}
const profileInput=z.object({name:z.string().trim().min(2).max(100),description:z.string().max(1000).default(''),
 baseRole:z.string(),permissions:z.array(z.string()).max(100),tenantAllowed:z.boolean().default(false),active:z.boolean().default(true),version:z.string().optional()}).strict();
iam.get('/iam/catalog',async(req,res)=>{
 await actor(req);res.json({permissions:permissionCatalog(),roles:roleCatalog,exceptionalGrantAllowlist});
});
iam.get('/iam/profiles',async(req,res)=>{
 const c=await actor(req);
 res.json((await pool.query(`SELECT *,xmin::text AS version FROM iam_profiles
 WHERE ($1::boolean AND organization_id IS NULL) OR organization_id=$2 OR (organization_id IS NULL AND tenant_allowed)
 ORDER BY name`,[isPlatform(c),c.organization_id])).rows);
});
iam.post('/iam/profiles',async(req,res)=>{
 const c=await actor(req);scopeManager(c);const b=profileInput.parse(req.body);
 if(!organizationDelegableRoles.includes(b.baseRole as any)||!roleCatalog[b.baseRole as keyof typeof roleCatalog])throw new ApiError(400,'invalid_role');
 const base:readonly string[]=roleCatalog[b.baseRole as keyof typeof roleCatalog].permissions;
 if(b.permissions.some(p=>!base.includes(p))||(!isPlatform(c)&&b.tenantAllowed))throw new ApiError(403,'forbidden');
 res.status(201).json(await transaction(async db=>{
  await lockIam(db);const fresh=await actor(req);scopeManager(fresh);
  const p=(await db.query(`INSERT INTO iam_profiles(organization_id,name,description,base_role,permissions,tenant_allowed,active,created_by)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *,xmin::text AS version`,
   [isPlatform(fresh)?null:fresh.organization_id,b.name,b.description,b.baseRole,[...new Set(b.permissions)],b.tenantAllowed,b.active,req.user!.id])).rows[0];
  await record(db,req,c,'iam.profile.create','iam_profile',p.id,{baseRole:b.baseRole,permissions:b.permissions});return p;
 }));
});
iam.patch('/iam/profiles/:id',async(req,res)=>{
 const c=await actor(req);scopeManager(c);const b=profileInput.parse(req.body),id=uuid.parse(req.params.id);
 res.json(await transaction(async db=>{
  await lockIam(db);scopeManager(await actor(req));
  const old=(await db.query('SELECT *,xmin::text AS version FROM iam_profiles WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(!old||old.organization_id!==(isPlatform(c)?null:c.organization_id))throw new ApiError(404,'not_found');
  if(old.version!==b.version)throw new ApiError(409,'concurrent_change');
  if(old.base_role!==b.baseRole)throw new ApiError(400,'immutable_base_role');
  const base:readonly string[]=roleCatalog[b.baseRole as keyof typeof roleCatalog].permissions;
  if(b.permissions.some(p=>!base.includes(p))||(!isPlatform(c)&&b.tenantAllowed))throw new ApiError(403,'forbidden');
  // Profiles cannot restrict administrator recovery authority.
  if(b.baseRole==='org_admin'&&(!b.active||!b.permissions.includes('roles.assign')))throw new ApiError(409,'last_administrator');
  const next=(await db.query(`UPDATE iam_profiles SET name=$2,description=$3,permissions=$4,tenant_allowed=$5,active=$6
   WHERE id=$1 RETURNING *,xmin::text AS version`,[id,b.name,b.description,[...new Set(b.permissions)],b.tenantAllowed,b.active])).rows[0];
  await record(db,req,c,'iam.profile.update','iam_profile',id,{before:old,after:next});return next;
 }));
});
iam.get('/iam/users',async(req,res)=>{
 const c=await actor(req),q=z.string().max(100).parse(req.query.q??''),offset=z.coerce.number().int().min(0).max(100000).parse(req.query.offset??0);
 const args=[isPlatform(c),c.organization_id,c.building_id,c.unit_id,'%'+q+'%',offset];
 const rows=(await pool.query(`SELECT u.id,u.name,u.email,u.account_status,
 COALESCE((SELECT enabled FROM mfa_credentials WHERE user_id=u.id),false) AS mfa_enabled,count(*) OVER()::int AS total
 FROM users u WHERE ($1 OR EXISTS(SELECT 1 FROM role_assignments a WHERE a.user_id=u.id AND a.organization_id=$2
 AND ($3::uuid IS NULL OR a.building_id=$3) AND ($4::uuid IS NULL OR a.unit_id=$4)))
 AND (u.name ILIKE $5 OR u.email ILIKE $5) ORDER BY u.name,u.id LIMIT 50 OFFSET $6`,args)).rows;
 res.json({rows,total:rows[0]?.total??0,offset,limit:50});
});
iam.get('/iam/users/:id',async(req,res)=>{
 const c=await actor(req),id=uuid.parse(req.params.id);
 const assignments=(await pool.query(`SELECT a.*,a.xmin::text AS version,o.name AS organization_name
 FROM role_assignments a LEFT JOIN organizations o ON o.id=a.organization_id WHERE a.user_id=$1
 AND ($2 OR (a.organization_id=$3 AND ($4::uuid IS NULL OR a.building_id=$4) AND ($5::uuid IS NULL OR a.unit_id=$5)))`,
 [id,isPlatform(c),c.organization_id,c.building_id,c.unit_id])).rows;
 if(!isPlatform(c)&&!assignments.length)throw new ApiError(404,'not_found');
 const user=(await pool.query(`SELECT id,name,email,account_status,created_at,
 COALESCE((SELECT enabled FROM mfa_credentials WHERE user_id=users.id),false) AS mfa_enabled FROM users WHERE id=$1`,[id])).rows[0];
 if(!user)throw new ApiError(404,'not_found');
 // Hash session identifiers: never expose reusable bearer session IDs to an admin.
 const sessions=isPlatform(c)?(await pool.query(`SELECT md5(sid) AS id,sess->>'createdAt' AS created_at,expire
 FROM session WHERE sess->'passport'->>'user'=$1 AND expire>now() ORDER BY expire DESC`,[id])).rows:[];
 const ids=assignments.map(a=>a.id);
 const history=(await pool.query(`SELECT action,entity_id,details,created_at FROM audit_events
 WHERE (entity_type='role_assignment' AND entity_id=ANY($1::text[]))
 OR ($2 AND entity_type='user' AND entity_id=$3) ORDER BY created_at DESC LIMIT 100`,[ids,isPlatform(c),id])).rows;
 res.json({user,assignments:assignments.map(a=>({...a,
  canEditScope:a.user_id!==req.user!.id&&a.active&&!!a.organization_id&&!['unit_owner','renter','family','support','platform_admin'].includes(a.role_key),
  canChangePolicy:a.user_id!==req.user!.id&&a.active&&!!a.organization_id&&!['org_admin','unit_owner','renter','family','support','platform_admin'].includes(a.role_key),
  canChangeStatus:a.user_id!==req.user!.id&&a.assignment_status!=='revoked'&&!['unit_owner','renter','family','support','platform_admin'].includes(a.role_key)})),
 sessions,history,platform:isPlatform(c),canManageAccount:isPlatform(c)&&id!==req.user!.id});
});
async function accountAction(req:Request,id:string,b:{status?:string;sessionId?:string;reason:string}){
 const c=await actor(req);if(!isPlatform(c)||id===req.user!.id)throw new ApiError(403,'forbidden');
 return transaction(async db=>{
  await lockIam(db);if(!isPlatform(await actor(req)))throw new ApiError(403,'forbidden');
  const old=(await db.query('SELECT id,account_status FROM users WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!old)throw new ApiError(404,'not_found');
  if(b.status&&b.status!=='active'){
   const missing=await db.query(`SELECT a.organization_id FROM role_assignments a WHERE a.user_id=$1 AND a.active AND a.role_key IN ('org_admin','platform_admin')
   AND NOT EXISTS(SELECT 1 FROM role_assignments other JOIN users u ON u.id=other.user_id
   LEFT JOIN memberships m ON m.user_id=other.user_id AND m.organization_id=other.organization_id
   WHERE other.user_id<>$1 AND other.role_key=a.role_key AND other.organization_id IS NOT DISTINCT FROM a.organization_id
   AND other.active AND NOT u.blocked AND (other.organization_id IS NULL OR m.active)
   AND other.building_id IS NULL AND other.unit_id IS NULL AND other.profile_id IS NULL
   AND other.starts_at<=now() AND other.expires_at IS NULL)`,[id]);
   if(missing.rowCount)throw new ApiError(409,'last_administrator');
  }
  if(b.status)await db.query('UPDATE users SET account_status=$2 WHERE id=$1',[id,b.status]);
  if(!b.status||b.status!=='active')await db.query(`DELETE FROM session WHERE sess->'passport'->>'user'=$1 AND ($2::text IS NULL OR md5(sid)=$2)`,[id,b.sessionId??null]);
  await record(db,req,c,b.status?'iam.account.status':'iam.sessions.revoke','user',id,{before:old.account_status,after:b.status??old.account_status,reason:b.reason,allSessions:!b.sessionId});
 });
}
iam.post('/iam/users/:id/status',async(req,res)=>{
 const b=z.object({status:z.enum(['active','locked','disabled']),reason}).strict().parse(req.body);
 await accountAction(req,uuid.parse(req.params.id),b);res.status(204).end();
});
iam.post('/iam/users/:id/logout',async(req,res)=>{
 const b=z.object({reason,sessionId:z.string().regex(/^[a-f0-9]{32}$/).optional()}).strict().parse(req.body);
 await accountAction(req,uuid.parse(req.params.id),b);res.status(204).end();
});
// Compatibility endpoint delegates to the same protected account lifecycle.
iam.post('/users/:id/block',async(req,res)=>{await accountAction(req,uuid.parse(req.params.id),{status:'disabled',reason:'Legacy administrative account block'});res.status(204).end()});
async function explainAccess(req:Request,res:Response){
 const {c,a}=await target(req,uuid.parse(req.params.id),true);
 const active=(await contexts(a.user_id)).find(x=>x.id===a.id);
 const input=z.object({method:z.enum(['GET','POST','PATCH','DELETE']),unitId:uuid.optional(),sessionId:z.string().regex(/^[a-f0-9]{32}$/).optional()}).strict().parse(req.method==='POST'?req.body:{method:'GET'});
 const catalog=permissionCatalog(),method=input.method;
 const evaluations=await Promise.all(catalog.map(async permission=>({permission,...(active?await permissionDecision(active,permission,method):{allowed:false,reason:'inactive_context'})})));
 const evaluated=await assignmentPermissions({...a,permissions:[...roleCatalog[a.role_key as keyof typeof roleCatalog].permissions]});
 let resource:null|Record<string,unknown>=null;
 if(input.unitId){
  const decision=await unitReadDecision(active,input.unitId);
  // Never reveal another user's reusable session ID or tenant unit data.
  const session=input.sessionId&&isPlatform(c)?(await pool.query(`SELECT sess FROM session
   WHERE md5(sid)=$1 AND sess->'passport'->>'user'=$2 AND sess->>'contextId'=$3 AND expire>now()`,
   [input.sessionId,a.user_id,a.id])).rows[0]?.sess:undefined;
  if(input.sessionId&&!isPlatform(c))throw new ApiError(403,'forbidden');
  const mfa=active?await policyState({user:{id:a.user_id},session:session??{}} as Request,active):null;
  const sessionReason=input.sessionId&&!session?'session_unavailable':
   mfa?.enforced&&!mfa.enrolled?'mfa_enrollment_required':
   mfa?.enforced&&!mfa.verified?(session?'mfa_verification_required':'target_session_required'):null;
  resource={kind:'unit',id:input.unitId,operation:'GET /units/:id',
   allowed:decision.allowed&&!sessionReason,
   conditional:decision.allowed&&sessionReason==='target_session_required',
   reason:decision.allowed?(sessionReason??decision.reason):decision.reason,
   sessionChecked:!!session,scopeAllowed:decision.allowed};
 }
 res.json({assignmentId:a.id,active:!!active,scope:{organizationId:a.organization_id,buildingId:a.building_id,unitId:a.unit_id},
 ...evaluated,evaluations,method,resource,limit:'Permission matrix is not a workflow authorization. Unit read uses the production unit endpoint evaluator and current account/assignment/lifecycle scope. Enforced MFA requires a verified target session. Other business mutations retain their endpoint-specific state checks.',viewer:isPlatform(c)?'platform':'organization'});
}
iam.get('/iam/assignments/:id/access',explainAccess);
iam.post('/iam/assignments/:id/access',explainAccess);
iam.post('/iam/assignments/:id/policy',async(req,res)=>{
 const id=uuid.parse(req.params.id),b=z.object({version:z.string(),profileId:uuid.nullable(),denies:z.array(z.string()).max(100),grants:z.array(z.string()).max(10),reason,expiresAt:z.string().datetime({offset:true}).nullable()}).strict().parse(req.body);
 res.json(await transaction(async db=>{
  await lockIam(db);const {c,a}=await target(req,id,false,db);
  if(a.user_id===req.user!.id||!a.organization_id||['platform_admin','support','org_admin','unit_owner','renter','family'].includes(a.role_key))throw new ApiError(403,'forbidden');
  if(!a.active||a.version!==b.version)throw new ApiError(409,'concurrent_change');
  if(b.expiresAt&&Date.parse(b.expiresAt)<=Date.now())throw new ApiError(400,'invalid_dates');
  const base:readonly string[]=roleCatalog[a.role_key as keyof typeof roleCatalog].permissions;
  if(b.denies.some(p=>!base.includes(p))||b.grants.some(p=>!base.includes(p)||!exceptionalGrantAllowlist.includes(p as any))||
   (b.grants.length&&(!b.expiresAt||!isPlatform(c))))throw new ApiError(403,'forbidden');
  if(b.profileId){
   const p=(await db.query(`SELECT * FROM iam_profiles WHERE id=$1 AND active AND base_role=$2
   AND (organization_id=$3 OR (organization_id IS NULL AND tenant_allowed))`,[b.profileId,a.role_key,a.organization_id])).rows[0];
   if(!p)throw new ApiError(404,'not_found');
  }
  const previous=(await db.query('SELECT permission_key,effect,reason,expires_at FROM iam_assignment_rules WHERE assignment_id=$1',[id])).rows;
  await db.query('UPDATE role_assignments SET profile_id=$2 WHERE id=$1',[id,b.profileId]);
  await db.query("DELETE FROM iam_assignment_rules WHERE assignment_id=$1 AND ($2 OR effect='deny')",[id,isPlatform(c)]);
  for(const [effect,keys] of [['deny',b.denies],['grant',b.grants]] as const)
   for(const key of new Set(keys))await db.query('INSERT INTO iam_assignment_rules(assignment_id,permission_key,effect,reason,expires_at,created_by) VALUES($1,$2,$3,$4,$5,$6)',[id,key,effect,b.reason,b.expiresAt,req.user!.id]);
  const savedRules=(await db.query('SELECT permission_key,effect,reason,expires_at FROM iam_assignment_rules WHERE assignment_id=$1',[id])).rows;
  await record(db,req,{...c,organization_id:a.organization_id},'iam.assignment.policy','role_assignment',id,{before:{profileId:a.profile_id,rules:previous},after:{profileId:b.profileId,rules:savedRules},reason:b.reason});
  return {saved:true};
 }));
});
iam.post('/iam/assignments/:id/status',async(req,res)=>{
 const id=uuid.parse(req.params.id),b=z.object({version:z.string(),status:z.enum(['active','suspended','revoked']),reason}).strict().parse(req.body);
 await transaction(async db=>{
  await lockIam(db);const {c,a}=await target(req,id,false,db);
   if(a.user_id===req.user!.id||['platform_admin','unit_owner','renter','family','support'].includes(a.role_key))throw new ApiError(403,'forbidden');
  if(a.version!==b.version)throw new ApiError(409,'concurrent_change');
  if(a.assignment_status==='revoked')throw new ApiError(409,'revoked_assignment');
   if(b.status!=='active')await preserveAdministrator(db,a);
  await db.query('UPDATE role_assignments SET assignment_status=$2 WHERE id=$1',[id,b.status]);
   await record(db,req,{...c,organization_id:a.organization_id},'iam.assignment.status','role_assignment',id,{before:a.assignment_status,after:b.status,reason:b.reason});
 });
 res.status(204).end();
});
