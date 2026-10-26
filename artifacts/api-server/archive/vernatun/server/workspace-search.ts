import {Router} from 'express';
import {z} from 'zod';
import {pool} from './db.js';
import {ApiError,context,requireAuth,requirePermission} from './access.js';
import {recordDefinition} from './paged-records.js';
import {enabled,residentScope,type ResidentKind} from './resident-policy.js';

// A closed set of individually authorized sources, not an unrestricted UNION
// across tenant data. Never return source rows, storage keys or financial values.
export const workspaceSearch=Router();
workspaceSearch.use(requireAuth);
type Source={kind:string;sql:string;args:unknown[];title:string;description:string};
const LIMIT=6;
workspaceSearch.get('/workspace-search',async(req,res)=>{
 const c=await context(req);
 const q=z.string().trim().min(2).max(100).parse(req.query.q);
 const scope=[c.organization_id,c.building_id,c.unit_id];
 const sources:Source[]=[];
 const add=async(permission:string,source:Source)=>{
  try{await requirePermission(req,permission);sources.push(source)}
  catch(error){if(!(error instanceof ApiError&&error.status===403))throw error}
 };
 for(const kind of ['organizations','properties','units','people']){
  try{
   const d=await recordDefinition(req,kind);
   if(kind==='organizations')d.sql=`SELECT listed.*,concat(CASE WHEN is_demo THEN 'demo · ' ELSE '' END,status) AS search_label FROM (${d.sql}) listed`;
   sources.push({kind,...d,title:kind==='units'?'number':'name',
    description:kind==='organizations'?'search_label':kind==='properties'?'address':kind==='units'?'building_name':'role_key'});
  }catch(error){if(!(error instanceof ApiError&&error.status===403))throw error}
 }
 const unitScope='r.organization_id=$1 AND ($2::uuid IS NULL OR u.building_id=$2) AND ($3::uuid IS NULL OR u.id=$3)';
 await add(c.permissions.includes('requests.read')?'requests.read':'requests.own',{
  kind:'requests',sql:`SELECT r.id,r.subject,concat(b.name,' · ',u.number,' · ',r.status) AS label FROM resident_requests r JOIN units u ON u.id=r.unit_id
  JOIN buildings b ON b.id=u.building_id WHERE ${unitScope} AND ($4::boolean OR r.author_user_id=$5)`,args:[...scope,c.permissions.includes('requests.read'),req.user!.id],title:'subject',description:'label'});
 await add('workorders.assigned',{kind:'workorders',sql:`SELECT r.id,r.subject,concat(b.name,' · ',u.number,' · ',w.status) AS label FROM work_orders w
  JOIN resident_requests r ON r.id=w.request_id JOIN units u ON u.id=r.unit_id JOIN buildings b ON b.id=u.building_id
  WHERE ${unitScope} AND w.technician_id=$4`,
  args:[...scope,req.user!.id],title:'subject',description:'label'});
 await add(c.permissions.includes('defects.read')?'defects.read':'defects.assigned',{
  kind:'defects',sql:`SELECT r.id,r.subject,concat(b.name,' · ',u.number,' · ',r.status) AS label FROM defects r JOIN units u ON u.id=r.unit_id
  JOIN buildings b ON b.id=u.building_id WHERE ${unitScope} AND ($4::boolean OR r.contractor_id=$5)`,
  args:[...scope,c.permissions.includes('defects.read'),req.user!.id],title:'subject',description:'label'});
 await add(c.permissions.includes('billing.read')?'billing.read':'billing.own',{
  kind:'invoices',sql:`SELECT r.id,u.number,concat(r.period::text,' · ',r.currency) AS label FROM invoices r JOIN units u ON u.id=r.unit_id
  WHERE ${unitScope} AND ($4::boolean OR (r.payer_user_id=$5 AND r.status='published'))`,
  args:[...scope,c.permissions.includes('billing.read'),req.user!.id],title:'number',description:'label'});
 await add('documents.read',{
  kind:'documents',sql:`SELECT id,title,category FROM documents WHERE organization_id=$1
  AND ($2::uuid IS NULL OR building_id=$2) AND ($3::uuid IS NULL OR unit_id IS NULL OR unit_id=$3)
  AND ($4::boolean OR (visibility='residents' AND $5::boolean) OR (visibility='unit_owner' AND unit_id=$3 AND $6::boolean))`,
  args:[...scope,c.permissions.includes('documents.manage'),c.unit_id!==null,c.role_key==='unit_owner'],title:'title',description:'category'});
 // Support operators only search their assigned cases. Tenant users can search
 // their own cases, never another resident's or another building's case text.
 const platform=!c.organization_id;
 const supportPermission=platform?'support.cases':'support.cases.create';
 await add(supportPermission,{
  kind:'support',sql:platform
   ?`SELECT id,subject,status FROM support_cases WHERE ($1::boolean OR assigned_to=$2)`
   :`SELECT id,subject,status FROM support_cases WHERE organization_id=$1 AND created_by=$2 AND NOT $3::boolean`,
  args:platform?[c.permissions.includes('support.assign'),req.user!.id]:[c.organization_id,req.user!.id,!!(c.building_id||c.unit_id)],
  title:'subject',description:'status'});
 if(c.shell==='home'){
  const resident=await residentScope(req);
  const kinds=(['contacts','services','discussions','listings','help','conversations'] as ResidentKind[]).filter(k=>enabled(resident,k));
  for(const kind of kinds)sources.push({kind:'resident:'+kind,title:'title',description:'label',
   sql:`SELECT r.id,r.title,left(r.body,300) AS label FROM resident_product_records r
    WHERE r.organization_id=$1 AND r.building_id=$2 AND r.kind=$3 AND r.deleted_at IS NULL
    AND ((r.owner_user_id=$4 AND (r.unit_id IS NULL OR r.unit_id=$5))
     OR (r.kind='conversations' AND EXISTS(SELECT 1 FROM resident_product_records p
       WHERE p.id=r.parent_id AND p.kind='listings' AND p.owner_user_id=$4 AND p.unit_id=$5 AND p.deleted_at IS NULL))
     OR (r.kind IN('contacts','services','help','listings') AND r.status='active')
     OR (r.kind='discussions' AND r.status IN('open','closed','frozen')))
    AND (r.kind<>'help' OR r.data->>'category'=$6)`,
   args:[resident.organizationId,resident.buildingId,kind,req.user!.id,resident.unitId,req.user!.locale]});
 }
 const groups=[];
 for(const source of sources){
  // All identifiers below come from the local closed source registry.
  const n=source.args.length;
  const rows=(await pool.query(`SELECT id,${source.title}::text AS title,COALESCE(${source.description}::text,'') AS description
   FROM (${source.sql}) searchable
   WHERE strpos(lower(COALESCE(${source.title}::text,'')||' '||COALESCE(${source.description}::text,'')),lower($${n+1}))>0
   ORDER BY ${source.title},id LIMIT ${LIMIT+1}`,[...source.args,q])).rows;
  groups.push({kind:source.kind,items:rows.slice(0,LIMIT),hasMore:rows.length>LIMIT});
 }
 res.set('Cache-Control','private, no-store').json({contextId:c.id,groups});
});
