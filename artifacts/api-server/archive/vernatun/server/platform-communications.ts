import {Router,type Request,type Response} from 'express';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {pool} from './db.js';
import {ApiError,context,requireAuth,requirePermission,type Context} from './access.js';
import {transaction,record} from './operations.js';
import {deliverEmail} from './email.js';
import {activeLeasePredicate} from './lease-policy.js';

export const platformCommunications=Router();
platformCommunications.use('/broadcasts',requireAuth);
platformCommunications.use(['/platform/communications','/platform/notifications','/platform/email'],async(req,_res,next)=>{
 try{
  const c=await context(req);
  if(c.role_key!=='platform_admin'||c.organization_id)throw new ApiError(403,'forbidden');
  await requirePermission(req,'platform.communications.manage');
  next();
 }catch(error){next(error)}
});

const uuid=z.string().uuid();
const targetSchema=z.object({
 type:z.enum(['user','organization','building','all']),
 id:uuid.optional(),
 organizationId:uuid.optional(),
}).strict().superRefine((v,ctx)=>{
 if(v.type==='all'&& (v.id||v.organizationId))ctx.addIssue({code:'custom',path:['id'],message:'all_target_has_no_id'});
 if((v.type==='user'||v.type==='organization')&&!v.id)ctx.addIssue({code:'custom',path:['id'],message:'target_id_required'});
 if(v.type==='building'&&(!v.id||!v.organizationId))ctx.addIssue({code:'custom',path:['id'],message:'building_scope_required'});
 if(v.type!=='building'&&v.organizationId)ctx.addIssue({code:'custom',path:['organizationId'],message:'unexpected_organization'});
});
type Target=z.infer<typeof targetSchema>;
type Recipient={user_id:string;organization_id:string;email:string};
const managerTargetSchema=z.object({
 type:z.enum(['building','user']),
 id:uuid.optional(),
}).strict().superRefine((v,ctx)=>{
 if(v.type==='user'&&!v.id)ctx.addIssue({code:'custom',path:['id'],message:'target_id_required'});
 if(v.type==='building'&&v.id)ctx.addIssue({code:'custom',path:['id'],message:'building_is_context_scoped'});
});
type ManagerTarget=z.infer<typeof managerTargetSchema>;
const dateFilter=z.object({
 q:z.string().trim().max(160).default(''),
 from:z.string().date().optional(),
 to:z.string().date().optional(),
 page:z.coerce.number().int().min(1).max(10000).default(1),
 pageSize:z.coerce.number().int().min(1).max(100).default(25),
}).strict().refine(v=>!v.from||!v.to||v.from<=v.to,{path:['to'],message:'invalid_date_range'});

function searchPattern(q:string){return `%${q.replace(/[\\%_]/g,'\\$&')}%`}
function csvCell(input:unknown){
 const value=String(input??''),safe=/^\s*[=+\-@]/.test(value)?`'${value}`:value;
 return '"'+safe.replace(/"/g,'""')+'"';
}
function sendCsv(res:Response,name:string,headers:string[],rows:unknown[][]){
 res.setHeader('Content-Type','text/csv; charset=utf-8');
 res.setHeader('Content-Disposition',`attachment; filename="${name}"`);
 res.send('\uFEFF'+[headers,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n'));
}

async function validateTarget(db:any,target:Target){
 if(target.type==='all')return;
 if(target.type==='user'){
  const exists=(await db.query('SELECT id FROM users WHERE id=$1 AND NOT blocked',[target.id])).rowCount;
  if(!exists)throw new ApiError(404,'target_not_found');
  return;
 }
 if(target.type==='organization'){
  const exists=(await db.query('SELECT id FROM organizations WHERE id=$1',[target.id])).rowCount;
  if(!exists)throw new ApiError(404,'target_not_found');
  return;
 }
 const exists=(await db.query('SELECT id FROM buildings WHERE id=$1 AND organization_id=$2',[target.id,target.organizationId])).rowCount;
 if(!exists)throw new ApiError(404,'target_not_found');
}

async function recipients(db:any,target:Target):Promise<Recipient[]>{
 await validateTarget(db,target);
 const params:unknown[]=[];
 let condition='TRUE';
 if(target.type==='user'){params.push(target.id);condition=`a.user_id=$${params.length}`;}
 if(target.type==='organization'){params.push(target.id);condition=`a.organization_id=$${params.length}`;}
 if(target.type==='building'){params.push(target.id,target.organizationId);condition=`a.building_id=$1 AND a.organization_id=$2`;}
 const rows=(await db.query(`SELECT DISTINCT a.user_id,a.organization_id,lower(u.email) AS email
  FROM role_assignments a
  JOIN memberships m ON m.user_id=a.user_id AND m.organization_id=a.organization_id
  JOIN users u ON u.id=a.user_id
  WHERE ${condition} AND a.organization_id IS NOT NULL AND a.active AND m.active AND NOT u.blocked
   AND a.starts_at<=now() AND (a.expires_at IS NULL OR a.expires_at>now())
  ORDER BY a.organization_id,a.user_id`,params)).rows as Recipient[];
 return rows;
}

async function targetLabel(db:any,target:Target){
 if(target.type==='all')return 'All active users';
 if(target.type==='organization')return (await db.query('SELECT name FROM organizations WHERE id=$1',[target.id])).rows[0]?.name??'Organization';
 if(target.type==='building')return (await db.query('SELECT o.name AS organization_name,b.name AS building_name FROM buildings b JOIN organizations o ON o.id=b.organization_id WHERE b.id=$1 AND b.organization_id=$2',[target.id,target.organizationId])).rows[0]?.organization_name+' · '+((await db.query('SELECT name FROM buildings WHERE id=$1',[target.id])).rows[0]?.name??'Building');
 return (await db.query('SELECT name,email FROM users WHERE id=$1',[target.id])).rows[0]?.name??'User';
}

async function managerBroadcastContext(req:Request):Promise<Context>{
 const c=await requirePermission(req,'announcements.manage');
 if(c.role_key!=='manager'||!c.organization_id||!c.building_id)throw new ApiError(403,'building_scope_required');
 return c;
}

async function managerRecipients(db:any,c:Context,target:ManagerTarget):Promise<Recipient[]>{
 const selectedUser=target.type==='user'?target.id:null;
 const rows=(await db.query(`SELECT DISTINCT a.user_id,a.organization_id,lower(u.email) AS email
  FROM role_assignments a
  JOIN roles role ON role.key=a.role_key AND role.shell='home'
  JOIN memberships m ON m.user_id=a.user_id AND m.organization_id=a.organization_id AND m.active
  JOIN users u ON u.id=a.user_id AND NOT u.blocked
  LEFT JOIN units unit ON unit.id=a.unit_id AND unit.organization_id=a.organization_id
  WHERE a.organization_id=$1 AND COALESCE(a.building_id,unit.building_id)=$2
   AND a.role_key IN('unit_owner','renter','family') AND a.active
   AND a.starts_at<=now() AND (a.expires_at IS NULL OR a.expires_at>now())
   AND ${activeLeasePredicate('a')}
   AND ($3::uuid IS NULL OR a.user_id=$3)
  ORDER BY a.user_id`,[c.organization_id,c.building_id,selectedUser])).rows as Recipient[];
 if(target.type==='user'&&!rows.length)throw new ApiError(404,'resident_not_in_assigned_building');
 return rows;
}

async function managerTargetLabel(db:any,c:Context,target:ManagerTarget){
 if(target.type==='building'){
  return (await db.query('SELECT name FROM buildings WHERE id=$1 AND organization_id=$2',[c.building_id,c.organization_id])).rows[0]?.name??'Building residents';
 }
 return (await db.query('SELECT name FROM users WHERE id=$1',[target.id])).rows[0]?.name??'Resident';
}

function recipientCount(rows:Recipient[]){
 return new Set(rows.map(r=>r.user_id+':'+r.organization_id)).size;
}

platformCommunications.get('/broadcasts/inbox',async(req,res)=>{
 const rows=(await pool.query(`SELECT n.id,n.manual_batch_id,n.custom_title AS title,n.custom_body AS body,n.created_at,n.read_at,
  b.target_type,b.organization_id,b.building_id
  FROM notifications n JOIN platform_notification_batches b ON b.id=n.manual_batch_id
  WHERE n.user_id=$1 AND n.in_app_enabled AND (n.visible_after IS NULL OR n.visible_after<=now())
  ORDER BY n.created_at DESC,n.id DESC LIMIT 100`,[req.user!.id])).rows;
 res.set('Cache-Control','private, no-store').json(rows);
});

platformCommunications.get('/broadcasts/targets',async(req,res)=>{
 const c=await managerBroadcastContext(req);
 const residents=(await pool.query(`SELECT DISTINCT u.id,u.name,u.email
  FROM role_assignments a JOIN roles role ON role.key=a.role_key AND role.shell='home'
  JOIN memberships m ON m.user_id=a.user_id AND m.organization_id=a.organization_id AND m.active
  JOIN users u ON u.id=a.user_id AND NOT u.blocked
  LEFT JOIN units unit ON unit.id=a.unit_id AND unit.organization_id=a.organization_id
  WHERE a.organization_id=$1 AND COALESCE(a.building_id,unit.building_id)=$2
   AND a.role_key IN('unit_owner','renter','family') AND a.active
   AND a.starts_at<=now() AND (a.expires_at IS NULL OR a.expires_at>now())
   AND ${activeLeasePredicate('a')}
   AND (u.name ILIKE $3 OR u.email ILIKE $3)
  ORDER BY u.name,u.id LIMIT 500`,
 [c.organization_id,c.building_id,searchPattern(z.string().trim().max(100).default('').parse(req.query.q??''))])).rows;
 const building=(await pool.query('SELECT id,name,address FROM buildings WHERE id=$1 AND organization_id=$2',[c.building_id,c.organization_id])).rows[0];
 res.json({building,residents});
});

platformCommunications.post('/broadcasts/preview',async(req,res)=>{
 const c=await managerBroadcastContext(req),target=managerTargetSchema.parse(req.body.target);
 const rows=await managerRecipients(pool,c,target);
 res.json({count:recipientCount(rows),target:await managerTargetLabel(pool,c,target)});
});

platformCommunications.post('/broadcasts',async(req,res)=>{
 const c=await managerBroadcastContext(req);
 const b=z.object({target:managerTargetSchema,title:z.string().trim().min(1).max(140),
  body:z.string().trim().min(1).max(5000),expectedRecipients:z.number().int().min(1).max(20000),
  idempotencyKey:uuid}).strict().parse(req.body);
 const created=await transaction(async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[b.idempotencyKey]);
  const previous=(await db.query(`SELECT id,recipient_count,created_by,target_type,target_id,building_id,title,body
   FROM platform_notification_batches WHERE idempotency_key=$1`,[b.idempotencyKey])).rows[0];
  if(previous){
   const expectedTargetId=b.target.type==='user'?b.target.id:c.building_id;
   if(previous.created_by!==req.user!.id||previous.target_type!==b.target.type||previous.target_id!==expectedTargetId||
    previous.building_id!==c.building_id||previous.title!==b.title||previous.body!==b.body)
    throw new ApiError(409,'idempotency_conflict');
   return {id:previous.id,recipientCount:previous.recipient_count,replayed:true};
  }
  const audience=await managerRecipients(db,c,b.target),count=recipientCount(audience);
  if(count!==b.expectedRecipients)throw new ApiError(409,'audience_changed');
  if(!count)throw new ApiError(409,'empty_audience');
  const buildingId=c.building_id!;
  const targetId=b.target.type==='user'?b.target.id:buildingId;
  const batch=(await db.query(`INSERT INTO platform_notification_batches
   (idempotency_key,target_type,target_id,organization_id,building_id,title,body,recipient_count,created_by)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
   [b.idempotencyKey,b.target.type,targetId,c.organization_id,buildingId,b.title,b.body,count,req.user!.id])).rows[0];
  await db.query(`INSERT INTO notifications(user_id,organization_id,kind,event_code,entity_type,
   manual_batch_id,custom_title,custom_body,dedupe_key)
   SELECT r.user_id,r.organization_id,'platform_notice','broadcast_notice','platform_notice',
    $3,$4,$5,NULL FROM unnest($1::uuid[],$2::uuid[]) AS r(user_id,organization_id)`,
   [audience.map(r=>r.user_id),audience.map(r=>r.organization_id),batch.id,b.title,b.body]);
  await record(db,req,c,'broadcast.send','platform_notification_batch',batch.id,
   {targetType:b.target.type,recipientCount:count,buildingId});
  return {id:batch.id,recipientCount:count,replayed:false};
 });
 res.status(created.replayed?200:201).json(created);
});

platformCommunications.get('/broadcasts/sent',async(req,res)=>{
 const c=await managerBroadcastContext(req);
 const rows=(await pool.query(`SELECT id,target_type,target_id,title,body,recipient_count,created_at
  FROM platform_notification_batches WHERE organization_id=$1 AND building_id=$2
  ORDER BY created_at DESC,id DESC LIMIT 100`,[c.organization_id,c.building_id])).rows;
 res.json(rows);
});

platformCommunications.get('/platform/communications/targets/:kind',async(req,res)=>{
 const kind=z.enum(['organizations','buildings','users']).parse(req.params.kind);
 const q=z.string().trim().max(100).default('').parse(req.query.q??'');
 const pattern=searchPattern(q);
 if(kind==='organizations'){
  res.json((await pool.query(`SELECT id,name,company_type FROM organizations
   WHERE name ILIKE $1 ORDER BY name,id LIMIT 100`,[pattern])).rows);return;
 }
 if(kind==='buildings'){
  const organizationId=uuid.parse(req.query.organizationId);
  res.json((await pool.query(`SELECT id,name,address FROM buildings
   WHERE organization_id=$1 AND (name ILIKE $2 OR address ILIKE $2) ORDER BY name,id LIMIT 100`,[organizationId,pattern])).rows);return;
 }
 res.json((await pool.query(`SELECT DISTINCT u.id,u.name,u.email FROM users u
  JOIN role_assignments a ON a.user_id=u.id
  JOIN memberships m ON m.user_id=a.user_id AND m.organization_id=a.organization_id
  WHERE a.organization_id IS NOT NULL AND a.active AND m.active AND NOT u.blocked
   AND a.starts_at<=now() AND (a.expires_at IS NULL OR a.expires_at>now())
   AND (u.name ILIKE $1 OR u.email ILIKE $1) ORDER BY u.name,u.id LIMIT 100`,[pattern])).rows);
});

platformCommunications.post('/platform/communications/preview',async(req,res)=>{
 const body=z.object({target:targetSchema}).strict().parse(req.body);
 const rows=await recipients(pool,body.target);
 const count=body.target.type==='all'?new Set(rows.map(r=>r.email)).size:
  body.target.type==='building'||body.target.type==='organization'?new Set(rows.map(r=>r.user_id+':'+r.organization_id)).size:
  rows.length;
 res.json({count,target:await targetLabel(pool,body.target)});
});

platformCommunications.get('/platform/notifications',async(req,res)=>{
 const q=dateFilter.parse(req.query),pattern=searchPattern(q.q);
 const where=`($1='' OR b.title ILIKE $2 OR b.body ILIKE $2 OR b.target_type ILIKE $2 OR
  COALESCE(o.name,'') ILIKE $2 OR COALESCE(g.name,'') ILIKE $2 OR COALESCE(u.name,'') ILIKE $2)
  AND ($3::date IS NULL OR b.created_at >= $3::date)
  AND ($4::date IS NULL OR b.created_at < $4::date + interval '1 day')`;
 const params=[q.q,pattern,q.from??null,q.to??null];
 const total=Number((await pool.query(`SELECT count(*)::int AS n FROM platform_notification_batches b
  LEFT JOIN organizations o ON o.id=b.organization_id LEFT JOIN buildings g ON g.id=b.building_id
  LEFT JOIN users u ON u.id=b.created_by WHERE ${where}`,params)).rows[0].n);
 const items=(await pool.query(`SELECT b.id,b.target_type,b.target_id,b.organization_id,b.building_id,b.title,b.body,
  b.recipient_count,b.created_at,u.name AS created_by,
  CASE WHEN b.target_type='all' THEN 'All active users'
   WHEN b.target_type='user' THEN COALESCE(u2.name,u2.email,'User')
   WHEN b.target_type='organization' THEN COALESCE(o.name,'Organization')
   ELSE COALESCE(o.name,'Organization')||' · '||COALESCE(g.name,'Building') END AS target_label
  FROM platform_notification_batches b
  LEFT JOIN organizations o ON o.id=b.organization_id LEFT JOIN buildings g ON g.id=b.building_id
  LEFT JOIN users u ON u.id=b.created_by LEFT JOIN users u2 ON u2.id=b.target_id AND b.target_type='user'
  WHERE ${where} ORDER BY b.created_at DESC,b.id DESC LIMIT $5 OFFSET $6`,
  [...params,q.pageSize,(q.page-1)*q.pageSize])).rows;
 res.json({items,total,page:q.page,pageSize:q.pageSize});
});

platformCommunications.get('/platform/notifications/export.csv',async(req,res)=>{
 const q=dateFilter.parse({...req.query,page:1,pageSize:100}),pattern=searchPattern(q.q);
 const where=`($1='' OR b.title ILIKE $2 OR b.body ILIKE $2 OR b.target_type ILIKE $2 OR
  COALESCE(o.name,'') ILIKE $2 OR COALESCE(g.name,'') ILIKE $2 OR COALESCE(u.name,'') ILIKE $2)
  AND ($3::date IS NULL OR b.created_at >= $3::date)
  AND ($4::date IS NULL OR b.created_at < $4::date + interval '1 day')`;
 const rows=(await pool.query(`SELECT b.created_at,b.target_type,
  CASE WHEN b.target_type='all' THEN 'All active users' WHEN b.target_type='user' THEN COALESCE(u2.name,u2.email,'User')
   WHEN b.target_type='organization' THEN COALESCE(o.name,'Organization')
   ELSE COALESCE(o.name,'Organization')||' · '||COALESCE(g.name,'Building') END AS target,
  b.recipient_count,b.title,b.body,u.name AS created_by
  FROM platform_notification_batches b LEFT JOIN organizations o ON o.id=b.organization_id
  LEFT JOIN buildings g ON g.id=b.building_id LEFT JOIN users u ON u.id=b.created_by
  LEFT JOIN users u2 ON u2.id=b.target_id AND b.target_type='user'
  WHERE ${where} ORDER BY b.created_at DESC,b.id DESC LIMIT 10001`,
  [q.q,pattern,q.from??null,q.to??null])).rows;
 if(rows.length>10000)throw new ApiError(413,'export_limit_exceeded');
 sendCsv(res,'platform-notifications.csv',['created_at','target_type','target','recipients','title','body','created_by'],
  rows.map(r=>[r.created_at,r.target_type,r.target,r.recipient_count,r.title,r.body,r.created_by]));
});

platformCommunications.post('/platform/notifications',async(req,res)=>{
 const b=z.object({target:targetSchema,title:z.string().trim().min(1).max(140),
  body:z.string().trim().min(1).max(5000),expectedRecipients:z.number().int().min(1).max(20000),
  idempotencyKey:uuid}).strict().parse(req.body);
 const created=await transaction(async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[b.idempotencyKey]);
  const previous=(await db.query(`SELECT id,recipient_count,created_by,target_type,target_id,organization_id,building_id,title,body
   FROM platform_notification_batches WHERE idempotency_key=$1`,[b.idempotencyKey])).rows[0];
  if(previous){
   if(previous.created_by!==req.user!.id||previous.target_type!==b.target.type||
    previous.target_id!==(b.target.id??null)||
    previous.organization_id!==(b.target.type==='organization'?b.target.id:b.target.organizationId??null)||
    previous.building_id!==(b.target.type==='building'?b.target.id:null)||
    previous.title!==b.title||previous.body!==b.body)
    throw new ApiError(409,'idempotency_conflict');
   return {id:previous.id,recipientCount:previous.recipient_count,replayed:true};
  }
  const audience=await recipients(db,b.target);
  const count=b.target.type==='all'?new Set(audience.map(r=>r.email)).size:
   b.target.type==='building'||b.target.type==='organization'?new Set(audience.map(r=>r.user_id+':'+r.organization_id)).size:
   audience.length;
  if(count!==b.expectedRecipients)throw new ApiError(409,'audience_changed');
  if(!count)throw new ApiError(409,'empty_audience');
  const batch=(await db.query(`INSERT INTO platform_notification_batches
   (idempotency_key,target_type,target_id,organization_id,building_id,title,body,recipient_count,created_by)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
   [b.idempotencyKey,b.target.type,b.target.id??null,
    b.target.type==='organization'?b.target.id:b.target.organizationId??null,
    b.target.type==='building'?b.target.id:null,b.title,b.body,count,req.user!.id])).rows[0];
  const recipientsForNotification=b.target.type==='all'
   ? audience.filter((r,i)=>audience.findIndex(x=>x.email===r.email)===i)
   : audience;
  await db.query(`INSERT INTO notifications(user_id,organization_id,kind,event_code,entity_type,
   manual_batch_id,custom_title,custom_body,dedupe_key)
   SELECT r.user_id,r.organization_id,'platform_notice','broadcast_notice','platform_notice',
    $3,$4,$5,NULL FROM unnest($1::uuid[],$2::uuid[]) AS r(user_id,organization_id)`,
   [recipientsForNotification.map(r=>r.user_id),recipientsForNotification.map(r=>r.organization_id),
    batch.id,b.title,b.body]);
  const c=await context(req);
  await record(db,req,c,'platform.notification.send','platform_notification_batch',batch.id,
   {targetType:b.target.type,recipientCount:count});
  return {id:batch.id,recipientCount:count,replayed:false};
 });
 res.status(created.replayed?200:201).json(created);
});

platformCommunications.get('/platform/email/campaigns',async(req,res)=>{
 const q=dateFilter.parse(req.query),pattern=searchPattern(q.q);
 const where=`($1='' OR c.subject ILIKE $2 OR c.body_text ILIKE $2 OR c.status ILIKE $2 OR
  c.target_type ILIKE $2 OR COALESCE(o.name,'') ILIKE $2 OR COALESCE(g.name,'') ILIKE $2)
  AND ($3::date IS NULL OR c.created_at >= $3::date)
  AND ($4::date IS NULL OR c.created_at < $4::date + interval '1 day')`;
 const params=[q.q,pattern,q.from??null,q.to??null];
 const total=Number((await pool.query(`SELECT count(*)::int AS n FROM platform_email_campaigns c
  LEFT JOIN organizations o ON o.id=c.organization_id LEFT JOIN buildings g ON g.id=c.building_id WHERE ${where}`,params)).rows[0].n);
 const items=(await pool.query(`SELECT c.id,c.target_type,c.target_id,c.organization_id,c.building_id,c.subject,
  c.recipient_count,c.status,c.created_at,c.finished_at,
  CASE WHEN c.target_type='all' THEN 'All active users' WHEN c.target_type='user' THEN COALESCE(u2.name,u2.email,'User')
   WHEN c.target_type='organization' THEN COALESCE(o.name,'Organization')
   ELSE COALESCE(o.name,'Organization')||' · '||COALESCE(g.name,'Building') END AS target_label,
  count(r.id)::int AS processed_count,
  count(r.id) FILTER(WHERE r.status IN('accepted','local'))::int AS accepted_count,
  count(r.id) FILTER(WHERE r.status='failed')::int AS failed_count,
  count(r.id) FILTER(WHERE r.status='unknown')::int AS unknown_count
  FROM platform_email_campaigns c LEFT JOIN organizations o ON o.id=c.organization_id
  LEFT JOIN buildings g ON g.id=c.building_id LEFT JOIN users u2 ON u2.id=c.target_id AND c.target_type='user'
  LEFT JOIN platform_email_campaign_recipients r ON r.campaign_id=c.id
  WHERE ${where} GROUP BY c.id,o.name,g.name,u2.name,u2.email
  ORDER BY c.created_at DESC,c.id DESC LIMIT $5 OFFSET $6`,
  [...params,q.pageSize,(q.page-1)*q.pageSize])).rows;
 res.json({items,total,page:q.page,pageSize:q.pageSize});
});

platformCommunications.get('/platform/email/campaigns/export.csv',async(req,res)=>{
 const q=dateFilter.parse({...req.query,page:1,pageSize:100}),pattern=searchPattern(q.q);
 const where=`($1='' OR c.subject ILIKE $2 OR c.body_text ILIKE $2 OR c.status ILIKE $2 OR
  c.target_type ILIKE $2 OR COALESCE(o.name,'') ILIKE $2 OR COALESCE(g.name,'') ILIKE $2)
  AND ($3::date IS NULL OR c.created_at >= $3::date)
  AND ($4::date IS NULL OR c.created_at < $4::date + interval '1 day')`;
 const rows=(await pool.query(`SELECT c.created_at,c.target_type,
  CASE WHEN c.target_type='all' THEN 'All active users' WHEN c.target_type='user' THEN COALESCE(u2.name,u2.email,'User')
   WHEN c.target_type='organization' THEN COALESCE(o.name,'Organization')
   ELSE COALESCE(o.name,'Organization')||' · '||COALESCE(g.name,'Building') END AS target,
  c.subject,c.recipient_count,c.status,
  count(r.id) FILTER(WHERE r.status IN('accepted','local'))::int AS accepted_count,
  count(r.id) FILTER(WHERE r.status='failed')::int AS failed_count,
  count(r.id) FILTER(WHERE r.status='unknown')::int AS unknown_count
  FROM platform_email_campaigns c LEFT JOIN organizations o ON o.id=c.organization_id
  LEFT JOIN buildings g ON g.id=c.building_id LEFT JOIN users u2 ON u2.id=c.target_id AND c.target_type='user'
  LEFT JOIN platform_email_campaign_recipients r ON r.campaign_id=c.id
  WHERE ${where} GROUP BY c.id,o.name,g.name,u2.name,u2.email
  ORDER BY c.created_at DESC,c.id DESC LIMIT 10001`,[q.q,pattern,q.from??null,q.to??null])).rows;
 if(rows.length>10000)throw new ApiError(413,'export_limit_exceeded');
 sendCsv(res,'platform-email-campaigns.csv',['created_at','target_type','target','subject','recipients','status','accepted','failed','unknown'],
  rows.map(r=>[r.created_at,r.target_type,r.target,r.subject,r.recipient_count,r.status,r.accepted_count,r.failed_count,r.unknown_count]));
});

platformCommunications.post('/platform/email/campaigns',async(req,res)=>{
 const b=z.object({target:targetSchema,subject:z.string().trim().min(1).max(200),
  body:z.string().trim().min(1).max(10000),expectedRecipients:z.number().int().min(1).max(5000),
  idempotencyKey:uuid}).strict().parse(req.body);
 const created=await transaction(async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[b.idempotencyKey]);
  const previous=(await db.query(`SELECT id,recipient_count,status,created_by,target_type,target_id,organization_id,building_id,subject,body_text
   FROM platform_email_campaigns WHERE idempotency_key=$1`,[b.idempotencyKey])).rows[0];
  if(previous){
   if(previous.created_by!==req.user!.id||previous.target_type!==b.target.type||
    previous.target_id!==(b.target.id??null)||
    previous.organization_id!==(b.target.type==='organization'?b.target.id:b.target.organizationId??null)||
    previous.building_id!==(b.target.type==='building'?b.target.id:null)||
    previous.subject!==b.subject||previous.body_text!==b.body)
    throw new ApiError(409,'idempotency_conflict');
   return {id:previous.id,recipient_count:previous.recipient_count,status:previous.status,replayed:true};
  }
  const audience=await recipients(db,b.target);
  const distinct=[...new Map(audience.map(r=>[r.email.toLowerCase(),r])).values()];
  if(distinct.length!==b.expectedRecipients)throw new ApiError(409,'audience_changed');
  if(!distinct.length)throw new ApiError(409,'empty_audience');
  if(distinct.length>5000)throw new ApiError(413,'campaign_recipient_limit');
  const organizationId=b.target.type==='organization'?b.target.id:b.target.organizationId??null;
  const buildingId=b.target.type==='building'?b.target.id:null;
  const campaign=(await db.query(`INSERT INTO platform_email_campaigns
   (idempotency_key,target_type,target_id,organization_id,building_id,subject,body_text,recipient_count,created_by)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,recipient_count,status`,
   [b.idempotencyKey,b.target.type,b.target.id??null,organizationId,buildingId,b.subject,b.body,distinct.length,req.user!.id])).rows[0];
  await db.query(`INSERT INTO platform_email_campaign_recipients(campaign_id,user_id,organization_id,email)
   SELECT $1,r.user_id,r.organization_id,r.email FROM unnest($2::uuid[],$3::uuid[],$4::text[])
   AS r(user_id,organization_id,email)`,[campaign.id,distinct.map(r=>r.user_id),distinct.map(r=>r.organization_id),distinct.map(r=>r.email)]);
  const c=await context(req);
  await record(db,req,c,'platform.email.campaign.create','platform_email_campaign',campaign.id,
   {targetType:b.target.type,recipientCount:distinct.length});
  return {...campaign,replayed:false};
 });
 res.status(created.replayed?200:201).json(created);
});

platformCommunications.post('/platform/email/campaigns/:id/dispatch',async(req,res)=>{
 const id=uuid.parse(req.params.id);
 const batch=await transaction(async db=>{
  await db.query(`UPDATE platform_email_campaign_recipients SET status='unknown',failure_code='dispatch_interrupted',updated_at=now()
   WHERE campaign_id=$1 AND status='sending' AND updated_at<now()-interval '5 minutes'`,[id]);
  const campaign=(await db.query('SELECT * FROM platform_email_campaigns WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(!campaign)throw new ApiError(404,'not_found');
  const rows=(await db.query(`SELECT * FROM platform_email_campaign_recipients
   WHERE campaign_id=$1 AND status='queued' ORDER BY id LIMIT 25 FOR UPDATE SKIP LOCKED`,[id])).rows;
  if(rows.length){
   await db.query(`UPDATE platform_email_campaign_recipients SET status='sending',updated_at=now()
    WHERE id=ANY($1::uuid[])`,[rows.map((r:any)=>r.id)]);
   await db.query("UPDATE platform_email_campaigns SET status='sending' WHERE id=$1",[id]);
  }
  return {campaign,rows};
 });
 for(const r of batch.rows){
  try{
   const outcome=await deliverEmail({to:r.email,subject:batch.campaign.subject,text:batch.campaign.body_text,url:''},
    `notification-${r.id}`,{business:{type:'notification',id,organizationId:r.organization_id}});
    const state=outcome.delivery==='local_only'?'local':'accepted';
    const messageId=outcome.delivery==='local_only'?null:outcome.messageId??null;
   await pool.query(`UPDATE platform_email_campaign_recipients SET status=$2,provider_message_id=$3,
     failure_code=NULL,updated_at=now() WHERE id=$1`,[r.id,state,messageId]);
  }catch(error){
   const code=(error as {code?:string})?.code;
   const state=code==='email_not_configured'||code==='email_delivery_failed'?'failed':'unknown';
   await pool.query(`UPDATE platform_email_campaign_recipients SET status=$2,failure_code=$3,updated_at=now() WHERE id=$1`,
    [r.id,state,code??'delivery_unconfirmed']);
  }
 }
 const finalized=await transaction(async db=>{
  const counts=(await db.query(`SELECT
   count(*) FILTER(WHERE status='queued')::int AS queued,
   count(*) FILTER(WHERE status='sending')::int AS sending,
   count(*) FILTER(WHERE status='accepted')::int AS accepted,
   count(*) FILTER(WHERE status='local')::int AS local,
   count(*) FILTER(WHERE status='failed')::int AS failed,
   count(*) FILTER(WHERE status='unknown')::int AS unknown
   FROM platform_email_campaign_recipients WHERE campaign_id=$1`,[id])).rows[0];
  const pending=counts.queued+counts.sending;
  const done=!pending;
  const totalAccepted=counts.accepted+counts.local;
  const status=pending?'sending':counts.unknown?'unknown':counts.failed&&totalAccepted?'partial':counts.failed?'failed':counts.local?'local':'accepted';
  await db.query('UPDATE platform_email_campaigns SET status=$2,finished_at=CASE WHEN $3 THEN now() ELSE NULL END WHERE id=$1',[id,status,done]);
  const c=await context(req);
  await record(db,req,c,'platform.email.campaign.dispatch','platform_email_campaign',id,
   {processed:batch.rows.length,remaining:pending,status});
  return {status,done,processed:batch.rows.length,remaining:pending,
   accepted:totalAccepted,failed:counts.failed,unknown:counts.unknown};
 });
 res.json(finalized);
});
