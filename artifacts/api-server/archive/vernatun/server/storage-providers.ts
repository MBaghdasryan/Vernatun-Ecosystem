import {mkdir,open,readFile,stat,unlink} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {S3Client,PutObjectCommand,GetObjectCommand,HeadObjectCommand,DeleteObjectCommand} from '@aws-sdk/client-s3';
export type StorageKind='photos'|'documents';
export interface PrivateStorageProvider{
 readonly mode:string;readonly identity:string;
 save(kind:StorageKind,key:string,bytes:Buffer,type:string):Promise<void>;
 read(kind:StorageKind,key:string):Promise<Buffer>;
 exists(kind:StorageKind,key:string):Promise<boolean>;
 metadata(kind:StorageKind,key:string):Promise<Record<string,any>>;
 delete(kind:StorageKind,key:string):Promise<void>;
 deleteVersion(kind:StorageKind,key:string,generation:string,metageneration:string):Promise<void>;
}
const valid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}(?:\.jpg)?$/i;
function keyFor(kind:StorageKind,key:string){if(!['photos','documents'].includes(kind)||!valid.test(key))throw new Error('Invalid private storage key');return kind+'/'+key}
export class LocalPrivateStorage implements PrivateStorageProvider{
 readonly mode='local';readonly identity:string;
 constructor(private root:string){this.root=resolve(root);this.identity='local:'+this.root}
 private path(k:StorageKind,id:string){return resolve(this.root,keyFor(k,id))}
 async save(k:StorageKind,id:string,bytes:Buffer,_type:string){await mkdir(resolve(this.root,k),{recursive:true,mode:0o700});const f=await open(this.path(k,id),'wx',0o600);try{await f.writeFile(bytes);await f.sync()}finally{await f.close()}}
 async read(k:StorageKind,id:string){return readFile(this.path(k,id))}
 async exists(k:StorageKind,id:string){try{await stat(this.path(k,id));return true}catch(e:any){if(e.code==='ENOENT')return false;throw e}}
 async metadata(k:StorageKind,id:string){const s=await stat(this.path(k,id)),b=await this.read(k,id);return {size:String(s.size),md5Hash:createHash('md5').update(b).digest('base64'),generation:String(s.ctimeMs)+':'+createHash('sha256').update(b).digest('hex'),metageneration:'1',updated:s.mtime.toISOString()}}
 async delete(k:StorageKind,id:string){try{await unlink(this.path(k,id))}catch(e:any){if(e.code!=='ENOENT')throw e}}
 async deleteVersion(_k:StorageKind,_id:string,_g:string,_m:string):Promise<void>{throw new Error('Local reviewed generation deletion is not enabled')}
}
export class S3CompatibleStorage implements PrivateStorageProvider{
 readonly mode='s3';readonly identity:string;private client:S3Client;
 constructor(private settings:{endpoint:string;region:string;bucket:string;accessKey:string;secretKey:string;prefix:string}){
  const u=new URL(settings.endpoint);if(u.username||u.password||u.protocol!=='https:'&&u.hostname!=='127.0.0.1'&&u.hostname!=='localhost')throw new Error('S3 requires HTTPS endpoint');
  this.identity='s3:'+settings.endpoint+'/'+settings.bucket+'/'+settings.prefix;
  this.client=new S3Client({endpoint:settings.endpoint,region:settings.region,forcePathStyle:true,credentials:{accessKeyId:settings.accessKey,secretAccessKey:settings.secretKey}});
 }
 private args(k:StorageKind,id:string){return {Bucket:this.settings.bucket,Key:this.settings.prefix+'/'+keyFor(k,id)}}
 async save(k:StorageKind,id:string,bytes:Buffer,type:string){await this.client.send(new PutObjectCommand({...this.args(k,id),Body:bytes,ContentType:type,CacheControl:'private, no-store',IfNoneMatch:'*'}))}
 async read(k:StorageKind,id:string){const r=await this.client.send(new GetObjectCommand(this.args(k,id)));if(!r.Body)throw new Error('Missing object body');return Buffer.from(await r.Body.transformToByteArray())}
 async exists(k:StorageKind,id:string){try{await this.client.send(new HeadObjectCommand(this.args(k,id)));return true}catch(e:any){if(e.$metadata?.httpStatusCode===404)return false;throw e}}
 async metadata(k:StorageKind,id:string){const r=await this.client.send(new HeadObjectCommand(this.args(k,id)));return {size:String(r.ContentLength),generation:r.VersionId??r.ETag,metageneration:r.LastModified?.toISOString(),updated:r.LastModified?.toISOString(),contentType:r.ContentType}}
 async delete(k:StorageKind,id:string){await this.client.send(new DeleteObjectCommand(this.args(k,id)))}
 async deleteVersion(k:StorageKind,id:string,g:string,m:string){const r=await this.client.send(new HeadObjectCommand(this.args(k,id)));if(!r.VersionId)throw new Error('S3 versioning required for reviewed deletion');if(r.VersionId!==g||r.LastModified?.toISOString()!==m)throw new Error('Storage generation changed');await this.client.send(new DeleteObjectCommand({...this.args(k,id),VersionId:g}))}
}
export function storageMode(){const value=process.env.PRIVATE_STORAGE_MODE??'app_storage';if(!['app_storage','local','s3'].includes(value))throw new Error('Invalid PRIVATE_STORAGE_MODE');return value}
export function storageStatus(){return {mode:storageMode(),explicit:!!process.env.PRIVATE_STORAGE_MODE,productionReady:!!process.env.PRIVATE_STORAGE_MODE&&storageMode()==='app_storage'}}
export function optionalProvider():PrivateStorageProvider|null{
 const mode=storageMode();if(mode==='app_storage')return null;
 const ns=process.env.NODE_ENV==='test'?process.env.PRIVATE_FILES_TEST_RUN:'vernatun';
 if(!ns||process.env.NODE_ENV==='test'&&!/^qa_[a-f0-9]{20}$/.test(ns))throw new Error('Isolated storage prefix required');
 if(mode==='local')return new LocalPrivateStorage(resolve(process.env.LOCAL_PRIVATE_STORAGE_DIR??'.local/private-storage',ns));
 const endpoint=process.env.S3_ENDPOINT,region=process.env.S3_REGION,bucket=process.env.S3_BUCKET,accessKey=process.env.S3_ACCESS_KEY,secretKey=process.env.S3_SECRET_KEY;
 if(!endpoint||!region||!bucket||!accessKey||!secretKey)throw new Error('Incomplete S3 configuration');
 return new S3CompatibleStorage({endpoint,region,bucket,accessKey,secretKey,prefix:ns});
}
