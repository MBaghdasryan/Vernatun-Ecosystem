import {Router,type Request} from 'express';
import {z} from 'zod';
import type {PoolClient} from 'pg';
import {pool} from './db.js';
import {context,requirePermission,requireAuth,ApiError,type Context} from './access.js';
import {transaction,idempotent,record} from './operations.js';
import {uuid,title,text,globalAdmin,globalSupport,globalQueueLead,operator,version} from './platform-ops-shared.js';
import {readPrivateFile} from './private-files.js';
import {subscriptionPolicy} from './subscription-policy.js';
export const supportConversation=Router();supportConversation.use(requireAuth);
const priority=z.enum(['low','normal','high','urgent']);
const attachmentVersions=z.array(z.object({documentId:uuid,versionId:uuid}).strict()).max(10).default([]);
async function access(req:Request){const c=await context(req);await requirePermission(req,globalQueueLead(c)?'support.assign':globalAdmin(c)?'organizations.manage':globalSupport(c)?'support.cases':'support.cases.create');return c}
function visible(c:Context,r:any,user:string){
 if(globalAdmin(c)||globalQueueLead(c))return true;
 if(globalSupport(c))return !r.assigned_to||r.assigned_to===user;
 return c.organization_id===r.organization_id&&(!(c.building_id||c.unit_id)||r.created_by===user);
}
async function locked(db:PoolClient,c:Context,id:string,user:string){
 const r=(await db.query('SELECT * FROM support_cases WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!r||!visible(c,r,user))throw new ApiError(404,'not_found');return r;
}
export async function attachmentRefs(db:PoolClient,c:Context,org:string,ids:string[],versions:{documentId:string;versionId:string}[]=[]){
 if(!ids.length){if(versions.length)throw new ApiError(400,'invalid_reference');return}
 if(!c.permissions.includes('documents.read')||!c.modules?.includes('documents')||c.organization_id!==org)throw new ApiError(403,'attachment_access_denied');
 const rows=await db.query(`SELECT d.id,d.version,d.latest_version_id FROM documents d
 WHERE d.id=ANY($1::uuid[]) AND d.organization_id=$2 AND ($3::uuid IS NULL OR d.building_id=$3)
 AND ($4::uuid IS NULL OR d.unit_id IS NULL OR d.unit_id=$4)
 AND ($5 OR (d.visibility='residents' AND $4::uuid IS NOT NULL)
 OR (d.visibility='unit_owner' AND d.unit_id=$4 AND $6)) ORDER BY d.id FOR SHARE OF d`,[ids,org,c.building_id,c.unit_id,c.permissions.includes('documents.manage'),c.role_key==='unit_owner']);
 if(rows.rowCount!==new Set(ids).size)throw new ApiError(404,'attachment_not_found');
 if(new Set(versions.map(v=>v.documentId)).size!==versions.length||versions.some(v=>!ids.includes(v.documentId)))throw new ApiError(400,'invalid_reference');
 for(const d of rows.rows){const v=versions.find(v=>v.documentId===d.id);if(v&&v.versionId!==d.latest_version_id)throw new ApiError(409,'attachment_changed');if(!v&&d.version>1)throw new ApiError(409,'attachment_version_required')}
}
// Posting an authorized document reference explicitly shares ONLY this file
// with the case participants. It is not a blanket documents.read grant.
export async function sharedDocument(db:PoolClient,c:Context,id:string,documentId:string,user:string,versionId?:string){
 const r=await locked(db,c,id,user),staff=globalAdmin(c)||globalQueueLead(c)||globalSupport(c);
 if(globalSupport(c)&&!globalAdmin(c)&&!globalQueueLead(c)&&r.assigned_to!==user)throw new ApiError(403,'case_not_assigned');
 const d=(await db.query(`SELECT d.id,d.organization_id,v.storage_key,v.media_type,v.id AS version_id
 FROM documents d JOIN support_document_shares s ON s.document_id=d.id JOIN support_messages m ON m.id=s.message_id
 JOIN document_versions v ON v.id=s.version_id
 WHERE d.id=$1 AND d.organization_id=$2 AND m.case_id=$3 AND ($4 OR NOT m.internal)
 AND ($5::uuid IS NULL OR v.id=$5) ORDER BY m.created_at NULLS FIRST,m.id LIMIT 1`,[documentId,r.organization_id,id,staff,versionId??null])).rows[0];
 if(!d)throw new ApiError(404,'attachment_not_found');
 if(!(await subscriptionPolicy(r.organization_id,db)).modules.includes('documents'))throw new ApiError(403,'module_disabled');
 return d;
}
supportConversation.get('/platform/support-cases/:id/attachments/:documentId',async(req,res)=>{
 const c=await access(req),id=uuid.parse(req.params.id),documentId=uuid.parse(req.params.documentId);
 const d=await transaction(db=>sharedDocument(db,c,id,documentId,req.user!.id,req.query.versionId?uuid.parse(req.query.versionId):undefined));
 const body=await readPrivateFile('documents',d.storage_key);
 await transaction(db=>record(db,req,{...c,organization_id:d.organization_id},'support.attachment.read','support_case',id,{documentId}));
 res.set({'Content-Type':d.media_type,'Content-Disposition':`attachment; filename="support-document.${d.media_type==='application/pdf'?'pdf':'jpg'}"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}).send(body);
});
supportConversation.get('/platform/support-cases',async(req,res)=>{
 const c=await access(req),q=z.object({queue:z.enum(['unassigned','mine','all']).default('all'),status:z.enum(['open','in_progress','resolved']).optional(),priority:priority.optional(),organizationId:uuid.optional(),overdue:z.enum(['true','false']).default('false'),search:z.string().max(100).default(''),page:z.coerce.number().int().min(0).max(100000).default(0)}).parse(req.query);
 const admin=globalAdmin(c)||globalQueueLead(c),staff=globalSupport(c);
 res.json((await pool.query(`SELECT s.*,o.name AS organization_name,u.name AS assignee_name FROM support_cases s JOIN organizations o ON o.id=s.organization_id LEFT JOIN users u ON u.id=s.assigned_to
 WHERE ($1 OR ($2 AND (s.assigned_to=$3 OR s.assigned_to IS NULL)) OR (NOT $2 AND s.organization_id=$4 AND (NOT $5 OR s.created_by=$3)))
 AND ($6='all' OR ($6='mine' AND s.assigned_to=$3) OR ($6='unassigned' AND s.assigned_to IS NULL))
 AND ($7::text IS NULL OR s.status=$7) AND ($8::text IS NULL OR s.priority=$8) AND ($9::uuid IS NULL OR s.organization_id=$9)
 AND (NOT $10 OR (s.status<>'resolved' AND s.sla_due_at<now())) AND ($11='' OR s.subject ILIKE '%'||$11||'%')
 ORDER BY s.created_at DESC,s.id DESC LIMIT 50 OFFSET $12`,[admin,staff,req.user!.id,c.organization_id,!!(c.building_id||c.unit_id),q.queue,q.status??null,q.priority??null,q.organizationId??null,q.overdue==='true',q.search,q.page*50])).rows);
});
supportConversation.post('/platform/support-cases',async(req,res)=>{
 const c=await requirePermission(req,'support.cases.create');if(!c.organization_id)throw new ApiError(403,'forbidden');
 const b=z.object({key:uuid,subject:title,body:text,priority:priority.default('normal'),category:title.default('general'),attachmentIds:z.array(uuid).max(10).default([]),attachmentVersions}).strict().parse(req.body);
 res.status(201).json(await transaction(db=>idempotent(db,req,b.key,b,async()=>{
 await attachmentRefs(db,c,c.organization_id!,b.attachmentIds,b.attachmentVersions);
 const hours={low:72,normal:48,high:12,urgent:4}[b.priority];
 const r=(await db.query(`INSERT INTO support_cases(organization_id,created_by,subject,body,priority,category,sla_due_at)
 VALUES($1,$2,$3,$4,$5,$6,now()+$7::int*interval '1 hour') RETURNING *`,[c.organization_id,req.user!.id,b.subject,b.body,b.priority,b.category,hours])).rows[0];
 await db.query('INSERT INTO support_messages(case_id,author_id,body,attachment_ids) VALUES($1,$2,$3,$4)',[r.id,req.user!.id,b.body,b.attachmentIds]);
 await record(db,req,c,'support.case.create','support_case',r.id);return r;})));
});
supportConversation.get('/platform/support-cases/:id',async(req,res)=>{
 const c=await access(req),id=uuid.parse(req.params.id);
 res.json(await transaction(async db=>{const r=await locked(db,c,id,req.user!.id);const staff=globalAdmin(c)||globalQueueLead(c)||globalSupport(c);
 return {...r,messages:(await db.query(`SELECT m.*,u.name AS author_name,COALESCE((SELECT json_agg(json_build_object('documentId',s.document_id,'versionId',s.version_id,'title',v.title)) FROM support_document_shares s JOIN document_versions v ON v.id=s.version_id WHERE s.message_id=m.id),'[]') AS attachment_versions FROM support_messages m LEFT JOIN users u ON u.id=m.author_id WHERE case_id=$1 AND ($2 OR NOT internal) ORDER BY CASE m.legacy_source WHEN 'legacy_body' THEN 0 WHEN 'legacy_reply' THEN 1 ELSE 2 END,m.created_at,m.id`,[id,staff])).rows};}));
});
supportConversation.post('/platform/support-cases/:id/messages',async(req,res)=>{
 const c=await access(req),id=uuid.parse(req.params.id),b=z.object({key:uuid,version:z.number().int().positive(),body:text,internal:z.boolean().default(false),attachmentIds:z.array(uuid).max(10).default([])}).strict().parse(req.body);
 res.status(201).json(await transaction(async db=>{const r=await locked(db,c,id,req.user!.id);return idempotent(db,req,b.key,b,async()=>{version(r,b.version);
 if(b.internal&&!globalAdmin(c)&&!globalQueueLead(c)&&!globalSupport(c))throw new ApiError(403,'forbidden');
 if(globalSupport(c)&&!globalAdmin(c)&&!globalQueueLead(c)&&r.assigned_to!==req.user!.id)throw new ApiError(403,'case_not_assigned');
 if(r.status==='resolved')throw new ApiError(409,'case_resolved');await attachmentRefs(db,c,r.organization_id,b.attachmentIds);
 const m=(await db.query('INSERT INTO support_messages(case_id,author_id,body,internal,attachment_ids) VALUES($1,$2,$3,$4,$5) RETURNING *',[id,req.user!.id,b.body,b.internal,b.attachmentIds])).rows[0];
 await db.query('UPDATE support_cases SET version=version+1,updated_at=now() WHERE id=$1',[id]);await record(db,req,{...c,organization_id:r.organization_id},'support.message','support_case',id,{messageId:m.id,internal:b.internal});return m;})}));
});
supportConversation.post('/platform/support-cases/:id/change',async(req,res)=>{
 const c=await access(req),id=uuid.parse(req.params.id),b=z.object({key:uuid,version:z.number().int().positive(),assigneeId:uuid.nullable().optional(),status:z.enum(['open','in_progress','resolved']).optional(),priority:priority.optional(),category:title.optional()}).strict().refine(b=>b.assigneeId!==undefined||b.status||b.priority||b.category).parse(req.body);
 res.json(await transaction(async db=>{
 // Admin can reassign a case owned by another support operator.
 const r=await locked(db,c,id,req.user!.id);return idempotent(db,req,b.key,b,async()=>{version(r,b.version);
 if(b.assigneeId!==undefined){if(!globalQueueLead(c))throw new ApiError(403,'forbidden');if(b.assigneeId)await operator(db,b.assigneeId,'support')}
 if(b.status&&!globalAdmin(c)&&!globalQueueLead(c)&&!globalSupport(c))throw new ApiError(403,'forbidden');
 if(globalSupport(c)&&!globalQueueLead(c)&&!globalAdmin(c)&&r.assigned_to!==req.user!.id)throw new ApiError(403,'case_not_assigned');
 const status=b.status??r.status;
 const out=(await db.query(`UPDATE support_cases SET assigned_to=$2,status=$3,priority=$4,category=$5,
 sla_due_at=created_at+CASE $4 WHEN 'low' THEN 72 WHEN 'normal' THEN 48 WHEN 'high' THEN 12 ELSE 4 END*interval '1 hour',
 resolved_at=CASE WHEN $3='resolved' THEN COALESCE(resolved_at,now()) ELSE NULL END,version=version+1,updated_at=now()
 WHERE id=$1 RETURNING *`,[id,b.assigneeId===undefined?r.assigned_to:b.assigneeId,status,b.priority??r.priority,b.category??r.category])).rows[0];
 await record(db,req,{...c,organization_id:r.organization_id},'support.case.change','support_case',id,{from:r.status,to:status,assignee:out.assigned_to,priority:out.priority});return out;})}));
});
