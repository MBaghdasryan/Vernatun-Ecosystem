import {Router} from 'express';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {pool} from './db.js';
import {requireAuth,requirePermission,ApiError,type Context} from './access.js';
import {transaction,idempotent,record} from './operations.js';
import {uuid,version} from './finance-shared.js';
import {readableDocument} from './documents.js';
import {savePrivateFile,privateFileLockKey} from './private-files.js';
import {meetingResult,protocolPdf} from './meeting-results.js';
export const governance=Router();governance.use(requireAuth);
const agendaInput=z.object({title:z.string().trim().min(2).max(200),votingType:z.enum(['yes_no','single_choice']),options:z.array(z.string().trim().min(1).max(100)).min(2).max(10),passOption:z.string(),passBasisPoints:z.number().int().min(1).max(10000)}).strict().refine(a=>new Set(a.options).size===a.options.length&&a.options.includes(a.passOption)&&
 (a.votingType!=='yes_no'||(a.options.length===3&&['yes','no','abstain'].every(x=>a.options.includes(x)))));
async function locked(db:PoolClient,c:Context,id:string){
 const m=(await db.query(`SELECT m.* FROM meetings m WHERE m.id=$1 AND m.organization_id=$2 AND m.mode='weighted'
 AND ($3::uuid IS NULL OR m.building_id=$3) FOR UPDATE`,[id,c.organization_id,c.building_id])).rows[0];
 if(!m)throw new ApiError(404,'not_found');return m;
}
function phase(m:any){return m.status!=='published'?m.status:new Date(m.starts_at).getTime()>Date.now()?'scheduled':new Date(m.ends_at).getTime()<=Date.now()?'ended':'open'}
governance.get('/governance/settings',async(req,res)=>{
 const c=await requirePermission(req,'meetings.read');
 const r=(await pool.query('SELECT timezone FROM organizations WHERE id=$1',[c.organization_id])).rows[0];if(!r)throw new ApiError(404,'not_found');res.json(r);
});
governance.get('/governance/meetings',async(req,res)=>{
 const c=await requirePermission(req,'meetings.read'),manage=c.permissions.includes('meetings.manage');
 res.json((await pool.query(`SELECT m.*,b.name AS building_name FROM meetings m JOIN buildings b ON b.id=m.building_id
 WHERE m.organization_id=$1 AND ($2::uuid IS NULL OR m.building_id=$2) AND m.mode='weighted'
 AND ($3 OR m.status<>'draft') ORDER BY m.starts_at DESC`,[c.organization_id,c.building_id,manage])).rows.map(m=>({...m,voting_phase:phase(m)})));
});
governance.get('/governance/meetings/:id',async(req,res)=>{
 const c=await requirePermission(req,'meetings.read'),id=uuid.parse(req.params.id);
 res.json(await transaction(async db=>{
 const m=await locked(db,c,id);if(m.status==='draft'&&!c.permissions.includes('meetings.manage'))throw new ApiError(404,'not_found');
 const eligibility=(await db.query(`SELECT e.*,u.number,p.name AS owner_name FROM meeting_eligibility e JOIN units u ON u.id=e.unit_id JOIN users p ON p.id=e.owner_id
 WHERE e.meeting_id=$1 AND ($2 OR (e.owner_id=$3 AND e.unit_id=$4)) ORDER BY u.number`,[id,c.permissions.includes('meetings.manage'),req.user!.id,c.unit_id])).rows;
 const agenda=(await db.query(`SELECT a.*,COALESCE((SELECT json_agg(v ORDER BY v.created_at) FROM meeting_ballots v JOIN meeting_eligibility e ON e.id=v.eligibility_id
 WHERE v.agenda_item_id=a.id AND ($2 OR v.owner_id=$3)),'[]') AS my_votes FROM agenda_items a WHERE meeting_id=$1 ORDER BY id`,[id,c.permissions.includes('meetings.manage'),req.user!.id])).rows;
 const documents=c.permissions.includes('documents.read')?(await db.query(`SELECT md.version_id,d.id AS document_id,v.title,v.version_number,v.media_type
 FROM meeting_documents md JOIN document_versions v ON v.id=md.version_id JOIN documents d ON d.id=v.document_id
 WHERE md.meeting_id=$1 AND ($2 OR ((d.visibility='residents' AND v.visibility='residents' AND $3)
 OR (d.visibility='unit_owner' AND v.visibility='unit_owner' AND d.unit_id=$4 AND $5)))
 AND ($4::uuid IS NULL OR d.unit_id IS NULL OR d.unit_id=$4)`,[id,c.permissions.includes('documents.manage'),!!c.unit_id,c.unit_id,c.role_key==='unit_owner'])).rows:[];
 const stored=(await db.query('SELECT result FROM meeting_results WHERE meeting_id=$1',[id])).rows[0];
 return {...m,voting_phase:phase(m),eligibility,agenda,documents,result:stored?.result??await meetingResult(db,m)};
 }));
});
governance.post('/governance/meetings',async(req,res)=>{
 const c=await requirePermission(req,'meetings.manage');if(c.unit_id)throw new ApiError(403,'forbidden');
 const b=z.object({key:uuid,buildingId:uuid,title:z.string().trim().min(2).max(200),description:z.string().max(8000),startsAt:z.string().datetime(),endsAt:z.string().datetime(),quorumBasisPoints:z.number().int().min(1).max(10000),documentIds:z.array(uuid).max(20).default([]),agenda:z.array(agendaInput).min(1).max(20)}).strict().parse(req.body);
 if(b.endsAt<=b.startsAt||new Date(b.endsAt).getTime()<=Date.now())throw new ApiError(400,'invalid_dates');
 const versions:string[]=[];for(const id of b.documentIds){const d=(await readableDocument(req,id))[0];if(d.building_id!==b.buildingId)throw new ApiError(400,'invalid_reference');versions.push(d.latest_version_id)}
 res.status(201).json(await transaction(db=>idempotent(db,req,b.key,b,async()=>{
 if(!(await db.query('SELECT id FROM buildings WHERE id=$1 AND organization_id=$2 AND ($3::uuid IS NULL OR id=$3) FOR SHARE',[b.buildingId,c.organization_id,c.building_id])).rowCount)throw new ApiError(404,'not_found');
 const m=(await db.query(`INSERT INTO meetings(organization_id,building_id,title,description,starts_at,ends_at,quorum_basis_points,created_by,mode)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,'weighted') RETURNING *`,[c.organization_id,b.buildingId,b.title,b.description,b.startsAt,b.endsAt,b.quorumBasisPoints,req.user!.id])).rows[0];
 for(const a of b.agenda)await db.query('INSERT INTO agenda_items(meeting_id,title,voting_type,options,pass_option,pass_basis_points) VALUES($1,$2,$3,$4,$5,$6)',[m.id,a.title,a.votingType,JSON.stringify(a.options),a.passOption,a.passBasisPoints]);
 for(const v of new Set(versions))await db.query('INSERT INTO meeting_documents(meeting_id,version_id) VALUES($1,$2)',[m.id,v]);
 await record(db,req,c,'meeting.draft','meeting',m.id);return m;
 })));
});
governance.post('/governance/meetings/:id/actions',async(req,res)=>{
 const c=await requirePermission(req,'meetings.manage'),id=uuid.parse(req.params.id);
 const b=z.object({key:uuid,version,action:z.enum(['publish','cancel','finalize']),reason:z.string().trim().max(1000).default('')}).strict().parse(req.body);
 res.json(await transaction(db=>idempotent(db,req,b.key,b,async()=>{
 const m=await locked(db,c,id);if(m.version!==b.version)throw new ApiError(409,'stale_version');
 if(b.action==='publish'){
 if(m.status!=='draft'||new Date(m.ends_at).getTime()<=Date.now())throw new ApiError(409,'invalid_transition');
 await db.query('SELECT id FROM units WHERE building_id=$1 ORDER BY id FOR UPDATE',[m.building_id]);
 const rows=(await db.query(`SELECT o.* FROM ownerships o JOIN units u ON u.id=o.unit_id JOIN users p ON p.id=o.user_id JOIN memberships ms ON ms.user_id=p.id AND ms.organization_id=o.organization_id
 WHERE u.building_id=$1 AND o.organization_id=$2 AND ms.active AND NOT p.blocked
 AND o.starts_on<=($3::timestamptz AT TIME ZONE (SELECT timezone FROM organizations WHERE id=$2))::date
 AND (o.ends_on IS NULL OR o.ends_on>=($3::timestamptz AT TIME ZONE (SELECT timezone FROM organizations WHERE id=$2))::date)
 ORDER BY o.id`,[m.building_id,c.organization_id,m.starts_at])).rows;
 if(!rows.length)throw new ApiError(409,'no_eligible_owners');
 const totals=new Map<string,number>();for(const o of rows){totals.set(o.unit_id,(totals.get(o.unit_id)??0)+o.share_basis_points);if((totals.get(o.unit_id)??0)>10000)throw new ApiError(409,'ownership_share_overflow')}
 for(const o of rows)await db.query('INSERT INTO meeting_eligibility(meeting_id,ownership_id,unit_id,owner_id,share_basis_points) VALUES($1,$2,$3,$4,$5)',[id,o.id,o.unit_id,o.user_id,o.share_basis_points]);
 await db.query("UPDATE meetings SET status='published',version=version+1 WHERE id=$1",[id]);
 }else if(b.action==='cancel'){
 if(!['draft','published'].includes(m.status)||b.reason.length<3)throw new ApiError(409,'invalid_transition');
 await db.query("UPDATE meetings SET status='cancelled',version=version+1 WHERE id=$1",[id]);
 }else{
 if(m.status!=='published'||new Date(m.ends_at).getTime()>Date.now())throw new ApiError(409,'voting_not_ended');
 const result=await meetingResult(db,m),bytes=await protocolPdf(m,result),key=randomUUID();
 await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[privateFileLockKey('documents',key)]);
 await savePrivateFile('documents',key,bytes,'application/pdf');
 const d=(await db.query(`INSERT INTO documents(organization_id,building_id,title,visibility,storage_key,media_type,uploaded_by,category,related_type,related_id)
 VALUES($1,$2,$3,'residents',$4,'application/pdf',$5,'meeting_protocol','meeting',$6) RETURNING id`,[c.organization_id,m.building_id,m.title.slice(0,145)+' — protocol',key,req.user!.id,id])).rows[0];
 await db.query('INSERT INTO meeting_results(meeting_id,result) VALUES($1,$2)',[id,JSON.stringify(result)]);
 await db.query("UPDATE meetings SET status='finalized',protocol_document_id=$2,version=version+1 WHERE id=$1",[id,d.id]);
 }
 await record(db,req,c,'meeting.'+b.action,'meeting',id,{reason:b.reason});
 return (await db.query('SELECT * FROM meetings WHERE id=$1',[id])).rows[0];
 })));
});
governance.post('/governance/agenda/:id/vote',async(req,res)=>{
 const c=await requirePermission(req,'meetings.vote');if(c.role_key!=='unit_owner'||!c.unit_id)throw new ApiError(403,'forbidden');
 const aid=uuid.parse(req.params.id),b=z.object({key:uuid,eligibilityId:uuid,selectedOption:z.string().min(1).max(100)}).strict().parse(req.body);
 res.status(201).json(await transaction(db=>idempotent(db,req,b.key,b,async()=>{
 const a=(await db.query('SELECT * FROM agenda_items WHERE id=$1',[aid])).rows[0];if(!a)throw new ApiError(404,'not_found');
 const m=await locked(db,c,a.meeting_id);if(m.status!=='published'||phase(m)!=='open')throw new ApiError(409,'voting_closed');
 const e=(await db.query('SELECT id FROM meeting_eligibility WHERE id=$1 AND meeting_id=$2 AND owner_id=$3 AND unit_id=$4',[b.eligibilityId,m.id,req.user!.id,c.unit_id])).rows[0];
 if(!e)throw new ApiError(403,'not_eligible');if(!a.options.includes(b.selectedOption))throw new ApiError(400,'invalid_option');
 if((await db.query('SELECT 1 FROM meeting_ballots WHERE agenda_item_id=$1 AND eligibility_id=$2',[aid,e.id])).rowCount)throw new ApiError(409,'already_voted');
 const r=(await db.query('INSERT INTO meeting_ballots(agenda_item_id,eligibility_id,owner_id,selected_option) VALUES($1,$2,$3,$4) RETURNING *',[aid,e.id,req.user!.id,b.selectedOption])).rows[0];
 await record(db,req,c,'meeting.weighted_vote','meeting',m.id,{agendaId:aid,eligibilityId:e.id});return r;
 })));
});
