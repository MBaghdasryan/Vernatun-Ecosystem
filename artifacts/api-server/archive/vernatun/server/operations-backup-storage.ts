import {mkdir,writeFile,readFile,unlink,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {S3Client,PutObjectCommand,GetObjectCommand,DeleteObjectCommand} from '@aws-sdk/client-s3';
import {privateStorageLocation} from './private-files.js';
import {config} from './config.js';

export const backupByteLimit=160*1024*1024;
function safeId(id:string){if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id))throw new Error('Invalid backup identifier');return id+'.vbackup'}
export interface BackupStorageProvider{
 readonly name:string;
 write(id:string,bytes:Buffer):Promise<void>;
 read(id:string):Promise<Buffer>;
 remove(id:string):Promise<void>;
}
export class LocalBackupStorage implements BackupStorageProvider{
 readonly name='local';
 constructor(private root:string){if(config.NODE_ENV==='production')throw new Error('Local backup storage is not durable in production')}
 async write(id:string,bytes:Buffer){await mkdir(this.root,{recursive:true,mode:0o700});await writeFile(resolve(this.root,safeId(id)),bytes,{flag:'wx',mode:0o600})}
 async read(id:string){const path=resolve(this.root,safeId(id));if((await stat(path)).size>backupByteLimit)throw new Error('Backup size limit');return readFile(path)}
 async remove(id:string){await unlink(resolve(this.root,safeId(id))).catch(e=>{if(e.code!=='ENOENT')throw e})}
}
export class AppBackupStorage implements BackupStorageProvider{
 readonly name='app_storage';
 private object(id:string){
  const {bucket,prefix}=privateStorageLocation();
  return bucket.file(prefix+'operations-backups/'+safeId(id));
 }
 async write(id:string,bytes:Buffer){await this.object(id).save(bytes,{resumable:false,validation:'crc32c',preconditionOpts:{ifGenerationMatch:0},metadata:{contentType:'application/octet-stream',cacheControl:'private, no-store'}})}
 async read(id:string){const f=this.object(id);const [m]=await f.getMetadata();if(Number(m.size)>backupByteLimit)throw new Error('Backup size limit');return (await f.download())[0]}
 async remove(id:string){await this.object(id).delete({ignoreNotFound:true})}
}
export class S3BackupStorage implements BackupStorageProvider{
 readonly name='s3';
 constructor(private client:S3Client,private bucket:string,private prefix:string){}
 private object(id:string){return {Bucket:this.bucket,Key:this.prefix+'/'+safeId(id)}}
 async write(id:string,bytes:Buffer){await this.client.send(new PutObjectCommand({...this.object(id),Body:bytes,ContentType:'application/octet-stream',CacheControl:'private, no-store',IfNoneMatch:'*'}))}
 async read(id:string){
  const r=await this.client.send(new GetObjectCommand(this.object(id)));
  if(!r.Body||!r.ContentLength||r.ContentLength>backupByteLimit)throw new Error('Invalid backup size');
  return Buffer.from(await r.Body.transformToByteArray());
 }
 async remove(id:string){await this.client.send(new DeleteObjectCommand(this.object(id)))}
}
export function backupStorage():BackupStorageProvider{
 const mode=process.env.BACKUP_STORAGE_MODE??'app_storage';
 if(mode==='app_storage'){privateStorageLocation();return new AppBackupStorage()}
 if(mode==='local'){
  const scope=config.NODE_ENV==='test'?process.env.PRIVATE_FILES_TEST_RUN:'development';
  if(!scope||!/^development$|^qa_[a-f0-9]{20}$/.test(scope))throw new Error('Invalid backup scope');
  return new LocalBackupStorage(resolve('.local/operations-backups',scope));
 }
 if(mode==='s3'){
  const endpoint=process.env.BACKUP_S3_ENDPOINT,bucket=process.env.BACKUP_S3_BUCKET,
   accessKeyId=process.env.BACKUP_S3_ACCESS_KEY,secretAccessKey=process.env.BACKUP_S3_SECRET_KEY;
  if(!endpoint||!bucket||!accessKeyId||!secretAccessKey)throw new Error('Backup S3 not configured');
  const url=new URL(endpoint);if(url.protocol!=='https:'||url.username||url.password)throw new Error('Backup S3 HTTPS required');
  return new S3BackupStorage(new S3Client({endpoint,region:process.env.BACKUP_S3_REGION??'auto',forcePathStyle:true,credentials:{accessKeyId,secretAccessKey}}),bucket,'vernatun-operations-backups');
 }
 throw new Error('Unknown backup storage mode');
}
