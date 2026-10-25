import {createHash,timingSafeEqual} from 'node:crypto';
import {Router} from 'express';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import {pool} from './db.js';

const digestRef=z.string().regex(/^[a-z0-9._/-]{1,240}@sha256:[a-f0-9]{64}$/i);
const callbackSchema=z.object({
 jobId:z.string().uuid(),
 result:z.enum(['deployed','deployment_rolled_back','deployment_failed','rollback_succeeded','rollback_failed']),
 backupId:z.string().uuid(),
 deploymentId:z.string().regex(/^[a-zA-Z0-9._:-]{1,128}$/).nullable(),
 releaseRef:digestRef.nullable(),
 previousReleaseRef:digestRef.nullable(),
 migration:z.object({
  preflight:z.enum(['passed','failed']),driftFree:z.boolean(),baselineVersion:z.string().max(100).nullable(),
  schemaVersion:z.string().max(100).nullable(),result:z.enum(['not_required','applied','not_attempted','failed']),
 }).strict(),
 healthCheck:z.object({status:z.enum(['passed','failed']),checkedAt:z.string().datetime()}).strict(),
 rollback:z.object({status:z.enum(['not_required','succeeded','failed']),releaseRef:digestRef.nullable()}).strict(),
}).strict();

function isDigest(value:unknown):value is string{return typeof value==='string'&&digestRef.safeParse(value).success}
function terminal(status:string){return ['deployed','deployment_rolled_back','deployment_failed','rollback_completed','rollback_failed'].includes(status)}
function auditQuery(db:PoolClient,action:string,id:string,details:Record<string,unknown>){
 return db.query(`INSERT INTO audit_events(actor_user_id,organization_id,action,entity_type,entity_id,details)
  VALUES(NULL,NULL,$1,'platform_update',$2,$3)`,[action,id,JSON.stringify(details)]);
}

export const systemUpdateCallbacks=Router();
systemUpdateCallbacks.post('/:id/pipeline-result',async(req,res)=>{
 const id=z.string().uuid().safeParse(req.params.id);
 if(!id.success)return res.status(400).json({error:'invalid_update_id'});
 const token=/^Bearer ([a-f0-9]{64})$/i.exec(req.get('Authorization')??'')?.[1];
 if(!token)return res.status(401).json({error:'pipeline_authentication_required'});
 const tokenHash=createHash('sha256').update(token).digest('hex');
 const db=await pool.connect();
 try{
  await db.query('BEGIN');
  const row=(await db.query(`SELECT status,pipeline_action,pipeline_job_id,pipeline_token_hash,pipeline_callback_fingerprint,
   started_at AS "startedAt",
   backup_id AS "backupId",pipeline_baseline_version AS "baselineVersion",pipeline_release_ref AS "releaseRef",
   previous_release_ref AS "previousReleaseRef"
   FROM platform_updates WHERE id=$1 FOR UPDATE`,[id.data])).rows[0];
  if(!row){await db.query('ROLLBACK');return res.status(404).json({error:'update_not_found'})}
  const stored=typeof row.pipeline_token_hash==='string'?Buffer.from(row.pipeline_token_hash,'hex'):Buffer.alloc(0);
  const supplied=Buffer.from(tokenHash,'hex');
  if(stored.length!==supplied.length||!timingSafeEqual(stored,supplied)){
   await db.query('ROLLBACK');return res.status(401).json({error:'pipeline_authentication_required'});
  }
  if(!row.startedAt||Date.now()-new Date(row.startedAt).valueOf()>24*60*60*1000){
   await auditQuery(db,'system.update.pipeline_callback_rejected',id.data,{reason:'callback_token_expired'});
   await db.query('UPDATE platform_updates SET pipeline_token_hash=NULL WHERE id=$1',[id.data]);
   await db.query('COMMIT');return res.status(401).json({error:'pipeline_authentication_required'});
  }
  const parsed=callbackSchema.safeParse(req.body);
  if(!parsed.success){
   await auditQuery(db,'system.update.pipeline_callback_rejected',id.data,{reason:'invalid_pipeline_result'});
   await db.query('COMMIT');return res.status(400).json({error:'invalid_pipeline_result'});
  }
  const fingerprint=createHash('sha256').update(JSON.stringify(parsed.data)).digest('hex');
  if(terminal(row.status)&&row.pipeline_callback_fingerprint===fingerprint){
   await db.query('COMMIT');return res.json({accepted:true,duplicate:true,status:row.status});
  }
  const event=parsed.data;
  let rejection:string|null=null;
  if(!['dispatching','deploying','deployment_unknown','rollback_dispatch_unknown','rollback_dispatching','rolling_back'].includes(row.status))rejection='release_not_in_progress';
  else if(event.jobId!==row.pipeline_job_id)rejection='pipeline_job_mismatch';
  else if(event.backupId!==row.backupId)rejection='backup_mismatch';
  else if(event.migration.baselineVersion!==row.baselineVersion)rejection='migration_baseline_mismatch';
  else if(event.migration.preflight==='passed'&&!event.migration.driftFree)rejection='migration_drift_reported';
  else if(row.pipeline_action==='deploy'&&!['deployed','deployment_rolled_back','deployment_failed'].includes(event.result))rejection='pipeline_action_mismatch';
  else if(row.pipeline_action==='rollback'&&!['rollback_succeeded','rollback_failed'].includes(event.result))rejection='pipeline_action_mismatch';
  if(!rejection&&event.result==='deployed'){
   if(event.migration.preflight!=='passed'||!event.migration.driftFree||!event.migration.schemaVersion||
    (event.migration.result==='failed'||event.migration.result==='not_attempted')||
    event.healthCheck.status!=='passed'||!event.deploymentId||!isDigest(event.releaseRef)||
    !isDigest(event.previousReleaseRef))rejection='deployment_success_evidence_incomplete';
  }
  if(!rejection&&event.result==='deployment_rolled_back'){
   if(event.migration.preflight!=='passed'||!event.migration.driftFree||event.healthCheck.status!=='failed'||
    !event.deploymentId||event.rollback.status!=='succeeded'||
    !isDigest(event.rollback.releaseRef)||!isDigest(event.previousReleaseRef)||
    event.rollback.releaseRef!==event.previousReleaseRef)rejection='automatic_rollback_evidence_incomplete';
  }
  if(!rejection&&event.result==='rollback_succeeded'){
   if(event.migration.preflight!=='passed'||!event.migration.driftFree||event.healthCheck.status!=='passed'||
    event.rollback.status!=='succeeded'||!isDigest(event.rollback.releaseRef)||
    event.rollback.releaseRef!==row.previousReleaseRef||!event.deploymentId)rejection='rollback_success_evidence_incomplete';
  }
  if(!rejection&&event.result==='deployment_failed'&&event.rollback.status==='succeeded')rejection='deployment_result_conflicts_with_rollback';
  if(!rejection&&event.result==='deployment_failed'&&event.migration.preflight==='passed'&&
   event.healthCheck.status==='passed'&&event.rollback.status!=='failed')rejection='deployment_failure_evidence_incomplete';
  if(!rejection&&event.result==='rollback_failed'&&event.rollback.status!=='failed')rejection='rollback_failure_evidence_incomplete';
  if(rejection){
   await auditQuery(db,'system.update.pipeline_callback_rejected',id.data,{jobId:event.jobId,reason:rejection});
   await db.query('COMMIT');return res.status(409).json({error:rejection});
  }
  const newStatus=event.result==='deployed'?'deployed':
   event.result==='deployment_rolled_back'?'deployment_rolled_back':
   event.result==='deployment_failed'?'deployment_failed':
   event.result==='rollback_succeeded'?'rollback_completed':'rollback_failed';
  const releaseRef=event.result==='deployed'?event.releaseRef:
   event.result==='deployment_rolled_back'?event.rollback.releaseRef:
   event.result==='rollback_succeeded'?event.rollback.releaseRef:row.releaseRef;
  const previousRef=event.result==='deployed'?event.previousReleaseRef:
   event.result==='deployment_rolled_back'?event.releaseRef:
   event.result==='rollback_succeeded'?row.releaseRef:row.previousReleaseRef;
  const log=JSON.stringify([{at:new Date().toISOString(),action:'pipeline_result',result:event.result,
   migrationPreflight:event.migration.preflight,migrationDriftFree:event.migration.driftFree,
   schemaVersion:event.migration.schemaVersion,healthCheck:event.healthCheck.status,rollback:event.rollback.status}]);
  await db.query(`UPDATE platform_updates SET status=$2,pipeline_release_ref=$3,previous_release_ref=$4,
   deployed_schema_version=COALESCE($5,deployed_schema_version),deployment_id=COALESCE($6,deployment_id),
   finished_at=now(),result=$7,rollback_result=$8,pipeline_callback_fingerprint=$9,
   log=log||$10::jsonb,error_code=CASE WHEN $2 IN('deployment_failed','rollback_failed') THEN $11 ELSE NULL END
   WHERE id=$1`,
   [id.data,newStatus,releaseRef,previousRef,event.migration.schemaVersion,event.deploymentId,event.result,
    event.rollback.status,fingerprint,log,newStatus==='deployment_failed'?'deployment_health_or_migration_failed':'rollback_failed']);
  await auditQuery(db,`system.update.${event.result}`,id.data,{jobId:event.jobId,backupId:event.backupId,
   migrationPreflight:event.migration.preflight,migrationDriftFree:event.migration.driftFree,
   schemaVersion:event.migration.schemaVersion,healthCheck:event.healthCheck.status,rollback:event.rollback.status});
  await db.query('COMMIT');
  return res.json({accepted:true,status:newStatus});
 }catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
});
