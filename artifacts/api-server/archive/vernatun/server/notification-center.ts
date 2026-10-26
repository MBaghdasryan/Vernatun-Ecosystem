import {Router} from 'express';
import {z} from 'zod';
import {pool} from './db.js';
import {requireAuth,contexts,context,requirePermission,ApiError,type Context} from './access.js';
import {transaction} from './operations.js';
export const notificationCenter=Router();notificationCenter.use(requireAuth);
const uuid=z.string().uuid(),categories=['requests','finance','community','access','leases','support','onboarding','system'] as const;
const prefs=z.object({email_enabled:z.boolean(),in_app_enabled:z.boolean(),version:z.number().int().min(0),categories:z.record(z.enum(categories),z.object({email:z.boolean().optional(),in_app:z.boolean().optional()}).strict())}).strict();
const defaults={email_enabled:true,in_app_enabled:true,categories:{},version:0};
notificationCenter.get('/notifications/catalog',async(_req,res)=>res.json({events:(await pool.query('SELECT * FROM notification_catalog ORDER BY category,code')).rows,categories,channels:{in_app:'active',email:'pending_domain',sms:'future',push:'future'}}));
notificationCenter.get('/notifications/preferences',async(req,res)=>res.json((await pool.query('SELECT email_enabled,in_app_enabled,categories,version FROM notification_preferences WHERE user_id=$1',[req.user!.id])).rows[0]??defaults));
notificationCenter.put('/notifications/preferences',async(req,res)=>{const f=prefs.parse(req.body);res.json(await transaction(async db=>{
 await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['notification-prefs:'+req.user!.id]);
 const old=(await db.query('SELECT version FROM notification_preferences WHERE user_id=$1 FOR UPDATE',[req.user!.id])).rows[0];
 if((old?.version??0)!==f.version)throw new ApiError(409,'version_conflict');
 return (await db.query(`INSERT INTO notification_preferences(user_id,email_enabled,in_app_enabled,categories) VALUES($1,$2,$3,$4)
 ON CONFLICT(user_id) DO UPDATE SET email_enabled=$2,in_app_enabled=$3,categories=$4,version=notification_preferences.version+1,updated_at=now()
 RETURNING email_enabled,in_app_enabled,categories,version`,[req.user!.id,f.email_enabled,f.in_app_enabled,JSON.stringify(f.categories)])).rows[0];
}))});
const resources:Record<string,[string,string,string]>={request:['resident_requests','requests','requests'],invoice:['invoices','finance','finance'],payment:['payments','finance','finance'],bank_transaction:['bank_transactions','finance','finance'],meeting:['meetings','community','meetings'],announcement:['announcements','community','announcements'],pass:['visitor_passes','access','passes'],lease:['leases','finance','leases'],support:['support_cases','','support-cases'],onboarding:['onboarding_steps','','onboarding']};
const payerOwnerEvents=new Set(['payer_responsibility_accepted','payer_responsibility_declined','payer_responsibility_revoked']);
async function payerResponsibilityTargets(n:any,userId:string,options:Context[]){
 const d=(await pool.query(`SELECT d.organization_id,d.unit_id,d.owner_assignment_id,d.owner_user_id,d.recipient_id,
  d.starts_on::text,p.payer_user_id,u.building_id
  FROM resident_payer_delegations d JOIN payer_assignments p ON p.id=d.payer_assignment_id
  JOIN units u ON u.id=d.unit_id
  WHERE d.id=$1 AND d.organization_id=$2`,[n.entity_id,n.organization_id])).rows[0];
 if(!d)return [];
 const owner=payerOwnerEvents.has(n.event_code);
 if(!owner&&n.event_code!=='payer_responsibility_pending')return [];
 if((owner&&(d.owner_user_id!==userId||d.payer_user_id!==d.owner_user_id))||(!owner&&d.recipient_id!==userId))return [];
 const recipientEligible=owner?false:Boolean((await pool.query(
  'SELECT resident_payer_recipient_valid($1,$2,$3,$4::date) AS ok',
  [d.organization_id,d.unit_id,userId,d.starts_on])).rows[0]?.ok);
 return options.filter(c=>c.organization_id===d.organization_id&&c.building_id===d.building_id&&
  c.unit_id===d.unit_id&&
  (owner?c.id===d.owner_assignment_id&&c.role_key==='unit_owner':
   recipientEligible&&['renter','family'].includes(c.role_key))).map(c=>({c,view:'preferences'}));
}
async function targets(n:any,userId:string,options:Context[]){
 if(n.entity_type==='system')return options.filter(c=>c.organization_id===n.organization_id).map(c=>({c,view:'settings'}));
 if(n.entity_type==='payer_responsibility')return payerResponsibilityTargets(n,userId,options);
 if(n.entity_type==='resident_conversation'){
  const row=(await pool.query(`SELECT c.id,c.organization_id,c.building_id,c.unit_id,c.owner_user_id AS author_user_id,
   p.owner_user_id AS listing_owner_id,p.unit_id AS listing_unit_id
   FROM resident_product_records c JOIN resident_product_records p ON p.id=c.parent_id AND p.kind='listings'
   JOIN resident_building_settings s ON s.building_id=c.building_id AND s.organization_id=c.organization_id AND s.marketplace
   WHERE c.id=$1 AND c.kind='conversations' AND c.organization_id=$2 AND c.deleted_at IS NULL AND p.deleted_at IS NULL`,
   [n.entity_id,n.organization_id])).rows[0];
  if(!row||n.user_id!==row.author_user_id&&n.user_id!==row.listing_owner_id)return [];
  const author=n.user_id===row.author_user_id;
  return options.filter(c=>c.organization_id===row.organization_id&&c.building_id===row.building_id&&
   c.permissions.includes('properties.own')&&c.modules?.includes('community')&&
   (author?c.unit_id===row.unit_id&&['unit_owner','renter','family'].includes(c.role_key):
    c.unit_id===row.listing_unit_id&&c.role_key==='unit_owner')).map(c=>({c,view:'marketplace'}));
 }
 const spec=resources[n.entity_type];if(!spec||!n.entity_id)return [];
 // Identifiers are from a closed whitelist; never from request inputs.
 const r=(await pool.query(`SELECT to_jsonb(t) AS row FROM ${spec[0]} t WHERE id=$1`,[n.entity_id])).rows[0]?.row;
 if(!r||r.organization_id!==n.organization_id)return [];
 let b=r.building_id,u=r.unit_id;
 if(u&&!b)b=(await pool.query('SELECT building_id FROM units WHERE id=$1',[u])).rows[0]?.building_id;
 if(n.entity_type==='payment') {
  // A recipient can resolve their own payment without exposing another account.
  return options.filter(c=>c.organization_id===n.organization_id&&c.modules?.includes('finance')&&(c.permissions.includes('billing.read')&&!c.unit_id&&!c.building_id||c.permissions.includes('billing.own')&&r.payer_user_id===userId)).map(c=>({c,view:'finance'}));
 }
 const worker=n.entity_type==='request'?(await pool.query('SELECT technician_id FROM work_orders WHERE request_id=$1',[r.id])).rows[0]?.technician_id:null;
 return options.filter(c=>{
  const p=(v:string)=>c.permissions.includes(v);
  if(n.entity_type==='support')return (p('support.cases')&&(c.role_key==='platform_admin'||r.assigned_to===userId))||(c.organization_id===n.organization_id&&p('support.cases.create')&&r.created_by===userId);
  if(n.entity_type==='onboarding')return p('onboarding.manage')&&(c.role_key==='platform_admin'||r.assigned_to===userId)||c.organization_id===n.organization_id&&p('organization.settings');
  if(c.organization_id!==n.organization_id||c.building_id&&c.building_id!==b&&!(n.entity_type==='announcement'&&!b)||c.unit_id&&u&&c.unit_id!==u||spec[1]&&!c.modules?.includes(spec[1]))return false;
  switch(n.entity_type){
   case 'request':return p('requests.read')||p('workorders.assigned')&&worker===userId||p('requests.own')&&(r.author_user_id===userId||r.reported_for_user_id===userId||!!c.unit_id&&c.unit_id===u&&!r.reported_for_user_id&&r.source!=='resident_app');
   case 'invoice':return p('billing.read')||p('billing.own')&&r.payer_user_id===userId;
   case 'bank_transaction':return p('billing.write')&&!c.unit_id&&!c.building_id;
   case 'meeting':return p('meetings.read')&&(!c.unit_id||c.building_id===b);
   case 'announcement':return p('announcements.read')&&(!b||!c.building_id||c.building_id===b);
   case 'pass':return p('access.create')&&r.created_by===userId||p('access.events');
   case 'lease':return p('leases.read')||p('leases.own')&&r.renter_id===userId;
   default:return false;
  }
 }).map(c=>({c,view:spec[2]}));
}
async function list(req:any,id?:string){const options=await contexts(req.user.id);
 const rows=(await pool.query(`SELECT n.*,COALESCE(n.event_code,notification_event_alias(n.kind)) AS code,c.category,c.critical
 FROM notifications n JOIN notification_catalog c ON c.code=COALESCE(n.event_code,notification_event_alias(n.kind))
 WHERE user_id=$1 AND in_app_enabled AND (visible_after IS NULL OR visible_after<=now()) AND ($2::uuid IS NULL OR n.id=$2) ORDER BY created_at DESC,id DESC LIMIT 100`,[req.user.id,id??null])).rows;
 return Promise.all(rows.map(async n=>({n,t:await targets(n,req.user.id,options)})));
}
notificationCenter.get('/notifications',async(req,res)=>res.json((await list(req)).map(({n,t})=>({id:n.id,kind:n.kind,event_code:n.code,category:n.category,critical:n.critical,created_at:n.created_at,read_at:n.read_at,access_denied:!t.length,targets:t.map(({c})=>({id:c.id,role_key:c.role_key,organization_name:c.organization_name,building_name:c.building_name,unit_number:c.unit_number}))}))));
notificationCenter.get('/notifications/unread-count',async(req,res)=>{
 const unread=Number((await pool.query('SELECT count(*) FROM notifications WHERE user_id=$1 AND in_app_enabled AND read_at IS NULL AND (visible_after IS NULL OR visible_after<=now())',[req.user!.id])).rows[0].count);
 res.set('Cache-Control','private, no-store').json({unread});
});
notificationCenter.get('/notifications/:id/destination',async(req,res)=>{const entry=(await list(req,uuid.parse(req.params.id)))[0];if(!entry)throw new ApiError(404,'not_found');
 const desired=req.query.contextId?uuid.parse(req.query.contextId):req.session.contextId;
 const target=entry.t.find(x=>x.c.id===desired)??(!req.query.contextId?entry.t[0]:undefined);if(!target)throw new ApiError(403,'forbidden');
 const {c,view}=target,product=view==='preferences'?'imtun':c.permissions.includes('requests.own')?'imtun':view==='finance'?'os':c.product;
 if(!['imtun','hayat','os','console'].includes(product??''))throw new ApiError(403,'forbidden');
  const query=entry.n.entity_type==='request'?`?requestId=${entry.n.entity_id}`:
   entry.n.entity_type==='resident_conversation'?`?recordKind=conversations&recordId=${entry.n.entity_id}`:'';
 res.json({targetContextId:c.id,requiresSwitch:c.id!==req.session.contextId,destination:`/${product}/${view}${query}`});
});
notificationCenter.post('/notifications/:id/read',async(req,res)=>{const r=await pool.query('UPDATE notifications SET read_at=COALESCE(read_at,now()) WHERE id=$1 AND user_id=$2 RETURNING id',[uuid.parse(req.params.id),req.user!.id]);if(!r.rowCount)throw new ApiError(404,'not_found');res.json(r.rows[0])});
// Explicit maintenance command, safe/idempotent; no email sending side effect.
notificationCenter.post('/notifications/due',async(req,res)=>{const c=await requirePermission(req,'organization.settings');if(!c.organization_id)throw new ApiError(403,'forbidden');
 res.json(await transaction(async db=>{
  let emitted=0;
  for(const [table,type,code,date,recipient] of [['visitor_passes','pass','pass_expiring','valid_until','created_by'],['leases','lease','lease_expiring','ends_on','renter_id'],['onboarding_steps','onboarding','onboarding_task_due','due_on','assigned_to'],['meetings','meeting','voting_ending','ends_at','created_by']] as const){
   const rows=(await db.query(`SELECT to_jsonb(t) AS row FROM ${table} t WHERE organization_id=$1 AND ${type==='onboarding'?'TRUE':`${date}>=now()::date`} AND ${date}<(now()+interval '3 days')`,[c.organization_id])).rows;
   for(const {row:r} of rows){
    if(r.revoked_at||r.cancelled_at||r.completed_at||r.status==='completed'||type==='meeting'&&r.status!=='published')continue;
    if(type==='meeting')await db.query("SELECT notify_audience($1,$2,NULL,$3,$4,$5,$6,ARRAY['meetings.read'])",[c.organization_id,r.building_id,code,type,r.id,code+':'+r.id+':'+r[date]]);
    else await db.query('SELECT emit_notification($1,$2,$3,$4,$5,$6)',[r[recipient],c.organization_id,code,type,r.id,code+':'+r.id+':'+r[date]]);
    emitted++;
   }
  }return {examinedDueRecords:emitted,email:'pending_domain'};
 }))});
