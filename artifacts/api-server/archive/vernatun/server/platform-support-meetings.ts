import {Router} from 'express';
import {z} from 'zod';
import {pool} from './db.js';
import {context,requireAuth,requirePermission,ApiError} from './access.js';
import {transaction,idempotent,record} from './operations.js';
import {globalAdmin,globalQueueLead,uuid} from './platform-ops-shared.js';

export const platformSupportMeetings=Router();
platformSupportMeetings.use(requireAuth);

const instant=z.string().datetime({offset:true});
const base=z.object({key:uuid,version:z.number().int().positive()});
const change=z.discriminatedUnion('action',[
 base.extend({action:z.literal('edit'),title:z.string().trim().min(2).max(200).optional(),
  organizationId:uuid.nullable().optional(),startsAt:instant.optional(),endsAt:instant.optional(),
  timezone:z.string().trim().min(1).max(100).optional(),location:z.string().max(500).optional(),
  notes:z.string().max(8000).optional()}).strict(),
 base.extend({action:z.literal('confirm')}).strict(),
 base.extend({action:z.literal('cancel')}).strict(),
 base.extend({action:z.literal('complete')}).strict()
]);
const create=z.object({key:uuid,title:z.string().trim().min(2).max(200),
 organizationId:uuid.nullable().optional(),startsAt:instant,endsAt:instant,
 timezone:z.string().trim().min(1).max(100),location:z.string().max(500).default(''),
 notes:z.string().max(8000).default('')}).strict();

function validateTime(start:string,end:string,allowPast=false){
 const a=Date.parse(start),b=Date.parse(end),now=Date.now();
 if(!Number.isFinite(a)||!Number.isFinite(b)||b<=a||b-a>12*60*60_000)throw new ApiError(400,'invalid_meeting_time');
 if(!allowPast&&a<now+5*60_000)throw new ApiError(400,'meeting_must_be_future');
 if(a>now+180*24*60*60_000)throw new ApiError(400,'meeting_too_far_ahead');
}
function validateZone(zone:string){
 try{new Intl.DateTimeFormat('en',{timeZone:zone}).format();}catch{throw new ApiError(400,'invalid_timezone')}
}
async function authorized(req:any){
 const c=await requirePermission(req,'onboarding.manage');
 if(c.organization_id)throw new ApiError(403,'forbidden');
 return {c,manager:globalAdmin(c)||globalQueueLead(c),user:req.user!.id as string};
}
function writable(c:any,manager:boolean,user:string,row:any){
 if(!manager&&row.created_by!==user)throw new ApiError(404,'not_found');
}
async function validateOrganization(organizationId:string|null|undefined){
 if(organizationId&&(await pool.query('SELECT 1 FROM organizations WHERE id=$1',[organizationId])).rowCount!==1)throw new ApiError(404,'not_found');
}
async function event(db:any,id:string,actor:string,action:string,details:unknown){
 await db.query('INSERT INTO platform_support_meeting_events(meeting_id,actor_id,action,details) VALUES($1,$2,$3,$4)',
  [id,actor,action,JSON.stringify(details)]);
}
function eventFields(input:any){
 return Object.keys(input).filter(k=>!['key','version','notes','location'].includes(k));
}
async function noConflict(db:any,organizer:string,start:string,end:string,exclude?:string){
 await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`platform-support-meetings:${organizer}`]);
 const conflict=await db.query(`SELECT id FROM platform_support_meetings
  WHERE created_by=$1 AND status IN ('scheduled','confirmed')
   AND starts_at<$3::timestamptz AND ends_at>$2::timestamptz AND ($4::uuid IS NULL OR id<>$4)
  LIMIT 1`,[organizer,start,end,exclude??null]);
 if(conflict.rowCount)throw new ApiError(409,'meeting_schedule_conflict');
}

platformSupportMeetings.get('/platform/implementation-meetings',async(req,res)=>{
 const {manager,user}=await authorized(req);
 const from=req.query.from===undefined?new Date(Date.now()-30*24*60*60_000).toISOString():instant.parse(req.query.from);
 const to=req.query.to===undefined?new Date(Date.now()+180*24*60*60_000).toISOString():instant.parse(req.query.to);
 if(from&&to&&Date.parse(to)-Date.parse(from)>366*24*60*60_000)throw new ApiError(400,'date_range_too_large');
 if(from&&to&&Date.parse(to)<=Date.parse(from))throw new ApiError(400,'invalid_date_range');
 const rows=await pool.query(`SELECT m.*,o.name AS organization_name,u.name AS organizer_name
  FROM platform_support_meetings m LEFT JOIN organizations o ON o.id=m.organization_id
  JOIN users u ON u.id=m.created_by
  WHERE ($1::boolean OR m.created_by=$2) AND ($3::timestamptz IS NULL OR m.starts_at>=$3)
    AND ($4::timestamptz IS NULL OR m.starts_at<$4)
  ORDER BY m.starts_at,m.id LIMIT 501`,[manager,user,from??null,to??null]);
 res.setHeader('Cache-Control','private, no-store');
 res.json({meetings:rows.rows.slice(0,500),hasMore:rows.rows.length>500});
});

platformSupportMeetings.post('/platform/implementation-meetings',async(req,res)=>{
 const {c,user}=await authorized(req),b=create.parse(req.body);
 validateTime(b.startsAt,b.endsAt);validateZone(b.timezone);
 if(b.organizationId)await validateOrganization(b.organizationId);
 const result=await transaction(async db=>idempotent(db,req,b.key,b,async()=>{
  await noConflict(db,user,b.startsAt,b.endsAt);
  const meeting=(await db.query(`INSERT INTO platform_support_meetings
   (organization_id,title,starts_at,ends_at,timezone,location,notes,created_by,updated_by)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING *`,
  [b.organizationId??null,b.title,b.startsAt,b.endsAt,b.timezone,b.location,b.notes,user])).rows[0];
  await event(db,meeting.id,user,'created',{organizationId:meeting.organization_id,startsAt:meeting.starts_at,endsAt:meeting.ends_at});
  await record(db,req,c,'support_meeting.create','platform_support_meeting',meeting.id,{organizationId:meeting.organization_id});
  return meeting;
 }));
 res.status(201).json(result);
});

platformSupportMeetings.post('/platform/implementation-meetings/:id/change',async(req,res)=>{
 const {c,manager,user}=await authorized(req),id=uuid.parse(req.params.id),b=change.parse(req.body);
 const out=await transaction(async db=>{
  const current=(await db.query('SELECT * FROM platform_support_meetings WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(!current)throw new ApiError(404,'not_found');
  writable(c,manager,user,current);
  return idempotent(db,req,b.key,b,async()=>{
   if(current.version!==b.version)throw new ApiError(409,'stale_version');
   let nextStatus=current.status;
   const next={
    organizationId:b.action==='edit'&&b.organizationId!==undefined?b.organizationId:current.organization_id,
    title:b.action==='edit'?(b.title??current.title):current.title,
    startsAt:b.action==='edit'?(b.startsAt??current.starts_at.toISOString()):current.starts_at.toISOString(),
    endsAt:b.action==='edit'?(b.endsAt??current.ends_at.toISOString()):current.ends_at.toISOString(),
    timezone:b.action==='edit'?(b.timezone??current.timezone):current.timezone,
    location:b.action==='edit'?(b.location??current.location):current.location,
    notes:b.action==='edit'?(b.notes??current.notes):current.notes
   };
   if(b.action==='edit'){
    if(!['scheduled','confirmed'].includes(current.status))throw new ApiError(409,'meeting_not_editable');
    validateTime(next.startsAt,next.endsAt);validateZone(next.timezone);
    if(next.organizationId)await validateOrganization(next.organizationId);
    await noConflict(db,current.created_by,next.startsAt,next.endsAt,id);
   }else if(b.action==='confirm'){
    if(current.status!=='scheduled'||Date.parse(next.startsAt)<=Date.now())throw new ApiError(409,'invalid_meeting_transition');
    nextStatus='confirmed';
   }else if(b.action==='cancel'){
    if(!['scheduled','confirmed'].includes(current.status))throw new ApiError(409,'invalid_meeting_transition');
    nextStatus='cancelled';
   }else{
    if(current.status!=='confirmed'||Date.parse(next.endsAt)>Date.now())throw new ApiError(409,'meeting_not_ended');
    nextStatus='completed';
   }
   const updated=(await db.query(`UPDATE platform_support_meetings SET organization_id=$2,title=$3,starts_at=$4,
    ends_at=$5,timezone=$6,location=$7,notes=$8,status=$9,version=version+1,updated_by=$10,updated_at=now()
    WHERE id=$1 RETURNING *`,[id,next.organizationId,next.title,next.startsAt,next.endsAt,next.timezone,
    next.location,next.notes,nextStatus,user])).rows[0];
   const action=b.action==='edit'?'edited':b.action==='confirm'?'confirmed':b.action==='cancel'?'cancelled':'completed';
   await event(db,id,user,action,{fields:eventFields(b),before:{status:current.status,startsAt:current.starts_at,endsAt:current.ends_at},
    after:{status:updated.status,startsAt:updated.starts_at,endsAt:updated.ends_at}});
  await record(db,req,c,`support_meeting.${action}`,
    'platform_support_meeting',id,{fields:eventFields(b),status:updated.status});
   return updated;
  });
 });
 res.json(out);
});
