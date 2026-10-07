import type {Router,Request} from 'express';
import {z} from 'zod';
import {pool} from './db.js';
import {ApiError} from './access.js';
import {requireRecentAuthentication} from './recent-auth.js';
import {systemErrorFingerprint} from './system-errors.js';

export async function pruneSystemLogs(){
 const db=await pool.connect();
 try{
  await db.query('BEGIN');
  const lock=await db.query('SELECT pg_try_advisory_xact_lock(73192841) AS ok');
  if(!lock.rows[0].ok){await db.query('ROLLBACK');return 0}
  const policy=(await db.query('SELECT enabled,days FROM system_log_retention WHERE id=true FOR SHARE')).rows[0];
  if(!policy?.enabled){await db.query('COMMIT');return 0}
  await db.query("SET LOCAL lock_timeout='1s'");
  await db.query("SET LOCAL statement_timeout='5s'");
  // Freeze inserts briefly so acknowledgement watermarks and retained counts
  // cannot be changed by a late commit halfway through this bounded batch.
  await db.query('LOCK TABLE system_log_events IN SHARE ROW EXCLUSIVE MODE');
  await db.query(`WITH groups AS (
   SELECT ${systemErrorFingerprint} AS fingerprint,max(id) AS last_id,count(*) AS n
   FROM system_log_events WHERE level IN ('error','fatal') GROUP BY 1
  ) UPDATE system_error_states s SET status='open',revision=revision+1
   FROM groups g WHERE s.fingerprint=g.fingerprint AND s.status='resolved'
    AND (s.through_id<g.last_id OR s.through_count<g.n)`);
  const removed=await db.query(`WITH removed AS (
   DELETE FROM system_log_events WHERE id IN (
    SELECT id FROM system_log_events WHERE created_at<now()-make_interval(days=>$1)
    ORDER BY created_at,id LIMIT 500
   ) RETURNING *
  ), counts AS (
   SELECT ${systemErrorFingerprint} AS fingerprint,count(*) AS n FROM removed
   WHERE level IN ('error','fatal') GROUP BY 1
  ), adjusted AS (
   UPDATE system_error_states s SET through_count=greatest(0,s.through_count-c.n),revision=revision+1
   FROM counts c WHERE s.fingerprint=c.fingerprint RETURNING s.fingerprint
  ) SELECT count(*)::int AS n FROM removed`,[policy.days]);
  const n=removed.rows[0].n;
  if(n)await db.query(`INSERT INTO audit_events(action,entity_type,details)
   VALUES('system.logs.retention','system_log','{"batchLimit":500}'::jsonb||jsonb_build_object('deleted',$1::int,'days',$2::int))`,[n,policy.days]);
  await db.query('COMMIT');return n;
 }catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
}
export function registerSystemRetention(router:Router,permit:(req:Request,p:string)=>Promise<unknown>){
 router.get('/system/log-retention',async(req,res)=>{
  await permit(req,'logs.read');
  const {rows:[r]}=await pool.query(`SELECT enabled,days,revision,updated_at AS "updatedAt",
   (SELECT count(*)::int FROM system_log_events WHERE created_at<now()-make_interval(days=>p.days)) AS eligible
   FROM system_log_retention p WHERE id=true`);
  res.json(r);
 });
 router.put('/system/log-retention',async(req,res)=>{
  await permit(req,'logs.read');await permit(req,'logs.manage');requireRecentAuthentication(req);
  const b=z.object({enabled:z.boolean(),days:z.number().int().min(7).max(3650),revision:z.number().int().min(0),
   confirmation:z.literal('RETENTION')}).strict().parse(req.body);
  const db=await pool.connect();
  try{
   await db.query('BEGIN');
   const result=await db.query(`UPDATE system_log_retention SET enabled=$1,days=$2,revision=revision+1,
    updated_at=now(),updated_by=$3 WHERE id=true AND revision=$4 RETURNING revision`,[b.enabled,b.days,req.user!.id,b.revision]);
   if(!result.rowCount)throw new ApiError(409,'retention_policy_changed');
   await db.query(`INSERT INTO audit_events(actor_user_id,action,entity_type,details)
    VALUES($1,'system.logs.retention.policy','system_log',$2)`,[req.user!.id,JSON.stringify({enabled:b.enabled,days:b.days})]);
   await db.query('COMMIT');res.json({revision:result.rows[0].revision});
  }catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
 });
}
