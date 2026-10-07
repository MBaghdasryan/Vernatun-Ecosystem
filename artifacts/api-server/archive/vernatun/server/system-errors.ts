import type {Router,Request} from 'express';
import {z} from 'zod';
import {pool} from './db.js';
import {ApiError} from './access.js';

// Group only safe, stable metadata. Neither identifiers nor arbitrary messages
// enter the fingerprint, so repeated instances share a group across users.
const fingerprint=`md5(jsonb_build_array(category,service,event,method,endpoint,http_status,error_code,job)::text)`;
export {fingerprint as systemErrorFingerprint};
const sources=`SELECT *,${fingerprint} AS fingerprint FROM system_log_events WHERE level IN ('error','fatal')`;
const grouped=`WITH errors AS (${sources}), aggregates AS (
 SELECT fingerprint,min(created_at) AS "firstSeen",max(created_at) AS "lastSeen",
 count(*)::int AS occurrences,count(DISTINCT actor_user_id)::int AS "affectedUsers",
 count(DISTINCT organization_id)::int AS "affectedOrganizations",max(id) AS last_id
 FROM errors GROUP BY fingerprint
), latest AS (SELECT DISTINCT ON(fingerprint) fingerprint,service,category,
 coalesce(error_code,event) AS message,request_id AS "latestRequestId"
 FROM errors ORDER BY fingerprint,created_at DESC,id DESC)
 SELECT a.fingerprint,l.message,l.service,l.category,a."firstSeen",a."lastSeen",
 a.occurrences,a."affectedUsers",a."affectedOrganizations",l."latestRequestId",a.last_id::text AS "lastEventId",
 CASE WHEN s.status='resolved' AND s.through_id>=a.last_id AND s.through_count>=a.occurrences
 THEN 'resolved' ELSE 'open' END AS status,coalesce(s.revision,0) AS revision
 FROM aggregates a JOIN latest l USING(fingerprint) LEFT JOIN system_error_states s USING(fingerprint)`;
const fp=z.string().regex(/^[a-f0-9]{32}$/);
const stateInput=z.object({status:z.enum(['open','resolved']),lastEventId:z.string().regex(/^[1-9]\d*$/),
 occurrences:z.number().int().positive(),revision:z.number().int().min(0)}).strict();
const fields=`id::text,created_at AS "createdAt",category,level,service,event,request_id AS "requestId",
 actor_user_id AS "actorId",organization_id AS "organizationId",endpoint,method,http_status AS status,
 latency_ms AS "latencyMs",error_code AS "errorCode",job,
 application_version AS "applicationVersion",environment,safe_stack AS "stackTrace"`;
export function registerSystemErrors(router:Router,permit:(req:Request,permission:string)=>Promise<unknown>){
 router.get('/system/errors',async(req,res)=>{
  await permit(req,'logs.read');
  const f=z.object({page:z.coerce.number().int().min(1).max(10000).default(1),status:z.enum(['open','resolved']).optional()}).strict().parse(req.query);
  const r=await pool.query(`SELECT * FROM (${grouped}) groups WHERE ($1::text IS NULL OR status=$1)
   ORDER BY "lastSeen" DESC,fingerprint LIMIT 51 OFFSET $2`,[f.status??null,(f.page-1)*50]);
  res.setHeader('Cache-Control','no-store');
  res.json({page:f.page,hasMore:r.rows.length>50,items:r.rows.slice(0,50)});
 });
 router.get('/system/errors/:fingerprint',async(req,res)=>{
  await permit(req,'logs.read');const id=fp.parse(req.params.fingerprint);
  z.object({}).strict().parse(req.query);
  const client=await pool.connect();
  try{
   await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const group=await client.query(`SELECT * FROM (${grouped}) groups WHERE fingerprint=$1`,[id]);
   if(!group.rowCount)throw new ApiError(404,'error_group_not_found');
   const events=await client.query(`SELECT ${fields} FROM (${sources}) errors WHERE fingerprint=$1
    ORDER BY created_at DESC,id DESC LIMIT 51`,[id]);
   await client.query('COMMIT');res.setHeader('Cache-Control','no-store');
   res.json({group:group.rows[0],events:{items:events.rows.slice(0,50),page:1,hasMore:events.rows.length>50},
    environment:events.rows[0]?.environment??null,applicationVersion:events.rows[0]?.applicationVersion??null,stackTrace:events.rows[0]?.stackTrace??null});
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
 });
 router.patch('/system/errors/:fingerprint',async(req,res)=>{
  // Authorize before taking a connection; avoid nested pool acquisition under lock.
  await permit(req,'logs.read');await permit(req,'logs.manage');
  const id=fp.parse(req.params.fingerprint),body=stateInput.parse(req.body);
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   await client.query('SELECT pg_advisory_xact_lock_shared(73192841)');
   await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",['system-error:'+id]);
   const r=await client.query(`SELECT * FROM (${grouped}) groups WHERE fingerprint=$1`,[id]);
   if(!r.rowCount)throw new ApiError(404,'error_group_not_found');
   const current=r.rows[0];
   if(current.lastEventId!==body.lastEventId||current.occurrences!==body.occurrences||current.revision!==body.revision)throw new ApiError(409,'error_group_changed');
   await client.query(`INSERT INTO system_error_states(fingerprint,status,through_id,through_count,updated_by)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT(fingerprint) DO UPDATE SET status=excluded.status,
    through_id=excluded.through_id,through_count=excluded.through_count,updated_by=excluded.updated_by,
    updated_at=now(),revision=system_error_states.revision+1`,[id,body.status,body.lastEventId,body.occurrences,req.user!.id]);
   await client.query(`INSERT INTO audit_events(actor_user_id,organization_id,action,entity_type,entity_id,details)
    VALUES($1,NULL,'system.error.status','system_error',NULL,$2)`,[req.user!.id,JSON.stringify({fingerprint:id,from:current.status,to:body.status,throughId:body.lastEventId,occurrences:body.occurrences})]);
   const fresh=await client.query(`SELECT * FROM (${grouped}) groups WHERE fingerprint=$1`,[id]);
   await client.query('COMMIT');res.setHeader('Cache-Control','no-store');res.json(fresh.rows[0]);
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
 });
}
