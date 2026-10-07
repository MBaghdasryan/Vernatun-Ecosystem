import type {Router,Request} from 'express';
import {randomUUID,createHash} from 'node:crypto';
import {z} from 'zod';
import {pool,audit} from './db.js';
import {ApiError} from './access.js';
import {requireRecentAuthentication} from './recent-auth.js';
import {operationsEncryptionState} from './operations-encryption.js';
import {backupStorage} from './operations-backup-storage.js';
import {backupKinds,sourceRoot,verifyStoredBackup} from './operations-backups.js';
const recordAudit=(req:Request,action:string,id:string)=>audit(req.user!.id,null,action,'backup',id,{});

export function registerSystemBackups(router:Router,permit:(req:Request,p:string)=>Promise<unknown>){
 router.get('/system/backups',async(req,res)=>{
  await permit(req,'backups.read');
  const q=z.object({page:z.coerce.number().int().min(1).max(10000).default(1)}).parse(req.query);
  let provider:string|null=null;try{provider=backupStorage().name}catch{/* Not configured. */}
  let sourceAvailable=false;try{await sourceRoot();sourceAvailable=true}catch{/* Runtime does not include source. */}
  const rows=(await pool.query(`SELECT id,kind,status,created_at AS "createdAt",finished_at AS "finishedAt",provider,
   bytes,checksum,application_version AS "applicationVersion",migration_version AS "migrationVersion",
   verification,verified_at AS "verifiedAt",error_code AS "errorCode",notes,retain_until AS "retainUntil"
   FROM operations_backups ORDER BY created_at DESC,id LIMIT 51 OFFSET $1`,[(q.page-1)*50])).rows;
  res.json({page:q.page,hasMore:rows.length>50,items:rows.slice(0,50),provider,
   encryption:operationsEncryptionState(),sourceAvailable,restoreMode:'isolated_manual',limitMiB:64,
   kinds:backupKinds});
 });
 router.post('/system/backups',async(req,res)=>{
  await permit(req,'backups.read');await permit(req,'backups.create');requireRecentAuthentication(req);
  const input=z.object({kind:z.enum(backupKinds),notes:z.string().trim().max(300).default(''),confirmation:z.literal('BACKUP')}).strict().parse(req.body);
  if(operationsEncryptionState()!=='configured')throw new ApiError(503,'operations_encryption_not_configured');
  let provider:string;try{provider=backupStorage().name}catch{throw new ApiError(503,'backup_storage_not_configured')}
  if(input.kind==='platform_snapshot')try{await sourceRoot()}catch{throw new ApiError(503,'source_package_unavailable')}
  const db=await pool.connect(),id=randomUUID();
  try{
   await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(73192843)');
   if((await db.query("SELECT 1 FROM operations_backups WHERE status IN('pending','running') LIMIT 1")).rowCount)throw new ApiError(409,'backup_already_queued');
   await db.query("INSERT INTO operations_backups(id,kind,status,provider,created_by,notes) VALUES($1,$2,'pending',$3,$4,$5)",[id,input.kind,provider,req.user!.id,input.notes]);
   await db.query("INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,details) VALUES($1,'system.backup.queued','backup',$2,jsonb_build_object('kind',$3::text))",[req.user!.id,id,input.kind]);
   await db.query('COMMIT');
  }catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
  res.status(202).json({id,status:'pending'});
 });
 router.post('/system/backups/:id/verify',async(req,res)=>{
  await permit(req,'backups.read');await permit(req,'backups.create');requireRecentAuthentication(req);
  const id=z.string().uuid().parse(req.params.id);
  if(operationsEncryptionState()!=='configured')throw new ApiError(503,'operations_encryption_not_configured');
  const db=await pool.connect();let locked=false;
  try{
   locked=!!(await db.query('SELECT pg_try_advisory_lock(73192843) AS ok')).rows[0].ok;
   if(!locked)throw new ApiError(409,'backup_busy');
   const row=(await db.query("SELECT checksum,provider FROM operations_backups WHERE id=$1 AND status='completed'",[id])).rows[0];
   if(!row)throw new ApiError(404,'backup_not_found');
   let verified=true;try{await verifyStoredBackup(id,row.checksum,row.provider)}catch{verified=false}
   await db.query('BEGIN');
   await db.query('UPDATE operations_backups SET verification=$2,verified_at=now() WHERE id=$1',[id,verified?'verified':'verification_failed']);
   await db.query("INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id) VALUES($1,$2,'backup',$3)",
    [req.user!.id,verified?'system.backup.verified':'system.backup.verification_failed',id]);
   await db.query('COMMIT');
   if(!verified)throw new ApiError(409,'backup_verification_failed');
   res.json({verified:true});
  }catch(e){await db.query('ROLLBACK');throw e}
  finally{if(locked)await db.query('SELECT pg_advisory_unlock(73192843)');db.release()}
 });
 router.get('/system/backups/:id/download',async(req,res)=>{
  await permit(req,'backups.read');await permit(req,'backups.download');requireRecentAuthentication(req);
  const id=z.string().uuid().parse(req.params.id);
  const row=(await pool.query("SELECT checksum,provider FROM operations_backups WHERE id=$1 AND status='completed'",[id])).rows[0];
  if(!row)throw new ApiError(404,'backup_not_found');
  const store=backupStorage();if(store.name!==row.provider)throw new ApiError(503,'backup_storage_provider_changed');
  const bytes=await store.read(id);
  if(createHash('sha256').update(bytes).digest('hex')!==row.checksum)throw new ApiError(409,'backup_checksum_mismatch');
  await recordAudit(req,'system.backup.downloaded',id);
  res.set({'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="vernatun-${id}.vbackup"`,'Cache-Control':'private, no-store'}).send(bytes);
 });
 router.delete('/system/backups/:id',async(req,res)=>{
  await permit(req,'backups.read');await permit(req,'backups.delete');requireRecentAuthentication(req);
  const id=z.string().uuid().parse(req.params.id);z.object({confirmation:z.literal('DELETE BACKUP')}).strict().parse(req.body);
  const db=await pool.connect();
  try{
   await db.query('BEGIN');
   await db.query('SELECT pg_advisory_xact_lock(73192843)');
   const row=(await db.query('SELECT status,provider,retain_until>now() AS protected FROM operations_backups WHERE id=$1 FOR UPDATE',[id])).rows[0];
   if(!row)throw new ApiError(404,'backup_not_found');
   if(row.protected)throw new ApiError(409,'backup_minimum_retention');
   if(!['completed','failed'].includes(row.status))throw new ApiError(409,'backup_not_deletable');
   const store=backupStorage();if(store.name!==row.provider)throw new ApiError(503,'backup_storage_provider_changed');
   await db.query("INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id) VALUES($1,'system.backup.deletion_requested','backup',$2)",[req.user!.id,id]);
   // Preserve durable intent before touching bytes. A retry is idempotent at storage.
   await db.query('COMMIT');await store.remove(id);
   await db.query("UPDATE operations_backups SET status='deleted' WHERE id=$1",[id]);
   await db.query("INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id) VALUES($1,'system.backup.deleted','backup',$2)",[req.user!.id,id]);
  }catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
  res.status(204).end();
 });
}
