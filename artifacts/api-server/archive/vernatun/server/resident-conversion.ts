import type {Request} from 'express';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import {ApiError,requirePermission} from './access.js';
import {record} from './operations.js';
import {type ResidentScope} from './resident-policy.js';
import {subscriptionPolicy} from './subscription-policy.js';

export const conversionInput=z.object({
 confirmed:z.literal(true),categoryId:z.string().uuid().optional(),
 meetingId:z.string().uuid().optional(),meetingVersion:z.number().int().positive().optional(),
 passBasisPoints:z.number().int().min(1).max(10000).optional(),
}).strict();
export function canConvert(s:ResidentScope,action:'request'|'proposal'){
 return s.administrative&&!s.c.unit_id&&s.c.organization_id===s.organizationId&&
  s.settings.discussions&&s.c.modules?.includes('community')&&
  s.c.modules.includes(action==='request'?'requests':'community')&&
  s.c.permissions.includes(action==='request'?'requests.assign':'meetings.manage')&&
  s.c.permissions.includes(action==='request'?'requests.read':'meetings.read');
}
export async function authorizeConversion(req:Request,s:ResidentScope,action:'request'|'proposal'){
 if(!canConvert(s,action))throw new ApiError(403,'forbidden');
 await requirePermission(req,action==='request'?'requests.assign':'meetings.manage');
 await requirePermission(req,action==='request'?'requests.read':'meetings.read');
}
export async function convertDiscussion(db:PoolClient,req:Request,s:ResidentScope,row:any,action:'request'|'proposal',input:unknown,version:number){
 if(row.kind!=='discussions'||!canConvert(s,action))throw new ApiError(403,'forbidden');
 // Recheck mutable policy using the existing connection, including on replay.
 const policyNow=await subscriptionPolicy(s.organizationId,db);
 if(policyNow.readOnly)throw new ApiError(403,'subscription_read_only');
 if(!policyNow.modules.includes('community')||(action==='request'&&!policyNow.modules.includes('requests')))throw new ApiError(403,'module_disabled');
 const settings=(await db.query('SELECT discussions FROM resident_building_settings WHERE building_id=$1 AND organization_id=$2 FOR SHARE',[s.buildingId,s.organizationId])).rows[0];
 if(!settings?.discussions)throw new ApiError(403,'module_disabled');
 const b=conversionInput.parse(input);
 // The discussion row is locked by the caller. Replays still recheck live access,
 // but do not create another object or another audit event.
 const prior=action==='request'?row.data.requestConversion:row.data.proposalConversion;
 if(prior){
  if(Object.keys(b).length!==Object.keys(prior.input).length||
   Object.entries(b).some(([k,v])=>prior.input[k]!==v))throw new ApiError(409,'idempotency_conflict');
  return;
 }
 if(row.version!==version)throw new ApiError(409,'stale_version');
 if(row.status!=='open')throw new ApiError(409,'thread_closed');
 let target:any;
 if(action==='request'){
  if(!b.categoryId||b.meetingId||b.meetingVersion||b.passBasisPoints)throw new ApiError(400,'invalid_conversion');
  if(!(await db.query('SELECT id FROM request_categories WHERE id=$1 AND organization_id=$2 AND active FOR SHARE',[b.categoryId,s.organizationId])).rowCount)throw new ApiError(404,'category_not_available');
  const policy=(await db.query(`SELECT * FROM sla_policies WHERE organization_id=$1 AND priority='normal'
   AND (category_id=$2 OR category_id IS NULL) ORDER BY category_id NULLS LAST LIMIT 1`,[s.organizationId,b.categoryId])).rows[0];
  if(!policy)throw new ApiError(409,'sla_policy_missing');
  target=(await db.query(`INSERT INTO resident_requests(organization_id,building_id,unit_id,author_user_id,subject,description,
   source,source_discussion_id,category_id,priority,contact_method,sla_snapshot)
   VALUES($1,$2,NULL,NULL,$3,$4,'system',$5,$6,'normal','none',$7) RETURNING *`,
   [s.organizationId,s.buildingId,row.title,row.body,row.id,b.categoryId,JSON.stringify(policy)])).rows[0];
  await db.query("INSERT INTO work_orders(request_id,status,checklist) VALUES($1,'queued','[]')",[target.id]);
  for(const kind of ['response','assignment','arrival','resolution'])await db.query(`INSERT INTO request_sla_deadlines(request_id,kind,due_at)
   VALUES($1,$2,$3::timestamptz+($4::integer*interval '1 minute'))`,[target.id,kind,target.created_at,policy[kind+'_minutes']]);
  await db.query(`INSERT INTO request_history(request_id,actor_id,actor_role,action,from_status,to_status,note)
   VALUES($1,$2,$3,'discussion.convert','new','queued',$4)`,[target.id,req.user!.id,s.c.role_key,row.id]);
  await db.query('UPDATE resident_product_records SET linked_request_id=$2 WHERE id=$1',[row.id,target.id]);
 }else{
  if(!b.meetingId||!b.meetingVersion||!b.passBasisPoints||b.categoryId||row.title.length<2)throw new ApiError(400,'invalid_conversion');
  const meeting=(await db.query(`SELECT * FROM meetings WHERE id=$1 AND organization_id=$2 AND building_id=$3
   AND mode='weighted' FOR UPDATE`,[b.meetingId,s.organizationId,s.buildingId])).rows[0];
  if(!meeting)throw new ApiError(404,'not_found');
  if(meeting.status!=='draft')throw new ApiError(409,'meeting_not_draft');
  if(meeting.version!==b.meetingVersion)throw new ApiError(409,'stale_version');
  if(((await db.query('SELECT id FROM agenda_items WHERE meeting_id=$1',[meeting.id])).rowCount??0)>=20)throw new ApiError(409,'agenda_limit');
  // A managed draft agenda item, not a ballot. Existing publish is the only
  // operation that snapshots owner eligibility and opens official voting.
  target=(await db.query(`INSERT INTO agenda_items(meeting_id,title,voting_type,options,pass_option,pass_basis_points,source_discussion_id)
   VALUES($1,$2,'yes_no','["yes","no","abstain"]','yes',$3,$4) RETURNING *`,[meeting.id,row.title,b.passBasisPoints,row.id])).rows[0];
  await db.query('UPDATE meetings SET version=version+1 WHERE id=$1',[meeting.id]);
 }
 const receipt={id:target.id,input:b,...(action==='proposal'?{meetingId:b.meetingId}:{})};
 await db.query(`UPDATE resident_product_records SET data=data||$2::jsonb,version=version+1,updated_at=now() WHERE id=$1`,
  [row.id,JSON.stringify({[action==='request'?'requestConversion':'proposalConversion']:receipt})]);
 await record(db,req,s.c,'resident.discussions.'+action,'resident_record',row.id,
  {targetId:target.id,targetType:action==='request'?'resident_request':'agenda_item',meetingId:b.meetingId,officialVotingCreated:false,recordVersion:row.version});
 await record(db,req,s.c,action==='request'?'request.discussion.create':'meeting.agenda.discussion',''+(action==='request'?'resident_request':'agenda_item'),target.id,{discussionId:row.id,meetingId:b.meetingId});
}
