import {Router} from 'express';
import {z} from 'zod';
import {pool} from './db.js';
import {context,requirePermission,ApiError,type Context} from './access.js';
type Definition={sql:string;args:unknown[];sorts:string[];initial:string};
const scope=(c:Context)=>[c.organization_id,c.building_id,c.unit_id];
export async function recordDefinition(req:Parameters<typeof context>[0],resource:string):Promise<Definition>{
 const c=await context(req);
 if(resource==='organizations'){
   await requirePermission(req,c.permissions.includes('organizations.manage')?'organizations.manage':'organizations.read');
   return {sql:'SELECT id,name,company_type,status,version,timezone,currency,is_demo,created_at FROM organizations',args:[],sorts:['name','company_type','currency','created_at','status'],initial:'created_at'};
 }
 if(resource==='audit'){
  const platform=c.permissions.includes('platform.audit');await requirePermission(req,platform?'platform.audit':'audit.read');
  return {sql:`SELECT a.id,a.organization_id,a.actor_user_id,a.action,a.entity_type,a.entity_id,a.details,a.created_at,u.name AS actor FROM audit_events a LEFT JOIN users u ON u.id=a.actor_user_id WHERE ${platform?'TRUE':'a.organization_id=$1'}`,args:platform?[]:[c.organization_id],sorts:['created_at','actor','action','entity_type'],initial:'created_at'};
 }
 if(resource==='invitations'){
  const platform=c.permissions.includes('platform.invite');await requirePermission(req,platform?'platform.invite':'people.invite');
  return {sql:`SELECT i.id,i.organization_id,o.name AS organization_name,i.email,i.role_key,i.expires_at,i.accepted_at,i.revoked_at,
   CASE WHEN i.revoked_at IS NOT NULL THEN 'revoked' WHEN i.accepted_at IS NOT NULL THEN 'accepted' WHEN i.expires_at<=now() THEN 'expired' ELSE 'pending' END AS status
   FROM invitations i LEFT JOIN organizations o ON o.id=i.organization_id WHERE ${platform?'TRUE':'i.organization_id=$1 AND ($2::uuid IS NULL OR i.building_id=$2) AND ($3::uuid IS NULL OR i.unit_id=$3)'}`,
   args:platform?[]:scope(c),sorts:['email','role_key','expires_at','status'],initial:'expires_at'};
 }
 if(resource==='people'){
  await requirePermission(req,'people.read');
   return {sql:`SELECT a.id,u.name,u.email,a.role_key,a.building_id,a.unit_id,a.active,a.starts_at,a.expires_at,
    CASE WHEN u.blocked THEN 'account_blocked' WHEN NOT COALESCE(m.active,false) THEN 'membership_suspended'
     WHEN NOT a.active THEN 'revoked' WHEN a.starts_at>now() THEN 'pending'
     WHEN a.expires_at<=now() THEN 'expired' ELSE 'active' END AS assignment_state
    FROM role_assignments a JOIN users u ON u.id=a.user_id
    LEFT JOIN memberships m ON m.user_id=a.user_id AND m.organization_id=a.organization_id
    WHERE a.organization_id=$1 AND ($2::uuid IS NULL OR a.building_id=$2) AND ($3::uuid IS NULL OR a.unit_id=$3)`,
    args:scope(c),sorts:['name','email','role_key','active'],initial:'name'};
 }
 if(!['properties','units'].includes(resource))throw new ApiError(404,'not_found');
 await requirePermission(req,c.permissions.includes('properties.read')?'properties.read':'properties.own');
 if(resource==='properties')return {
  sql:'SELECT b.id,b.name,b.address,b.is_demo,(SELECT count(*)::int FROM units u WHERE u.building_id=b.id AND ($3::uuid IS NULL OR u.id=$3)) AS units FROM buildings b WHERE b.organization_id=$1 AND ($2::uuid IS NULL OR b.id=$2) AND ($3::uuid IS NULL OR b.id=(SELECT building_id FROM units WHERE id=$3 AND organization_id=$1))',
  args:scope(c),sorts:['name','address','units'],initial:'name'};
 return {sql:'SELECT u.id,u.number,u.area,u.building_id,b.name AS building_name FROM units u JOIN buildings b ON b.id=u.building_id WHERE u.organization_id=$1 AND ($2::uuid IS NULL OR u.building_id=$2) AND ($3::uuid IS NULL OR u.id=$3)',
  args:scope(c),sorts:['number','building_name','area'],initial:'number'};
}
const paging=z.object({page:z.coerce.number().int().min(1).max(10000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(25),
 q:z.string().trim().max(160).default(''),sort:z.string().max(40).optional(),direction:z.enum(['asc','desc']).default('asc'),filter:z.enum(['all','true','false']).default('all'),
 createdFrom:z.string().date().optional(),createdTo:z.string().date().optional()}).strict().refine(b=>!b.createdFrom||!b.createdTo||b.createdFrom<=b.createdTo,{path:['createdTo'],message:'invalid_date_range'});
export const pagedRecords=Router();
pagedRecords.get('/paged/:resource',async(req,res)=>{
 const d=await recordDefinition(req,req.params.resource),b=paging.parse(req.query),sort=b.sort??d.initial;
 if((b.createdFrom||b.createdTo)&&req.params.resource!=='organizations')throw new ApiError(400,'invalid_date_filter');
 if(!d.sorts.includes(sort))throw new ApiError(400,'invalid_sort');
 const n=d.args.length,pattern='%'+b.q.replace(/[\\%_]/g,'\\$&')+'%';
 const dateWhere=req.params.resource==='organizations'
  ?` AND ($${n+4}::date IS NULL OR (t.created_at AT TIME ZONE 'Asia/Yerevan')::date >= $${n+4}::date)
    AND ($${n+5}::date IS NULL OR (t.created_at AT TIME ZONE 'Asia/Yerevan')::date <= $${n+5}::date)`
  :'';
 const where=`($${n+1}='' OR to_jsonb(t)::text ILIKE $${n+2}) AND ($${n+3}='all' OR to_jsonb(t)->>'active'=$${n+3})${dateWhere}`;
 const args=req.params.resource==='organizations'?[...d.args,b.q,pattern,b.filter,b.createdFrom??null,b.createdTo??null]:[...d.args,b.q,pattern,b.filter];
 const total=Number((await pool.query(`SELECT count(*) FROM (${d.sql}) t WHERE ${where}`,args)).rows[0].count);
 const limitPosition=n+(req.params.resource==='organizations'?6:4);
 const rows=(await pool.query(`SELECT * FROM (${d.sql}) t WHERE ${where} ORDER BY "${sort}" ${b.direction} NULLS LAST,id ${b.direction} LIMIT $${limitPosition} OFFSET $${limitPosition+1}`,[...args,b.pageSize,(b.page-1)*b.pageSize])).rows;
 res.json({rows,total,page:b.page,pageSize:b.pageSize,sort,direction:b.direction});
});
// Legacy lookup callers retain array shape, but no unlimited SQL result.
for(const resource of ['organizations','properties','units','people']){
 pagedRecords.get('/'+resource,async(req,res)=>{
   const d=await recordDefinition(req,resource);
  res.json((await pool.query(`SELECT * FROM (${d.sql}) t ORDER BY "${d.initial}",id LIMIT 1000`,d.args)).rows);
 });
}
