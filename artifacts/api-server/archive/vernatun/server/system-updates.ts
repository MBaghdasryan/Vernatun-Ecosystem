import {raw,type Request,type Router} from 'express';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {pool,audit} from './db.js';
import {ApiError} from './access.js';
import {requireRecentAuthentication} from './recent-auth.js';
import {apiBuildId} from './system-diagnostics.js';
import {updatePackageStorage} from './update-storage.js';
import {updateArchiveLimit,validateUpdateArchive} from './update-packages.js';
import {backupKinds} from './operations-backups.js';
import {rateLimit} from 'express-rate-limit';
import {PostgresRateStore} from './rate-limit.js';

const idSchema=z.string().uuid();
const columns=`id,file_name AS "fileName",version,previous_version AS "previousVersion",package_checksum AS "packageChecksum",
 size_bytes::text AS "sizeBytes",manifest,validation,status,uploaded_by AS "uploadedBy",uploaded_at AS "uploadedAt",
 installed_by AS "installedBy",started_at AS "startedAt",finished_at AS "finishedAt",result,backup_id AS "backupId",
 log,error_code AS "errorCode",rollback_result AS "rollbackResult"`;
const safeFileName=/^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9._-]{0,79}\.zip$/i;
const installUnsupported={status:'manual_deployment_required',message:'Application files are not replaced by the current deployment provider. Deploy through the configured deployment pipeline.'};

function currentVersion(){const v=process.env.VERNATUN_APP_VERSION;return v&&/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(v)?v:null}
function updateStatus(v:ReturnType<typeof validateUpdateArchive>){
 if(!v.manifest||v.issues.length)return 'validation_failed' as const;
 return v.compatibility==='compatible'?'validated' as const:'needs_compatibility' as const;
}
function validationFor(bytes:Buffer){return validateUpdateArchive(bytes,currentVersion())}
function updateLog(action:string,detail:Record<string,unknown>={}){return [{at:new Date().toISOString(),action,...detail}]}

export function registerSystemUpdates(router:Router,permit:(req:Request,p:string)=>Promise<unknown>){
 const uploadLimit=rateLimit({windowMs:60*60*1000,limit:3,store:new PostgresRateStore('system-update-upload'),
  keyGenerator:req=>req.user!.id,standardHeaders:'draft-7',legacyHeaders:false,message:{error:'rate_limited'}});
 router.get('/system/updates',async(req,res)=>{
  await permit(req,'updates.read');
  const items=(await pool.query(`SELECT ${columns} FROM platform_updates ORDER BY uploaded_at DESC,id DESC LIMIT 50`)).rows;
  const schema=(await pool.query('SELECT max(name) AS name FROM schema_migrations')).rows[0]?.name??null;
  res.set('Cache-Control','private, no-store').json({currentVersion:currentVersion(),buildId:apiBuildId,nodeVersion:process.version,
   schemaVersion:schema,installation:installUnsupported,items});
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
  const id=idSchema.parse(req.params.id),b=z.object({backupId:z.string().uuid(),confirmation:z.literal('STAGE UPDATE')}).strict().parse(req.body);
  const db=await pool.connect();
  try{
   await db.query('BEGIN');
   const row=(await db.query('SELECT status,version,validation FROM platform_updates WHERE id=$1 FOR UPDATE',[id])).rows[0];
   if(!row)throw new ApiError(404,'update_not_found');
   if(row.status!=='validated'||row.validation?.compatible!==true)throw new ApiError(409,'update_validation_required');
   const backup=(await db.query(`SELECT id FROM operations_backups WHERE id=$1 AND status='completed' AND verification='verified'
    AND kind=ANY($2::text[])`,[b.backupId,['database','full_data']])).rows[0];
   if(!backup)throw new ApiError(409,'verified_database_backup_required');
   await db.query(`UPDATE platform_updates SET status='staged',previous_version=$2,backup_id=$3,error_code=NULL,
    result='manual_deployment_required',log=log||$4::jsonb WHERE id=$1`,
    [id,currentVersion(),backup.id,JSON.stringify(updateLog('staged',{backupId:backup.id,installation:'manual_deployment_required'}))]);
   await audit(req.user!.id,null,'system.update.staged','platform_update',id,{backupId:backup.id,version:row.version});
   await db.query('COMMIT');
  }catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
  res.json({id,status:'staged',installation:'manual_deployment_required',backupId:b.backupId});
 });
 router.post('/system/updates/:id/install',async(req,res)=>{
  await permit(req,'updates.read');await permit(req,'updates.install');requireRecentAuthentication(req);
  const id=idSchema.parse(req.params.id);z.object({confirmation:z.literal('INSTALL UPDATE')}).strict().parse(req.body);
  const row=(await pool.query('SELECT status FROM platform_updates WHERE id=$1',[id])).rows[0];
  if(!row)throw new ApiError(404,'update_not_found');
  await audit(req.user!.id,null,'system.update.install_blocked','platform_update',id,{reason:'manual_deployment_required'});
  res.status(409).json({...installUnsupported,id});
 });
 router.post('/system/updates/:id/rollback',async(req,res)=>{
  await permit(req,'updates.read');await permit(req,'updates.rollback');requireRecentAuthentication(req);
  const id=idSchema.parse(req.params.id);z.object({confirmation:z.literal('ROLLBACK UPDATE')}).strict().parse(req.body);
  if(!(await pool.query('SELECT 1 FROM platform_updates WHERE id=$1',[id])).rowCount)throw new ApiError(404,'update_not_found');
  await audit(req.user!.id,null,'system.update.rollback_blocked','platform_update',id,{reason:'manual_deployment_required'});
  res.status(409).json({...installUnsupported,id});
 });
}
