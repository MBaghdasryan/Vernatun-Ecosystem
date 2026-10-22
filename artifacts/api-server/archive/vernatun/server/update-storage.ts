import {mkdir,readFile,stat,unlink,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {privateStorageLocation} from './private-files.js';
import {config} from './config.js';
import {updateArchiveLimit} from './update-packages.js';

export interface UpdatePackageStorage{
 readonly name:string;
 write(id:string,bytes:Buffer):Promise<void>;
 read(id:string):Promise<Buffer>;
 remove(id:string):Promise<void>;
}
const fileName=(id:string)=>{if(!/^[a-f0-9-]{36}$/i.test(id))throw new Error('invalid_update_id');return id+'.zip'};

class AppUpdatePackageStorage implements UpdatePackageStorage{
 readonly name='app_storage';
 private object(id:string){const {bucket,prefix}=privateStorageLocation();return bucket.file(prefix+'operations-updates/'+fileName(id))}
 async write(id:string,bytes:Buffer){
  if(bytes.length>updateArchiveLimit)throw new Error('update_package_too_large');
  await this.object(id).save(bytes,{resumable:false,validation:'crc32c',preconditionOpts:{ifGenerationMatch:0},
   metadata:{contentType:'application/zip',cacheControl:'private, no-store'}});
 }
 async read(id:string){
  const object=this.object(id),[metadata]=await object.getMetadata();
  if(Number(metadata.size)>updateArchiveLimit)throw new Error('update_package_too_large');
  return (await object.download())[0];
 }
 async remove(id:string){await this.object(id).delete({ignoreNotFound:true})}
}
class IsolatedLocalUpdatePackageStorage implements UpdatePackageStorage{
 readonly name='isolated_test_local';
 private root:string;
 constructor(){
  if(config.NODE_ENV!=='test')throw new Error('local update package storage is test-only');
  const scope=process.env.PRIVATE_FILES_TEST_RUN;
  if(!scope||!/^qa_[a-f0-9]{20}$/.test(scope))throw new Error('isolated update package scope required');
  this.root=resolve('.local/operations-updates',scope);
 }
 async write(id:string,bytes:Buffer){
  if(bytes.length>updateArchiveLimit)throw new Error('update_package_too_large');
  await mkdir(this.root,{recursive:true,mode:0o700});
  await writeFile(resolve(this.root,fileName(id)),bytes,{flag:'wx',mode:0o600});
 }
 async read(id:string){
  const path=resolve(this.root,fileName(id));
  if((await stat(path)).size>updateArchiveLimit)throw new Error('update_package_too_large');
  return readFile(path);
 }
 async remove(id:string){await unlink(resolve(this.root,fileName(id))).catch((e:any)=>{if(e.code!=='ENOENT')throw e})}
}
export function updatePackageStorage():UpdatePackageStorage{
 return config.NODE_ENV==='test'?new IsolatedLocalUpdatePackageStorage():new AppUpdatePackageStorage();
}
