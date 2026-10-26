import {Router} from 'express';
import {z} from 'zod';
import {ApiError,requireAuth} from './access.js';
import {record,transaction} from './operations.js';
import {actionsFor,assertEnabled,publicRecord,readRecord,residentKinds,residentScope,writable} from './resident-policy.js';

export const residentConversations=Router();
residentConversations.use(requireAuth);
const uuid=z.string().uuid();
residentConversations.post('/records/:kind/:id/actions',async(req,res)=>{
 const s=await residentScope(req),kind=residentKinds.parse(req.params.kind);assertEnabled(s,kind);writable(s);
 const b=z.object({action:z.enum(['accept','withdraw','submit','approve','reject','activate','cancel','close','reopen','freeze','support','unsupport','read','save','unsave','report','request','proposal']),
  version:z.number().int().positive(),reason:z.string().trim().max(2000).optional()}).strict().parse(req.body);
 res.json(await transaction(async db=>{
  const row=await readRecord(db,s,kind,uuid.parse(req.params.id),req.user!.id,true);
  if(!actionsFor(row,s,req.user!.id).includes(b.action))throw new ApiError(403,'forbidden');
  if(row.version!==b.version)throw new ApiError(409,'stale_version');
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
    case 'proposal':status=row.status;break; // Agenda proposal is not an ownership vote or official meeting.
    default:throw new ApiError(409,'invalid_transition');
   }
   const data={...row.data,...(b.reason?{decisionReason:b.reason}:{}),
    ...(b.action==='proposal'?{proposalState:'reviewed',reviewedAt:new Date().toISOString()}:{}),
    ...(b.action==='approve'?{approvedAt:new Date().toISOString()}:{}),
   };
   await db.query('UPDATE resident_product_records SET status=$2,data=$3,version=version+1,updated_at=now() WHERE id=$1',[row.id,status,JSON.stringify(data)]);
  }
  await record(db,req,{...s.c,organization_id:s.organizationId},'resident.'+kind+'.'+b.action,'resident_record',row.id,
   {recordVersion:row.version,contextId:s.c.id,...(b.reason?{reason:b.reason}:{}),...(kind==='agreements'?{category:row.data.category,agreementRevision:row.data.agreementRevision??1}:{}),
    ...(b.action==='proposal'?{officialVotingCreated:false}:{})});
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
