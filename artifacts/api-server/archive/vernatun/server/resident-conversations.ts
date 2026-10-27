import {Router} from 'express';
import {z} from 'zod';
import {ApiError,requireAuth,requirePermission} from './access.js';
import {record,transaction} from './operations.js';
import {actionsFor,assertEnabled,publicRecord,readRecord,residentKinds,residentScope,writable} from './resident-policy.js';
import {notifyResidentViewing,type ResidentViewingEvent} from './resident-viewing-notifications.js';
import {conversionInput,convertDiscussion,authorizeConversion} from './resident-conversion.js';

export const residentConversations=Router();
residentConversations.use(requireAuth);
const uuid=z.string().uuid();
residentConversations.get('/discussions/:id/links/:target',async(req,res)=>{
 const s=await residentScope(req,true);assertEnabled(s,'discussions');
 if(!s.settings.discussions||!s.c.modules?.includes('community'))throw new ApiError(403,'module_disabled');
 const target=z.enum(['request','proposal']).parse(req.params.target);
 if(target==='request'&&!s.c.modules.includes('requests'))throw new ApiError(403,'module_disabled');
 res.json(await transaction(async db=>{
  const row=await readRecord(db,s,'discussions',uuid.parse(req.params.id),req.user!.id);
   if(target==='proposal'&&!s.c.permissions.includes('meetings.read')&&!s.c.permissions.includes('meetings.manage')){
    const ownProposal=await db.query(`SELECT p.id FROM resident_discussion_lineage l
     JOIN resident_agenda_proposals p ON p.id=l.proposal_id
     WHERE l.discussion_id=$1 AND l.organization_id=$2 AND l.building_id=$3 AND p.submitted_by=$4 LIMIT 1`,
     [row.id,s.organizationId,s.buildingId,req.user!.id]);
    if(!ownProposal.rowCount)await requirePermission(req,'meetings.read');
   }
   let result:any;
   if(target==='request'){
    result=(await db.query(`SELECT r.id,r.subject AS title,r.status,
     LEFT(COALESCE(l.source_text,$5),280) AS "sourceExcerpt"
     FROM resident_requests r
      LEFT JOIN units u ON u.id=r.unit_id
     LEFT JOIN resident_discussion_lineage l ON l.request_id=r.id AND l.discussion_id=$1
      AND l.organization_id=$2 AND l.building_id=$3
      WHERE (l.discussion_id=$1 OR r.source_discussion_id=$1 OR r.id=$4)
       AND r.organization_id=$2 AND COALESCE(r.building_id,u.building_id)=$3
      ORDER BY (l.discussion_id=$1) DESC,l.created_at DESC NULLS LAST,r.created_at DESC LIMIT 1`,
     [row.id,s.organizationId,s.buildingId,row.linked_request_id,row.body])).rows[0];
   }else{
    // A resident-created proposal stays a proposal until a manager reviews it.
    // Its submitter can follow that review without exposing pending proposals
    // from unrelated residents or unpublished official agenda items.
    result=(await db.query(`SELECT p.id,p.title,p.status,p.meeting_id AS "meetingId",m.title AS "meetingTitle",
     COALESCE(m.was_published,false) AS was_published,LEFT(l.source_text,280) AS "sourceExcerpt",
     true AS resident_proposal
     FROM resident_discussion_lineage l
     JOIN resident_agenda_proposals p ON p.id=l.proposal_id
     LEFT JOIN meetings m ON m.id=p.meeting_id
     WHERE l.discussion_id=$1 AND l.organization_id=$2 AND l.building_id=$3
      AND l.link_type='agenda_proposal' AND
      (p.submitted_by=$4 OR $5 OR (p.status IN ('included','decided') AND m.was_published))
     ORDER BY l.created_at DESC LIMIT 1`,
     [row.id,s.organizationId,s.buildingId,req.user!.id,s.c.permissions.includes('meetings.manage')])).rows[0];
    if(!result){
     // Preserve links created by the older direct-to-draft agenda flow, while
     // continuing to hide drafts from residents until their meeting is published.
     result=(await db.query(`SELECT a.id,a.title,m.status,m.was_published,m.id AS "meetingId",m.title AS "meetingTitle",
      LEFT(COALESCE(l.source_text,d.body),280) AS "sourceExcerpt"
      FROM agenda_items a JOIN meetings m ON m.id=a.meeting_id
      JOIN resident_product_records d ON d.id=a.source_discussion_id AND d.kind='discussions'
      LEFT JOIN resident_discussion_lineage l ON l.discussion_id=d.id AND l.meeting_id=m.id
      WHERE a.source_discussion_id=$1 AND m.organization_id=$2 AND m.building_id=$3
      ORDER BY a.id LIMIT 1`,
      [row.id,s.organizationId,s.buildingId])).rows[0];
    }
   }
  if(!result)throw new ApiError(404,'not_found');
   if(target==='proposal'&&!result.resident_proposal&&!result.was_published&&!s.c.permissions.includes('meetings.manage'))throw new ApiError(404,'not_found');
  const {was_published:_,...summary}=result;
  return {...summary,target};
 }));
});
residentConversations.post('/records/:kind/:id/actions',async(req,res)=>{
 const kind=residentKinds.parse(req.params.kind),s=await residentScope(req,kind==='discussions');assertEnabled(s,kind);writable(s);
 const b=z.object({action:z.enum(['accept','withdraw','submit','approve','reject','activate','cancel','close','reopen','freeze','support','unsupport','read','save','unsave','report','request','proposal','confirm_viewing','decline_viewing','cancel_viewing']),
  version:z.number().int().positive(),reason:z.string().trim().max(2000).optional(),conversion:conversionInput.optional()}).strict().parse(req.body);
 if(b.action==='request'||b.action==='proposal')await authorizeConversion(req,s,b.action);
 res.json(await transaction(async db=>{
  const row=await readRecord(db,s,kind,uuid.parse(req.params.id),req.user!.id,true);
  if(b.action==='request'||b.action==='proposal'){
   await convertDiscussion(db,req,s,row,b.action,b.conversion,b.version);
   return publicRecord(await readRecord(db,s,kind,row.id,req.user!.id),s,req.user!.id);
  }
  if(b.conversion)throw new ApiError(400,'invalid_conversion');
  if(!actionsFor(row,s,req.user!.id).includes(b.action))throw new ApiError(403,'forbidden');
  if(row.version!==b.version)throw new ApiError(409,'stale_version');
  let viewingOwnerId:string|null=null;
  if(['confirm_viewing','decline_viewing','cancel_viewing'].includes(b.action)){
   // Lock the listing as well: closure/moderation must not race confirmation.
   const listing=b.action==='cancel_viewing'
    ?(await db.query(`SELECT owner_user_id FROM resident_product_records WHERE id=$1 AND organization_id=$2
      AND building_id=$3 AND kind='listings' AND deleted_at IS NULL FOR UPDATE`,[row.parent_id,s.organizationId,s.buildingId])).rows[0]
    :await readRecord(db,s,'listings',row.parent_id,req.user!.id,true);
   if(!listing)throw new ApiError(404,'not_found');
   if(b.action!=='cancel_viewing'&&(listing.status!=='active'||listing.owner_user_id!==req.user!.id))throw new ApiError(403,'forbidden');
   if(b.action==='confirm_viewing'&&Date.parse(row.data.viewingAt)<=Date.now())throw new ApiError(409,'invalid_viewing_time');
    viewingOwnerId=listing.owner_user_id;
  }
  const mark:{[key:string]:string}={accept:'accepted',withdraw:'withdrawn',save:'saved',unsave:'saved',support:'supported',unsupport:'supported',read:'read',report:'reported'};
  const m=mark[b.action];
  if(m){
   if(b.action==='withdraw'&&(!row.data.withdrawable||row.data.mandatory))throw new ApiError(403,'consent_required');
   if(b.action==='report'&&!b.reason)throw new ApiError(400,'reason_required');
   if(['unsave','unsupport'].includes(b.action))await db.query('DELETE FROM resident_record_marks WHERE record_id=$1 AND user_id=$2 AND mark=$3',[row.id,req.user!.id,m]);
   else{
    await db.query(`INSERT INTO resident_record_marks(record_id,user_id,mark) VALUES($1,$2,$3)
     ON CONFLICT(record_id,user_id,mark) DO UPDATE SET created_at=now()`,[row.id,req.user!.id,m]);
    if(b.action==='accept')await db.query("DELETE FROM resident_record_marks WHERE record_id=$1 AND user_id=$2 AND mark='withdrawn'",[row.id,req.user!.id]);
   }
  }else{
   let status:string;
   switch(b.action){
    case 'submit':status='submitted';break;
    case 'approve':status='active';break;
    case 'reject':if(!b.reason)throw new ApiError(400,'reason_required');status='rejected';break;
    case 'cancel':status=s.administrative||row.status==='requested'?'ended':'cancel_requested';break;
    case 'close':status='closed';break;
    case 'reopen':status='open';break;
    case 'freeze':status='frozen';break;
    case 'confirm_viewing':case 'decline_viewing':case 'cancel_viewing':status=row.status;break;
    default:throw new ApiError(409,'invalid_transition');
   }
   const data={...row.data,...(b.reason?{decisionReason:b.reason}:{}),
    ...(['confirm_viewing','decline_viewing','cancel_viewing'].includes(b.action)?{
     viewingStatus:b.action==='confirm_viewing'?'confirmed':b.action==='decline_viewing'?'declined':'cancelled',
     viewingUpdatedAt:new Date().toISOString(),
    }:{}),
    ...(b.action==='approve'?{approvedAt:new Date().toISOString()}:{}),
   };
   await db.query('UPDATE resident_product_records SET status=$2,data=$3,version=version+1,updated_at=now() WHERE id=$1',[row.id,status,JSON.stringify(data)]);
    if(row.kind==='conversations'&&row.data.viewingAt&&viewingOwnerId){
     const recipient=b.action==='cancel_viewing'?viewingOwnerId:row.owner_user_id;
     const event:ResidentViewingEvent=b.action==='confirm_viewing'?'viewing_confirmed':
      b.action==='decline_viewing'?'viewing_declined':'viewing_cancelled';
     await notifyResidentViewing(db,recipient,s.organizationId,row.id,event);
    }
  }
  await record(db,req,{...s.c,organization_id:s.organizationId},'resident.'+kind+'.'+b.action,'resident_record',row.id,
   {recordVersion:row.version,contextId:s.c.id,...(b.reason?{reason:b.reason}:{}),...(kind==='agreements'?{category:row.data.category,agreementRevision:row.data.agreementRevision??1}:{}),
   });
  const next=await readRecord(db,s,kind,row.id,req.user!.id);
  const marks=(await db.query(`SELECT mark FROM resident_record_marks WHERE record_id=$1 AND user_id=$2`,[row.id,req.user!.id])).rows.map(x=>x.mark);
  return publicRecord({...next,accepted:marks.includes('accepted')&&!marks.includes('withdrawn'),saved:marks.includes('saved'),supported:marks.includes('supported')},s,req.user!.id);
 }));
});

residentConversations.get('/records/:kind/:id/messages',async(req,res)=>{
 const s=await residentScope(req),kind=residentKinds.parse(req.params.kind);assertEnabled(s,kind);
 if(!['conversations','discussions'].includes(kind))throw new ApiError(405,'method_not_allowed');
 res.json(await transaction(async db=>{
  const row=await readRecord(db,s,kind,uuid.parse(req.params.id),req.user!.id);
  // Read history after closure is allowed, posting is not.
  const messages=(await db.query(`SELECT m.id,m.body,m.sender_id=$2 AS own,m.created_at AS "createdAt",m.reply_to AS "replyTo",
   CASE WHEN $3 OR m.sender_id=$2 OR p.show_name THEN u.name ELSE '' END AS sender
   FROM resident_product_messages m JOIN users u ON u.id=m.sender_id LEFT JOIN resident_profiles p ON p.user_id=u.id
   WHERE m.record_id=$1 ORDER BY m.created_at DESC,m.id DESC LIMIT 100`,[row.id,req.user!.id,s.administrative||kind==='conversations'])).rows.reverse();
  return messages;
 }));
});
residentConversations.post('/records/:kind/:id/messages',async(req,res)=>{
 const s=await residentScope(req),kind=residentKinds.parse(req.params.kind);assertEnabled(s,kind);writable(s);
 if(!['conversations','discussions'].includes(kind))throw new ApiError(405,'method_not_allowed');
 const b=z.object({body:z.string().trim().min(1).max(5000),clientId:uuid,replyTo:uuid.optional()}).strict().parse(req.body);
 res.status(201).json(await transaction(async db=>{
  const row=await readRecord(db,s,kind,uuid.parse(req.params.id),req.user!.id,true);
  if(!actionsFor(row,s,req.user!.id).includes('message'))throw new ApiError(409,'thread_closed');
  if(b.replyTo&&!(await db.query('SELECT id FROM resident_product_messages WHERE id=$1 AND record_id=$2',[b.replyTo,row.id])).rowCount)throw new ApiError(404,'not_found');
  const result=await db.query(`INSERT INTO resident_product_messages(record_id,sender_id,body,client_id,reply_to) VALUES($1,$2,$3,$4,$5)
   ON CONFLICT(sender_id,client_id) DO NOTHING RETURNING id,body,created_at AS "createdAt",reply_to AS "replyTo"`,
   [row.id,req.user!.id,b.body,b.clientId,b.replyTo??null]);
  if(!result.rowCount){
   const prior=(await db.query(`SELECT id,body,record_id,created_at AS "createdAt",reply_to AS "replyTo"
    FROM resident_product_messages WHERE sender_id=$1 AND client_id=$2`,[req.user!.id,b.clientId])).rows[0];
   if(prior.record_id!==row.id||prior.body!==b.body||prior.replyTo!==(b.replyTo??null))throw new ApiError(409,'idempotency_conflict');
   const {record_id:_,...message}=prior;return {...message,own:true,sender:req.user!.name};
  }
  await record(db,req,{...s.c,organization_id:s.organizationId},'resident.message.create','resident_record',row.id,{messageId:result.rows[0].id});
  return {...result.rows[0],own:true,sender:req.user!.name};
 }));
});
