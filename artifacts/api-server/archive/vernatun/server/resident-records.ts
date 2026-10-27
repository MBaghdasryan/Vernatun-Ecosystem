import {Router} from 'express';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {pool} from './db.js';
import {ApiError,requireAuth,requirePermission} from './access.js';
import {idempotent,record,transaction} from './operations.js';
import {prepareOperationalRequest,commitPreparedRequest,requestHistoryWithContext} from './core-operation-store.js';
import {activeLeasePredicate} from './lease-policy.js';
import {notifyResidentViewing} from './resident-viewing-notifications.js';
import {actionsFor,adminOnlyKinds,assertEnabled,payloadSchemas,publicRecord,readRecord,residentKinds,residentScope,writable,publishedProposalSql,type ResidentKind} from './resident-policy.js';

export const residentRecords=Router();
residentRecords.use(requireAuth);
const id=z.string().uuid();
const sessionRef=(sid:string)=>createHash('sha256').update(sid).digest('hex');

residentRecords.post('/records/discussions/:id/requests',async(req,res)=>{
 const s=await residentScope(req);assertEnabled(s,'discussions');writable(s);
 const discussionId=id.parse(req.params.id);
 const b=z.object({
  key:id,sourceMessageId:id.optional(),subject:z.string().trim().min(3).max(160),
  description:z.string().trim().max(4000).default(''),categoryId:id.optional()
 }).strict().parse(req.body);
 const snapshot=await transaction(db=>readRecord(db,s,'discussions',discussionId,req.user!.id));
 if(snapshot.status!=='open')throw new ApiError(409,'discussion_closed');
 const unitId=s.unitId??snapshot.unit_id;
 if(!unitId)throw new ApiError(400,'unit_required');
 // Validate the actor and unit before opening the write transaction; request
 // creation must not wait for another pool connection while holding a lock.
 const prepared=await prepareOperationalRequest(req,{
  key:b.key,unitId,subject:b.subject,description:b.description,categoryId:b.categoryId,
  priority:'normal',contactMethod:'app'
 });
 const requestInput={...prepared.b};delete requestInput.key;
 const requestPrepared={...prepared,b:requestInput};
 res.status(201).json(await transaction(async db=>idempotent(db,req,b.key,{...b,discussionId},async()=>{
  const discussion=await readRecord(db,s,'discussions',discussionId,req.user!.id,true);
  if(discussion.status!=='open')throw new ApiError(409,'discussion_closed');
  const source=b.sourceMessageId
   ?(await db.query('SELECT body FROM resident_product_messages WHERE id=$1 AND record_id=$2',[b.sourceMessageId,discussionId])).rows[0]
   :{body:discussion.body};
  if(!source)throw new ApiError(404,'source_message_not_found');
  const sourceText=String(source.body??'').trim();
  if(!sourceText)throw new ApiError(400,'source_text_required');
  if(unitId!==(s.unitId??discussion.unit_id))throw new ApiError(409,'discussion_context_changed');
  const request=await commitPreparedRequest(db,req,requestPrepared,requestHistoryWithContext(prepared.c));
  const inserted=await db.query(`INSERT INTO resident_discussion_lineage
   (organization_id,building_id,discussion_id,source_message_id,source_text,link_type,request_id,created_by)
   VALUES($1,$2,$3,$4,$5,'request',$6,$7) ON CONFLICT(request_id) DO NOTHING RETURNING id`,
   [s.organizationId,s.buildingId,discussionId,b.sourceMessageId??null,sourceText,request.id,req.user!.id]);
  if(!inserted.rowCount){
   const prior=(await db.query('SELECT discussion_id,source_message_id,source_text FROM resident_discussion_lineage WHERE request_id=$1',[request.id])).rows[0];
   if(prior.discussion_id!==discussionId||prior.source_message_id!==(b.sourceMessageId??null)||prior.source_text!==sourceText)throw new ApiError(409,'idempotency_conflict');
  }
  await record(db,req,{...s.c,organization_id:s.organizationId},'resident.discussion.convert_request','resident_record',discussionId,{requestId:request.id,sourceMessageId:b.sourceMessageId??null});
  return {requestId:request.id,discussionId,sourceMessageId:b.sourceMessageId??null,status:request.status};
 })));
});

residentRecords.post('/records/discussions/:id/agenda-proposals',async(req,res)=>{
 const s=await residentScope(req);assertEnabled(s,'discussions');writable(s);
 const discussionId=id.parse(req.params.id);
 const b=z.object({
  key:id,sourceMessageId:id.optional(),title:z.string().trim().min(3).max(200),
  description:z.string().trim().max(4000).default('')
 }).strict().parse(req.body);
 res.status(201).json(await transaction(async db=>idempotent(db,req,b.key,{...b,discussionId},async()=>{
  const discussion=await readRecord(db,s,'discussions',discussionId,req.user!.id,true);
  if(discussion.status!=='open')throw new ApiError(409,'discussion_closed');
  const source=b.sourceMessageId
   ?(await db.query('SELECT body FROM resident_product_messages WHERE id=$1 AND record_id=$2',[b.sourceMessageId,discussionId])).rows[0]
   :{body:discussion.body};
  if(!source)throw new ApiError(404,'source_message_not_found');
  const sourceText=String(source.body??'').trim();
  if(!sourceText)throw new ApiError(400,'source_text_required');
  const proposal=(await db.query(`INSERT INTO resident_agenda_proposals
   (organization_id,building_id,submitted_by,title,description)
   VALUES($1,$2,$3,$4,$5) RETURNING id,status,version,created_at`,
   [s.organizationId,s.buildingId,req.user!.id,b.title,b.description])).rows[0];
  await db.query(`INSERT INTO resident_discussion_lineage
   (organization_id,building_id,discussion_id,source_message_id,source_text,link_type,proposal_id,created_by)
   VALUES($1,$2,$3,$4,$5,'agenda_proposal',$6,$7)`,
   [s.organizationId,s.buildingId,discussionId,b.sourceMessageId??null,sourceText,proposal.id,req.user!.id]);
  await record(db,req,{...s.c,organization_id:s.organizationId},'resident.discussion.agenda_proposal','resident_record',discussionId,{proposalId:proposal.id});
  return {proposalId:proposal.id,status:proposal.status,version:proposal.version,discussionId,sourceMessageId:b.sourceMessageId??null};
 })));
});

residentRecords.get('/records/discussions/:id/lineage',async(req,res)=>{
 const s=await residentScope(req);assertEnabled(s,'discussions');
 const discussionId=id.parse(req.params.id);
 res.json(await transaction(async db=>{
  await readRecord(db,s,'discussions',discussionId,req.user!.id);
  const rows=(await db.query(`SELECT l.id,l.link_type,l.discussion_id,l.source_message_id,LEFT(l.source_text,280) AS source_excerpt,l.request_id,l.proposal_id,
   l.meeting_id,l.created_at,r.subject AS request_subject,r.status AS request_status,w.id AS work_order_id,w.status AS work_order_status,
   p.title AS proposal_title,p.status AS proposal_status,p.decision,m.title AS meeting_title,m.status AS meeting_status,
   COALESCE((SELECT json_agg(v.vote_id ORDER BY v.created_at) FROM resident_discussion_vote_links v
    JOIN meeting_ballots mb ON mb.id=v.vote_id JOIN meeting_eligibility e ON e.id=mb.eligibility_id
    WHERE v.lineage_id=l.id AND ($5 OR mb.owner_id=$4)),'[]') AS vote_ids
   FROM resident_discussion_lineage l
   LEFT JOIN resident_requests r ON r.id=l.request_id
   LEFT JOIN work_orders w ON w.request_id=r.id
   LEFT JOIN resident_agenda_proposals p ON p.id=l.proposal_id
   LEFT JOIN meetings m ON m.id=l.meeting_id
   WHERE l.discussion_id=$1 AND l.organization_id=$2 AND l.building_id=$3
     AND (l.request_id IS NULL OR $5 OR r.author_user_id=$4 OR r.unit_id=$6)
     AND (l.proposal_id IS NULL OR p.submitted_by=$4 OR $7 OR (p.status IN ('included','decided') AND m.was_published))
    ORDER BY l.created_at,l.id`,[discussionId,s.organizationId,s.buildingId,req.user!.id,s.administrative,s.unitId,s.c.permissions.includes('meetings.manage')])).rows;
  return rows.map(r=>({
    id:r.id,linkType:r.link_type,discussionId:r.discussion_id,sourceMessageId:r.source_message_id,sourceExcerpt:r.source_excerpt,
   requestId:r.request_id,requestSubject:r.request_subject??null,requestStatus:r.request_status??null,
   workOrderId:r.work_order_id??null,workOrderStatus:r.work_order_status??null,
   proposalId:r.proposal_id,proposalTitle:r.proposal_title??null,proposalStatus:r.proposal_status??null,
   meetingId:r.meeting_id,meetingTitle:r.meeting_title??null,meetingStatus:r.meeting_status??null,
   voteIds:r.vote_ids??[],decision:r.decision??null,createdAt:r.created_at
  }));
 }));
});

residentRecords.get('/records/:kind',async(req,res)=>{
 const kind=residentKinds.parse(req.params.kind),s=await residentScope(req,kind==='discussions');assertEnabled(s,kind);
 const search=z.string().trim().max(200).parse(req.query.search??'');
 const recordId=req.query.recordId===undefined?null:id.parse(req.query.recordId);
 const offerType=z.enum(['all','sale','rent']).parse(req.query.offerType??'all');
 if(kind==='mobile-devices'){
  const devices=(await pool.query(`SELECT * FROM resident_product_records WHERE kind='mobile-devices'
   AND owner_user_id=$1 AND deleted_at IS NULL AND ($2='' OR strpos(lower(title),lower($2))>0)
   AND ($3::uuid IS NULL OR id=$3)
   ORDER BY updated_at DESC,id LIMIT 101`,[req.user!.id,search,recordId])).rows;
  res.json({items:devices.slice(0,100).map(r=>publicRecord(r,s,req.user!.id)),hasMore:devices.length>100});return;
 }
 if(kind==='directory'){
  // Directory is opt-in, omits identity fields not explicitly made visible,
  // and never exposes expired leases or delegated assignments.
  const rows=(await pool.query(`SELECT DISTINCT u.id,u.name,p.phone,p.show_unit,p.show_phone,p.allow_messages,n.number
   FROM users u JOIN resident_profiles p ON p.user_id=u.id JOIN role_assignments a ON a.user_id=u.id
   JOIN memberships m ON m.user_id=u.id AND m.organization_id=a.organization_id JOIN units n ON n.id=a.unit_id
   WHERE a.organization_id=$1 AND a.building_id=$2 AND a.role_key IN('unit_owner','renter','family')
   AND a.active AND a.starts_at<=now() AND (a.expires_at IS NULL OR a.expires_at>now())
   AND m.active AND NOT u.blocked AND p.show_name AND ${activeLeasePredicate('a')}
   AND NOT EXISTS(SELECT 1 FROM resident_delegations d WHERE d.assignment_id=a.id)
   AND ($3='' OR strpos(lower(u.name),lower($3))>0)
   AND ($4::uuid IS NULL OR u.id=$4) ORDER BY u.name,u.id LIMIT 101`,[s.organizationId,s.buildingId,search,recordId])).rows;
  res.json({items:rows.slice(0,100).map(r=>({id:r.id,kind,title:r.name,body:r.show_unit?r.number:'',status:'active',version:1,createdAt:'',own:r.id===req.user!.id,actions:[],
   data:{phone:r.show_phone?r.phone:undefined,allowMessages:r.allow_messages}})),hasMore:rows.length>100});return;
 }
 const filters=kind==='listings'?z.object({
  saleType:z.enum(['sale','rent']).optional(),currency:z.enum(['AMD','RUB','USD']).optional(),
  minPrice:z.string().regex(/^\d{1,14}$/).optional(),maxPrice:z.string().regex(/^\d{1,14}$/).optional(),
  rooms:z.coerce.number().int().min(0).max(100).optional(),
 }).parse(req.query):{};
 if((filters.minPrice||filters.maxPrice)&&!filters.currency)throw new ApiError(400,'currency_required');
 if(filters.minPrice&&filters.maxPrice&&BigInt(filters.minPrice)>BigInt(filters.maxPrice))throw new ApiError(400,'validation_error');
 const rows=(await pool.query(`SELECT r.*,${publishedProposalSql},
  ARRAY(SELECT p.id FROM resident_listing_photos p WHERE p.listing_id=r.id ORDER BY p.created_at,p.id) AS photos,
  EXISTS(SELECT 1 FROM resident_record_marks m WHERE m.record_id=r.id AND m.user_id=$6 AND m.mark='accepted')
   AND NOT EXISTS(SELECT 1 FROM resident_record_marks m WHERE m.record_id=r.id AND m.user_id=$6 AND m.mark='withdrawn') AS accepted,
  EXISTS(SELECT 1 FROM resident_record_marks m WHERE m.record_id=r.id AND m.user_id=$6 AND m.mark='saved') AS saved,
  EXISTS(SELECT 1 FROM resident_record_marks m WHERE m.record_id=r.id AND m.user_id=$6 AND m.mark='supported') AS supported,
  (SELECT count(*) FROM resident_record_marks m WHERE m.record_id=r.id AND m.mark='supported') AS support_count
  FROM resident_product_records r WHERE organization_id=$1 AND building_id=$2 AND kind=$3 AND deleted_at IS NULL
  AND ($4 OR (r.owner_user_id=$6 AND (r.unit_id IS NULL OR r.unit_id=$5)) OR
   (r.kind='conversations' AND EXISTS(SELECT 1 FROM resident_product_records p WHERE p.id=r.parent_id
     AND p.kind='listings' AND p.owner_user_id=$6 AND p.unit_id=$5 AND p.deleted_at IS NULL)) OR
   (r.kind IN('contacts','agreements','services','help') AND r.status='active') OR
   (r.kind='discussions' AND r.status IN('open','closed','frozen')) OR (r.kind='listings' AND r.status='active'))
  AND ($7='' OR strpos(lower(r.title||' '||r.body),lower($7))>0)
  AND (r.kind<>'help' OR $4 OR r.data->>'category'=$8)
  AND (r.kind<>'conversations' OR r.parent_id IS NULL OR $4 OR $9)
  AND ($10::text IS NULL OR r.data->>'saleType'=$10)
  AND ($11::text IS NULL OR r.data->>'currency'=$11)
  AND ($12::numeric IS NULL OR (r.data->>'priceMinor')::numeric >= $12)
  AND ($13::numeric IS NULL OR (r.data->>'priceMinor')::numeric <= $13)
  AND ($14::text IS NULL OR r.data->>'rooms'=$14)
  AND ($15::uuid IS NULL OR r.id=$15)
  AND ($16='all' OR (r.kind='listings' AND r.data->>'saleType'=$16))
  ORDER BY created_at DESC,id LIMIT 101`,[s.organizationId,s.buildingId,kind,s.administrative,s.unitId,req.user!.id,search,req.user!.locale,
   s.settings.marketplace,filters.saleType??null,filters.currency??null,filters.minPrice??null,filters.maxPrice??null,filters.rooms?.toString()??null,recordId,offerType])).rows;
 res.json({items:rows.slice(0,100).map(r=>publicRecord(r,s,req.user!.id)),hasMore:rows.length>100});
});

residentRecords.get('/records/:kind/:id',async(req,res)=>{
 const s=await residentScope(req),kind=residentKinds.parse(req.params.kind);assertEnabled(s,kind);
 res.json(await transaction(async db=>publicRecord(await readRecord(db,s,kind,id.parse(req.params.id),req.user!.id),s,req.user!.id)));
});

residentRecords.post('/records/:kind',async(req,res)=>{
 const s=await residentScope(req),kind=residentKinds.parse(req.params.kind);assertEnabled(s,kind);writable(s);
 if(kind==='directory')throw new ApiError(405,'method_not_allowed');
 if(adminOnlyKinds.includes(kind)!==s.administrative)throw new ApiError(403,'forbidden');
 if(kind==='listings'&&s.c.role_key!=='unit_owner')throw new ApiError(403,'forbidden');
 const input=payloadSchemas[kind].parse(req.body),{title,body,version:_,...data}=input;
 if('mandatory' in data&&'withdrawable' in data&&data.mandatory&&data.withdrawable)throw new ApiError(400,'validation_error');
 const created=await transaction(async db=>{
  let parentId='parentId' in data?data.parentId:null,listingOwnerId:string|null=null;
  if(kind==='subscriptions'){
   const service=await readRecord(db,s,'services',parentId!,req.user!.id,true);
   if(service.status!=='active')throw new ApiError(409,'invalid_transition');
   // Snapshot an approved catalog price; never trust a client amount.
   Object.assign(data,{priceMinor:service.data.priceMinor,currency:service.data.currency,serviceTitle:service.title});
  }
  if(kind==='conversations'&&parentId){
   assertEnabled(s,'listings');
   const listing=await readRecord(db,s,'listings',parentId,req.user!.id,true);
   if(listing.status!=='active')throw new ApiError(409,'invalid_transition');
   if(listing.owner_user_id===req.user!.id)throw new ApiError(400,'validation_error');
   listingOwnerId=listing.owner_user_id;
   if('viewingAt' in data&&data.viewingAt){
    if(!('viewingConsent' in data)||data.viewingConsent!==true)throw new ApiError(400,'consent_required');
    const at=Date.parse(data.viewingAt);
    if(at<=Date.now()||at>Date.now()+366*86400000)throw new ApiError(400,'invalid_viewing_time');
    Object.assign(data,{viewingAt:new Date(at).toISOString(),viewingStatus:'requested'});
   }
  }
  if(kind==='conversations'&&'viewingAt' in data&&data.viewingAt&&!parentId)throw new ApiError(400,'validation_error');
  if(kind==='mobile-devices'){
   await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`resident-installation:${req.user!.id}:${'installationId' in data?data.installationId:''}`]);
   const prior=(await db.query(`SELECT * FROM resident_product_records WHERE owner_user_id=$1 AND kind=$2
    AND data->>'installationId'=$3 AND deleted_at IS NULL AND status='active' FOR UPDATE`,
    [req.user!.id,kind,'installationId' in data?data.installationId:''])).rows[0];
   if(prior){
    // A physical installation belongs to the user, not the selected apartment.
    // Context switches never clone it or widen the device session's permissions.
    const updated=(await db.query(`UPDATE resident_product_records SET data=$2,title=$3,body=$4,session_ref=$5,
     version=version+1,updated_at=now() WHERE id=$1 RETURNING *`,
     [prior.id,JSON.stringify(data),title,body,sessionRef(req.sessionID)])).rows[0];
    await record(db,req,s.c,'resident.mobile-devices.register','resident_record',prior.id);return updated;
   }
  }
  const status=kind==='listings'?'draft':kind==='subscriptions'?'requested':['discussions','conversations','feedback'].includes(kind)?'open':'active';
  const row=(await db.query(`INSERT INTO resident_product_records(organization_id,building_id,unit_id,kind,owner_user_id,title,body,data,status,parent_id,session_ref)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,[s.organizationId,s.buildingId,s.unitId,kind,req.user!.id,title,body,JSON.stringify(data),status,parentId,
   kind==='mobile-devices'?sessionRef(req.sessionID):null])).rows[0];
  if(kind==='conversations'&&'viewingAt' in data&&data.viewingAt&&listingOwnerId){
   await notifyResidentViewing(db,listingOwnerId,s.organizationId,row.id,'viewing_requested');
  }
  await record(db,req,{...s.c,organization_id:s.organizationId},'resident.'+kind+'.create','resident_record',row.id);return row;
 });
 res.status(201).json(publicRecord(created,s,req.user!.id));
});

residentRecords.patch('/records/:kind/:id',async(req,res)=>{
 const s=await residentScope(req),kind=residentKinds.parse(req.params.kind);assertEnabled(s,kind);writable(s);
 if(kind==='directory')throw new ApiError(405,'method_not_allowed');
 const input=payloadSchemas[kind].parse(req.body);
 res.json(await transaction(async db=>{
  const row=await readRecord(db,s,kind,id.parse(req.params.id),req.user!.id,true);
  if(!actionsFor(row,s,req.user!.id).includes('edit'))throw new ApiError(403,'forbidden');
  if(row.version!==input.version)throw new ApiError(409,'stale_version');
  const {title,body,version:_,...data}=input;
  if(kind==='agreements'){
   if('mandatory' in data&&'withdrawable' in data&&data.mandatory&&data.withdrawable)throw new ApiError(400,'validation_error');
   await db.query("UPDATE resident_product_records SET status='superseded',version=version+1,updated_at=now() WHERE id=$1",[row.id]);
   const next=(await db.query(`INSERT INTO resident_product_records(organization_id,building_id,kind,owner_user_id,title,body,data,status,parent_id)
    VALUES($1,$2,'agreements',$3,$4,$5,$6,'active',$7) RETURNING *`,[s.organizationId,s.buildingId,req.user!.id,title,body,
    JSON.stringify({...data,agreementRevision:(row.data.agreementRevision??1)+1}),row.id])).rows[0];
   await record(db,req,{...s.c,organization_id:s.organizationId},'resident.agreement.version','resident_record',next.id,{previousId:row.id});
   return publicRecord(next,s,req.user!.id);
  }
  const next=(await db.query('UPDATE resident_product_records SET title=$2,body=$3,data=$4,version=version+1,updated_at=now() WHERE id=$1 RETURNING *',
   [row.id,title,body,JSON.stringify(data)])).rows[0];
  await record(db,req,{...s.c,organization_id:s.organizationId},'resident.'+kind+'.update','resident_record',row.id);
  return publicRecord(next,s,req.user!.id);
 }));
});

residentRecords.delete('/records/:kind/:id',async(req,res)=>{
 const s=await residentScope(req),kind=residentKinds.parse(req.params.kind);assertEnabled(s,kind);writable(s);
 const version=z.coerce.number().int().positive().parse(req.query.version);let currentRevoked=false;
 await transaction(async db=>{
  const row=await readRecord(db,s,kind,id.parse(req.params.id),req.user!.id,true);
  if(!actionsFor(row,s,req.user!.id).includes('delete'))throw new ApiError(403,'forbidden');
  if(row.version!==version)throw new ApiError(409,'stale_version');
  await db.query("UPDATE resident_product_records SET status='revoked',deleted_at=now(),version=version+1,updated_at=now() WHERE id=$1",[row.id]);
  if(kind==='mobile-devices'&&row.session_ref){
   // Tombstone survives late session saves, as in the operations session guard.
   const sessions=await db.query(`SELECT sid,expire FROM session WHERE sess->'passport'->>'user'=$1
    AND encode(sha256(convert_to(sid,'UTF8')),'hex')=$2 FOR UPDATE`,[req.user!.id,row.session_ref]);
   for(const sess of sessions.rows){
    await db.query('INSERT INTO system_revoked_sessions(ref,expires_at) VALUES($1,$2) ON CONFLICT DO NOTHING',[row.session_ref,sess.expire]);
    await db.query('DELETE FROM session WHERE sid=$1',[sess.sid]);if(sess.sid===req.sessionID)currentRevoked=true;
   }
  }
  await record(db,req,{...s.c,organization_id:s.organizationId},'resident.'+kind+'.revoke','resident_record',row.id);
 });
 if(currentRevoked){await new Promise<void>((resolve,reject)=>req.session.destroy(err=>err?reject(err):resolve()));res.clearCookie('vernatun.sid')}
 res.status(204).end();
});
