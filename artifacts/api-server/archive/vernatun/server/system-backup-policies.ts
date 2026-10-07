import type {Router,Request} from 'express';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {pool} from './db.js';
import {ApiError} from './access.js';
import {requireRecentAuthentication} from './recent-auth.js';
import {backupStorage} from './operations-backup-storage.js';
import {operationsEncryptionState} from './operations-encryption.js';
import {backupKinds,sourceRoot} from './operations-backups.js';

const fields=`kind,enabled,frequency,provider,retention_days AS "retentionDays",
 keep_last AS "keepLast",auto_delete AS "autoDelete",revision,
 next_run_at AS "nextRunAt",last_queued_at AS "lastQueuedAt"`;
const interval={daily:'1 day',weekly:'7 days',monthly:'1 month'} as const;
const input=z.object({
 enabled:z.boolean(),frequency:z.enum(['daily','weekly','monthly']),
 provider:z.enum(['app_storage','local','s3']),retentionDays:z.number().int().min(30).max(3650),
 keepLast:z.number().int().min(1).max(100),autoDelete:z.boolean(),
 revision:z.number().int().min(1),confirmation:z.literal('BACKUP POLICY'),
}).strict();
export function registerBackupPolicies(router:Router,permit:(req:Request,p:string)=>Promise<unknown>){
 router.get('/system/backup-policies',async(req,res)=>{
  await permit(req,'backups.read');
  res.json((await pool.query(`SELECT ${fields} FROM operations_backup_policies ORDER BY kind`)).rows);
 });
 router.put('/system/backup-policies/:kind',async(req,res)=>{
  await permit(req,'backups.read');await permit(req,'backups.policies.manage');requireRecentAuthentication(req);
  const kind=z.enum(backupKinds).parse(req.params.kind),b=input.parse(req.body);
  if(b.enabled){
   if(operationsEncryptionState()!=='configured')throw new ApiError(503,'operations_encryption_not_configured');
   if(backupStorage().name!==b.provider)throw new ApiError(409,'backup_storage_provider_changed');
   if(kind==='platform_snapshot')await sourceRoot();
  }
  const db=await pool.connect();
  try{
   await db.query('BEGIN');await db.query("SET LOCAL TIME ZONE 'UTC'");await db.query('SELECT pg_advisory_xact_lock(73192843)');
   const r=await db.query(`UPDATE operations_backup_policies SET enabled=$2,frequency=$3,
    provider=$4,retention_days=$5,keep_last=$6,auto_delete=$7,revision=revision+1,
    next_run_at=CASE WHEN NOT $2 THEN NULL WHEN NOT enabled OR frequency<>$3
     THEN now()+$8::interval ELSE next_run_at END,updated_by=$9,updated_at=now()
    WHERE kind=$1 AND revision=$10 RETURNING ${fields}`,
    [kind,b.enabled,b.frequency,b.provider,b.retentionDays,b.keepLast,b.autoDelete,interval[b.frequency],req.user!.id,b.revision]);
   if(!r.rowCount)throw new ApiError(409,'backup_policy_changed');
   await db.query(`INSERT INTO audit_events(actor_user_id,action,entity_type,details)
    VALUES($1,'system.backup.policy.changed','backup_policy',$2)`,
    [req.user!.id,JSON.stringify({kind,...b,confirmation:undefined})]);
   await db.query('COMMIT');res.json(r.rows[0]);
  }catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
 });
}

// Missed intervals are coalesced into one run, never a catch-up storm.
export async function scheduleBackups(){
 if(operationsEncryptionState()!=='configured')return 0;
 const db=await pool.connect();
 try{
  await db.query('BEGIN');
  await db.query("SET LOCAL TIME ZONE 'UTC'");
  if(!(await db.query('SELECT pg_try_advisory_xact_lock(73192843) AS ok')).rows[0].ok){await db.query('ROLLBACK');return 0}
  if((await db.query("SELECT 1 FROM operations_backups WHERE status IN('pending','running') LIMIT 1")).rowCount){await db.query('COMMIT');return 0}
  if(!(await db.query('SELECT 1 FROM operations_backup_policies WHERE enabled AND next_run_at<=now() LIMIT 1')).rowCount){await db.query('COMMIT');return 0}
  const provider=backupStorage().name;
  const p=(await db.query(`SELECT * FROM operations_backup_policies
   WHERE enabled AND next_run_at<=now() AND provider=$1 ORDER BY next_run_at,kind LIMIT 1 FOR UPDATE`,[provider])).rows[0];
  if(!p){await db.query('COMMIT');return 0}
  const id=randomUUID();
  await db.query(`INSERT INTO operations_backups(id,kind,status,provider,notes,policy_kind,retain_until)
   VALUES($1,$2,'pending',$3,'Scheduled backup',$2,now()+make_interval(days=>$4))`,[id,p.kind,p.provider,p.retention_days]);
  await db.query(`UPDATE operations_backup_policies SET last_queued_at=now(),next_run_at=now()+$2::interval
   WHERE kind=$1`,[p.kind,interval[p.frequency as keyof typeof interval]]);
  await db.query(`INSERT INTO audit_events(action,entity_type,entity_id,details)
   VALUES('system.backup.scheduled','backup',$1,jsonb_build_object('kind',$2::text))`,[id,p.kind]);
  await db.query('COMMIT');return 1;
 }catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
}

// Only this policy's verified scheduled copies are eligible. Never manual copies,
// failed evidence, newest keep_last copies, or anything inside its original hold.
export async function pruneScheduledBackups(){
 const db=await pool.connect();let locked=false;
 try{
  locked=!!(await db.query('SELECT pg_try_advisory_lock(73192843) AS ok')).rows[0].ok;
  if(!locked)return 0;
  if(!(await db.query('SELECT 1 FROM operations_backup_policies WHERE enabled AND auto_delete LIMIT 1')).rowCount)return 0;
  const store=backupStorage();
  const row=(await db.query(`WITH ranked AS(
   SELECT b.*,row_number() OVER(PARTITION BY policy_kind ORDER BY created_at DESC,id DESC) AS position
   FROM operations_backups b WHERE status='completed' AND verification='verified' AND policy_kind IS NOT NULL
  ) SELECT b.id FROM ranked b JOIN operations_backup_policies p ON p.kind=b.policy_kind
   WHERE p.enabled AND p.auto_delete AND b.position>p.keep_last
    AND b.provider=$1 AND p.provider=$1 AND b.retain_until<now()
    AND b.created_at<now()-make_interval(days=>p.retention_days)
   ORDER BY b.created_at LIMIT 1`,[store.name])).rows[0];
  if(!row)return 0;
  // Durable intent is committed before removing bytes; deletion is retry-safe.
  await db.query(`INSERT INTO audit_events(action,entity_type,entity_id)
   VALUES('system.backup.expiration_requested','backup',$1)`,[row.id]);
  await store.remove(row.id);
  await db.query('BEGIN');
  await db.query("UPDATE operations_backups SET status='expired' WHERE id=$1",[row.id]);
  await db.query(`INSERT INTO audit_events(action,entity_type,entity_id)
   VALUES('system.backup.expired','backup',$1)`,[row.id]);
  await db.query('COMMIT');return 1;
 }catch(e){await db.query('ROLLBACK');throw e}
 finally{if(locked)await db.query('SELECT pg_advisory_unlock(73192843)');db.release()}
}
