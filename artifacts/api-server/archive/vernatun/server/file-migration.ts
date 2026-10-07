import {readFile,lstat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {pool} from './db.js';
import {privateFileExists,readPrivateFile,saveAndCommitPrivateFile,type FileKind} from './private-files.js';

export async function storedFiles():Promise<{kind:FileKind;key:string;media_type:string}[]>{
  return (await pool.query(`
    SELECT 'photos' AS kind,storage_key AS key,'image/jpeg' AS media_type FROM request_photos
    UNION SELECT 'photos',storage_key,'image/jpeg' FROM file_attachments
    UNION SELECT 'photos',storage_key,'image/jpeg' FROM incident_attachments
    UNION SELECT 'documents',storage_key,media_type FROM documents
    UNION SELECT 'documents',storage_key,media_type FROM document_versions
  `)).rows;
}
const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');

// Reads metadata only. Never changes rows or deletes the original local files.
export async function migratePrivateFiles(sourceRoot:string,apply=false){
  const report={referenced:0,copied:0,verified:0,pending:0,missing:0};
  for(const file of await storedFiles()){
    report.referenced++;
    const exists=await privateFileExists(file.kind,file.key); // Also validates key.
    const path=resolve(sourceRoot,`private-${file.kind}`,file.key);
    let local:Buffer|undefined;
    try{
      const stat=await lstat(path);
      if(!stat.isFile()||stat.isSymbolicLink())throw new Error('Migration source must be a regular file');
      local=await readFile(path);
    }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
    if(exists){
      const remote=await readPrivateFile(file.kind,file.key);
      if(local&&digest(local)!==digest(remote))throw new Error('Private file checksum mismatch; refusing to overwrite');
      report.verified++;
    }else if(!local){
      report.missing++;
    }else if(!apply){
      report.pending++;
    }else{
      // Create-only: a rerun or another writer cannot overwrite existing bytes.
      try{await saveAndCommitPrivateFile(file.kind,file.key,local,file.media_type,async()=>{})}
      catch(error){if((error as {code?:number}).code!==412)throw error}
      if(digest(local)!==digest(await readPrivateFile(file.kind,file.key)))throw new Error('Private file checksum mismatch after transfer');
      report.copied++;
      report.verified++;
    }
  }
  return report;
}
