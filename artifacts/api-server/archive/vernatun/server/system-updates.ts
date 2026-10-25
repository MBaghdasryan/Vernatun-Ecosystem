import {raw,type Request,type Router} from 'express';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {pool,audit} from './db.js';
import {ApiError} from './access.js';
import {requireRecentAuthentication} from './recent-auth.js';
import {apiBuildId} from './system-diagnostics.js';
import {updatePackageStorage} from './update-storage.js';
import {updateArchiveLimit,validateUpdateArchive} from './update-packages.js';
import {releaseCallbackToken,releaseCallbackUrl,releasePipelineConfiguration,sendReleaseToPipeline,
 type ReleaseAction} from './system-update-pipeline.js';
import {rateLimit} from 'express-rate-limit';
import {PostgresRateStore} from './rate-limit.js';

const idSchema=z.string().uuid();
const columns=`id,file_name AS "fileName",version,previous_version AS "previousVersion",package_checksum AS "packageChecksum",
 size_bytes::text AS "sizeBytes",manifest,validation,status,uploaded_by AS "uploadedBy",uploaded_at AS "uploadedAt",
 installed_by AS "installedBy",started_at AS "startedAt",finished_at AS "finishedAt",result,backup_id AS "backupId",
 staged_schema_version AS "stagedSchemaVersion",deployed_schema_version AS "deployedSchemaVersion",
 pipeline_action AS "pipelineAction",pipeline_job_id AS "pipelineJobId",pipeline_release_ref AS "pipelineReleaseRef",
 previous_release_ref AS "previousReleaseRef",deployment_id AS "deploymentId",
 log,error_code AS "errorCode",rollback_result AS "rollbackResult"`;
const safeFileName=/^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9._-]{0,79}\.zip$/i;

function currentVersion(){const v=process.env.VERNATUN_APP_VERSION;return v&&/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(v)?v:null}
function updateStatus(v:ReturnType<typeof validateUpdateArchive>){
 if(!v.manifest||v.issues.length)return 'validation_failed' as const;
 return v.compatibility==='compatible'?'validated' as const:'needs_compatibility' as const;
}
function validationFor(bytes:Buffer){return validateUpdateArchive(bytes,currentVersion())}
function updateLog(action:string,detail:Record<string,unknown>={}){return [{at:new Date().toISOString(),action,...detail}]}
async function auditInTransaction(db:any,actor:string|null,action:string,id:string,details:Record<string,unknown>={}){
 await db.query(`INSERT INTO audit_events(actor_user_id,organization_id,action,entity_type,entity_id,details)
  VALUES($1,NULL,$2,'platform_update',$3,$4)`,[actor,action,id,JSON.stringify(details)]);
}

async function schemaVersion(db:any){
 const result=await db.query('SELECT max(name) AS name FROM schema_migrations');
 return (result.rows[0]?.name as string|null)??null;
}

async function pipelineUnavailable(req:Request,id:string,action:string):Promise<never>{
 await audit(req.user!.id,null,`system.update.${action}_rejected`,'platform_update',id,{reason:'release_pipeline_not_configured'});
 throw new ApiError(503,'release_pipeline_not_configured');
}

async function prepareReleaseAction(req:Request,id:string,action:ReleaseAction,archiveBytes?:Buffer){
 const configured=releasePipelineConfiguration();
 if(!configured)return pipelineUnavailable(req,id,action==='deploy'?'install':'rollback');
 const token=releaseCallbackToken(),jobId=randomUUID(),callbackUrl=releaseCallbackUrl(configured.callbackBase,id);
 const db=await pool.connect();let problem:{status:number;code:string}|null=null;
 let details:{version:string|null;checksum:string;backupId:string;schemaVersion:string;databaseMigrationRequired:boolean;
  currentReleaseRef:string|null;targetReleaseRef:string|null}|null=null;
 try{
  await db.query('BEGIN');
  await db.query('SELECT pg_advisory_xact_lock(73192844)');
  const row=(await db.query(`SELECT status,version,previous_version AS "previousVersion",package_checksum AS checksum,
   manifest,backup_id AS "backupId",staged_schema_version AS "stagedSchemaVersion",
   deployed_schema_version AS "deployedSchemaVersion",pipeline_release_ref AS "currentReleaseRef",
   previous_release_ref AS "targetReleaseRef"
   FROM platform_updates WHERE id=$1 FOR UPDATE`,[id])).rows[0];
  if(!row)problem={status:404,code:'update_not_found'};
  else if(action==='deploy'&&row.status!=='staged')problem={status:409,code:'update_staging_required'};
  else if(action==='rollback'&&row.status!=='deployed')problem={status:409,code:'deployed_update_required'};
  const currentSchema=await schemaVersion(db);
  if(!problem&&(!currentSchema||!row.stagedSchemaVersion))problem={status:409,code:'migration_state_unavailable'};
  if(!problem&&action==='deploy'&&currentSchema!==row.stagedSchemaVersion)problem={status:409,code:'migration_state_changed'};
  if(!problem&&action==='rollback'&&currentSchema!==row.deployedSchemaVersion)problem={status:409,code:'migration_state_changed'};
  if(!problem&&action==='deploy'&&currentVersion()!==row.previousVersion)problem={status:409,code:'running_release_changed'};
  if(!problem&&action==='rollback'&&!row.targetReleaseRef)problem={status:409,code:'previous_release_unavailable'};
  if(!problem){
   const backup=(await db.query(`SELECT id,kind,status,verification,migration_version AS "migrationVersion"
    FROM operations_backups WHERE id=$1 FOR UPDATE`,[row.backupId])).rows[0];
   if(!backup||backup.status!=='completed'||backup.verification!=='verified'||!['database','full_data'].includes(backup.kind))
    problem={status:409,code:'verified_database_backup_required'};
   else if(action==='deploy'&&backup.migrationVersion!==row.stagedSchemaVersion)
    problem={status:409,code:'backup_migration_state_mismatch'};
  }
  if(!problem&&action==='deploy'){
   if(!archiveBytes)problem={status:409,code:'update_package_unavailable'};
   else{
    const validation=validationFor(archiveBytes);
    if(validation.archiveChecksum!==row.checksum)problem={status:409,code:'update_package_checksum_mismatch'};
    else if(!validation.valid||!validation.compatible)problem={status:409,code:'update_validation_required'};
   }
  }
  if(!problem){
   const other=(await db.query(`SELECT 1 FROM platform_updates WHERE id<>$1 AND status IN
    ('dispatching','deploying','deployment_unknown','rollback_dispatch_unknown','rollback_dispatching','rolling_back') LIMIT 1`,[id])).rowCount;
   if(other)problem={status:409,code:'another_release_in_progress'};
  }
  if(problem){
   await auditInTransaction(db,req.user!.id,`system.update.${action==='deploy'?'install':'rollback'}_rejected`,id,{reason:problem.code});
   await db.query('COMMIT');
  }else{
   const baseline=String(action==='deploy'?row.stagedSchemaVersion:currentSchema);
   await db.query(`UPDATE platform_updates SET status=$2,pipeline_action=$3,pipeline_job_id=$4,
    pipeline_token_hash=$5,pipeline_callback_fingerprint=NULL,pipeline_baseline_version=$6,
    started_at=now(),finished_at=NULL,error_code=NULL,log=log||$7::jsonb
    WHERE id=$1`,
    [id,action==='deploy'?'dispatching':'rollback_dispatching',action,jobId,token.hash,baseline,
     JSON.stringify(updateLog(`${action}_dispatch_started`,{jobId,backupId:row.backupId,schemaVersion:baseline}))]);
   await auditInTransaction(db,req.user!.id,`system.update.${action}_requested`,id,{jobId,backupId:row.backupId,
    version:row.version,schemaVersion:baseline});
   details={version:row.version,checksum:row.checksum,backupId:row.backupId,schemaVersion:baseline,
    databaseMigrationRequired:row.manifest?.databaseMigrationRequired===true,
    currentReleaseRef:row.currentReleaseRef??null,targetReleaseRef:row.targetReleaseRef??null};
   await db.query('COMMIT');
  }
 }catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
 if(problem)throw new ApiError(problem.status,problem.code);
 if(!details)throw new ApiError(500,'release_dispatch_failed');
 const sent=await sendReleaseToPipeline({
  action,jobId,updateId:id,callbackToken:token.value,callbackUrl,packageBytes:archiveBytes,
  version:details.version,checksum:details.checksum,backupId:details.backupId,schemaVersion:details.schemaVersion,
  databaseMigrationRequired:details.databaseMigrationRequired,currentReleaseRef:details.currentReleaseRef,
  targetReleaseRef:details.targetReleaseRef,
 });
 const db2=await pool.connect();
 let finalStatus=action==='deploy'?'deployment_unknown':'rollback_dispatch_unknown';
 try{
  await db2.query('BEGIN');
  const active=(await db2.query('SELECT status FROM platform_updates WHERE id=$1 FOR UPDATE',[id])).rows[0]?.status;
  if(['dispatching','rollback_dispatching'].includes(active)){
   if(sent.kind==='accepted'){
    finalStatus=action==='deploy'?'deploying':'rolling_back';
    await db2.query(`UPDATE platform_updates SET status=$2,log=log||$3::jsonb WHERE id=$1`,
     [id,finalStatus,JSON.stringify(updateLog(`${action}_pipeline_accepted`,{jobId}))]);
    await auditInTransaction(db2,req.user!.id,`system.update.${action}_pipeline_accepted`,id,{jobId});
   }else if(sent.kind==='rejected'){
    finalStatus=action==='deploy'?'staged':'deployed';
    await db2.query(`UPDATE platform_updates SET status=$2,pipeline_action=NULL,pipeline_job_id=NULL,
     pipeline_token_hash=NULL,pipeline_baseline_version=NULL,error_code='release_pipeline_rejected',
     log=log||$3::jsonb WHERE id=$1`,
     [id,finalStatus,JSON.stringify(updateLog(`${action}_pipeline_rejected`,{jobId}))]);
    await auditInTransaction(db2,req.user!.id,`system.update.${action}_rejected`,id,{reason:'release_pipeline_rejected'});
   }else{
    finalStatus=action==='deploy'?'deployment_unknown':'rollback_dispatch_unknown';
    await db2.query(`UPDATE platform_updates SET status=$2,error_code='release_pipeline_response_unknown',
     log=log||$3::jsonb WHERE id=$1`,[id,finalStatus,JSON.stringify(updateLog(`${action}_pipeline_response_unknown`,{jobId}))]);
    await auditInTransaction(db2,req.user!.id,`system.update.${action}_dispatch_unknown`,id,{jobId});
   }
  }else finalStatus=active??finalStatus;
  await db2.query('COMMIT');
 }catch(error){await db2.query('ROLLBACK');throw error}finally{db2.release()}
 if(sent.kind==='rejected')throw new ApiError(502,'release_pipeline_rejected');
 return {id,status:finalStatus,jobId};
}

export function registerSystemUpdates(router:Router,permit:(req:Request,p:string)=>Promise<unknown>){
 const uploadLimit=rateLimit({windowMs:60*60*1000,limit:3,store:new PostgresRateStore('system-update-upload'),
  keyGenerator:req=>req.user!.id,standardHeaders:'draft-7',legacyHeaders:false,message:{error:'rate_limited'}});
 router.get('/system/updates',async(req,res)=>{
  await permit(req,'updates.read');
  const items=(await pool.query(`SELECT ${columns} FROM platform_updates ORDER BY uploaded_at DESC,id DESC LIMIT 50`)).rows;
  const schema=await schemaVersion(pool);
  res.set('Cache-Control','private, no-store').json({currentVersion:currentVersion(),buildId:apiBuildId,nodeVersion:process.version,
   schemaVersion:schema,installation:{status:releasePipelineConfiguration()?'ready':'pipeline_not_configured'},items});
 });
 router.get('/system/updates/:id',async(req,res)=>{
  await permit(req,'updates.read');
  const id=idSchema.parse(req.params.id),row=(await pool.query(`SELECT ${columns} FROM platform_updates WHERE id=$1`,[id])).rows[0];
  if(!row)throw new ApiError(404,'update_not_found');
  res.set('Cache-Control','private, no-store').json(row);
 });
 router.post('/system/updates/upload',uploadLimit,async(req,_res,next)=>{
  await permit(req,'updates.read');await permit(req,'updates.upload');requireRecentAuthentication(req);next();
 },raw({type:['application/zip','application/x-zip-compressed'],limit:updateArchiveLimit}),async(req,res)=>{
  if(req.get('X-Confirmation')!=='UPDATE PACKAGE')throw new ApiError(400,'confirmation_required');
  const contentType=req.get('Content-Type')?.split(';')[0]?.trim().toLowerCase();
  if(!['application/zip','application/x-zip-compressed'].includes(contentType??''))throw new ApiError(415,'zip_content_type_required');
  const fileName=req.get('X-Update-Filename')??'';
  if(!safeFileName.test(fileName))throw new ApiError(400,'invalid_update_filename');
  const bytes=Buffer.isBuffer(req.body)?req.body:null;
  if(!bytes?.length||bytes.length>updateArchiveLimit)throw new ApiError(413,'update_package_size_invalid');
  const validation=validationFor(bytes),status=updateStatus(validation),id=randomUUID();
  const manifest=validation.manifest;
  await pool.query(`INSERT INTO platform_updates(id,file_name,version,package_checksum,size_bytes,manifest,validation,status,uploaded_by,error_code,log)
   VALUES($1,$2,$3,$4,$5,$6,$7,'uploading',$8,$9,$10)`,
   [id,fileName,manifest?.version??null,validation.archiveChecksum,bytes.length,manifest??null,validation,req.user!.id,
    validation.issues[0]??null,JSON.stringify(updateLog('upload_received',{archiveChecksum:validation.archiveChecksum,bytes:bytes.length}))]);
  if(status!=='validation_failed'){
   try{await updatePackageStorage().write(id,bytes)}
   catch{
    await pool.query(`UPDATE platform_updates SET status='storage_failed',error_code='update_storage_unavailable',
     log=log||$2::jsonb WHERE id=$1`,[id,JSON.stringify(updateLog('storage_failed'))]);
    throw new ApiError(503,'update_storage_unavailable');
   }
  }
  await pool.query(`UPDATE platform_updates SET status=$2,validation=$3,error_code=$4,
   log=log||$5::jsonb WHERE id=$1`,
   [id,status,validation,validation.issues[0]??(validation.compatibility==='unknown'?'current_version_unavailable':null),
    JSON.stringify(updateLog('validation_completed',{status,issues:validation.issues,compatibility:validation.compatibility}))]);
  await audit(req.user!.id,null,'system.update.uploaded','platform_update',id,
   {status,checksum:validation.archiveChecksum,version:manifest?.version??null});
  res.status(201).set('Cache-Control','private, no-store').json({id,status,fileName,version:manifest?.version??null,
   checksum:validation.archiveChecksum,sizeBytes:bytes.length,validation});
 });
 router.post('/system/updates/:id/validate',async(req,res)=>{
  await permit(req,'updates.read');await permit(req,'updates.upload');requireRecentAuthentication(req);
  const id=idSchema.parse(req.params.id),row=(await pool.query('SELECT package_checksum FROM platform_updates WHERE id=$1',[id])).rows[0];
  if(!row)throw new ApiError(404,'update_not_found');
  let bytes:Buffer;try{bytes=await updatePackageStorage().read(id)}catch{throw new ApiError(409,'update_package_unavailable')}
  const validation=validationFor(bytes),status=updateStatus(validation);
  if(row.package_checksum!==validation.archiveChecksum)throw new ApiError(409,'update_package_checksum_mismatch');
  await pool.query(`UPDATE platform_updates SET status=$2,version=$3,manifest=$4,validation=$5,error_code=$6,
   log=log||$7::jsonb WHERE id=$1`,
   [id,status,validation.manifest?.version??null,validation.manifest??null,validation,
    validation.issues[0]??(validation.compatibility==='unknown'?'current_version_unavailable':null),
    JSON.stringify(updateLog('validation_repeated',{status,issues:validation.issues,compatibility:validation.compatibility}))]);
  await audit(req.user!.id,null,'system.update.validated','platform_update',id,{status});
  res.json({id,status,validation});
 });
 router.post('/system/updates/:id/stage',async(req,res)=>{
  await permit(req,'updates.read');await permit(req,'updates.upload');await permit(req,'backups.read');requireRecentAuthentication(req);
  const id=idSchema.parse(req.params.id),parsed=z.object({backupId:z.string().uuid(),confirmation:z.literal('STAGE UPDATE')}).strict().safeParse(req.body);
  if(!parsed.success){await audit(req.user!.id,null,'system.update.stage_rejected','platform_update',id,{reason:'invalid_confirmation_or_input'});throw new ApiError(400,'confirmation_required')}
  const b=parsed.data;
  const db=await pool.connect();let problem:string|null=null;
  try{
   await db.query('BEGIN');
   const row=(await db.query('SELECT status,version,validation FROM platform_updates WHERE id=$1 FOR UPDATE',[id])).rows[0];
   const schema=await schemaVersion(db);
   if(!row)problem='update_not_found';
   else if(row.status!=='validated'||row.validation?.compatible!==true)problem='update_validation_required';
   else if(!schema)problem='migration_state_unavailable';
   const backup=!problem?(await db.query(`SELECT id,kind,migration_version AS "migrationVersion" FROM operations_backups
    WHERE id=$1 AND status='completed' AND verification='verified' AND kind=ANY($2::text[]) FOR UPDATE`,
    [b.backupId,['database','full_data']])).rows[0]:null;
   if(!problem&&!backup)problem='verified_database_backup_required';
   else if(!problem&&backup.migrationVersion!==schema)problem='backup_migration_state_mismatch';
   if(problem)await auditInTransaction(db,req.user!.id,'system.update.stage_rejected',id,{reason:problem});
   else{
    await db.query(`UPDATE operations_backups SET retain_until=GREATEST(retain_until,now()+interval '30 days') WHERE id=$1`,[backup.id]);
    await db.query(`UPDATE platform_updates SET status='staged',previous_version=$2,backup_id=$3,
     staged_schema_version=$4,pipeline_baseline_version=$4,error_code=NULL,result='release_ready',
     log=log||$5::jsonb WHERE id=$1`,
     [id,currentVersion(),backup.id,schema,JSON.stringify(updateLog('staged',{backupId:backup.id,
      schemaVersion:schema,installation:'deployment_pipeline'}))]);
    await auditInTransaction(db,req.user!.id,'system.update.staged',id,{backupId:backup.id,version:row.version,schemaVersion:schema});
   }
   await db.query('COMMIT');
  }catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
  if(problem)throw new ApiError(problem==='update_not_found'?404:409,problem);
  res.json({id,status:'staged',installation:'deployment_pipeline',backupId:b.backupId});
 });
 router.post('/system/updates/:id/install',async(req,res)=>{
  await permit(req,'updates.read');await permit(req,'updates.install');requireRecentAuthentication(req);
  const id=idSchema.parse(req.params.id),parsed=z.object({confirmation:z.literal('INSTALL UPDATE')}).strict().safeParse(req.body);
  if(!parsed.success){await audit(req.user!.id,null,'system.update.install_rejected','platform_update',id,{reason:'invalid_confirmation'});throw new ApiError(400,'confirmation_required')}
  let bytes:Buffer;try{bytes=await updatePackageStorage().read(id)}catch{
   await audit(req.user!.id,null,'system.update.install_rejected','platform_update',id,{reason:'update_package_unavailable'});
   throw new ApiError(409,'update_package_unavailable');
  }
  res.status(202).json(await prepareReleaseAction(req,id,'deploy',bytes));
 });
 router.post('/system/updates/:id/rollback',async(req,res)=>{
  await permit(req,'updates.read');await permit(req,'updates.rollback');requireRecentAuthentication(req);
  const id=idSchema.parse(req.params.id),parsed=z.object({confirmation:z.literal('ROLLBACK UPDATE')}).strict().safeParse(req.body);
  if(!parsed.success){await audit(req.user!.id,null,'system.update.rollback_rejected','platform_update',id,{reason:'invalid_confirmation'});throw new ApiError(400,'confirmation_required')}
  res.status(202).json(await prepareReleaseAction(req,id,'rollback'));
 });
}
