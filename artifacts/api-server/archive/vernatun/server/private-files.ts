import {Storage} from '@google-cloud/storage';
import {ApiError} from './access.js';
import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import {transaction} from './operations.js';

// Replit sidecar authentication, as specified by App Storage. No downloaded keys.
const endpoint='http://127.0.0.1:1106';
const client=new Storage({
  projectId:'',
  credentials:{
    audience:'replit',subject_token_type:'access_token',type:'external_account',
    token_url:`${endpoint}/token`,
    credential_source:{url:`${endpoint}/credential`,format:{type:'json',subject_token_field_name:'access_token'}},
    universe_domain:'googleapis.com',
  },
});
export type FileKind='photos'|'documents';

export const privateKeyPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\.jpg)?$/i;
export function privateStorageLocation(){
  const dir=process.env.PRIVATE_OBJECT_DIR?.replace(/\/+$/,'');
  const match=dir?.match(/^\/([^/]+)\/(.+)$/);
  if(!match)throw new Error('App Storage requires PRIVATE_OBJECT_DIR');
  let namespace='vernatun';
  if(process.env.NODE_ENV==='test'){
    const run=process.env.PRIVATE_FILES_TEST_RUN;
    if(!run||!/^qa_[a-f0-9]{20}$/.test(run))throw new Error('Isolated private file test prefix required');
    namespace=`vernatun-test/${run}`;
  }
  const prefix=`${match[2]}/${namespace}/`;
  return {bucket:client.bucket(match[1]!),prefix,scope:createHash('sha256').update(`${match[1]}/${prefix}`).digest('hex')};
}
function object(kind:FileKind,key:string){
  if(!privateKeyPattern.test(key)){
    throw new Error('Invalid private storage key');
  }
  const {bucket,prefix}=privateStorageLocation();
  return bucket.file(`${prefix}${kind}/${key}`);
}
export function privateFileLockKey(kind:FileKind,key:string){
  return `private-file:${privateStorageLocation().scope}:${kind}:${key}`;
}
// Hold the same database connection and lock from object creation through COMMIT.
// On failure leave the bytes for inventory: a lost COMMIT response is ambiguous,
// and deleting in a catch could destroy a successfully committed upload.
export async function saveAndCommitPrivateFile<T>(kind:FileKind,key:string,body:Buffer,contentType:string,commit:(db:PoolClient)=>Promise<T>){
  return transaction(async db=>{
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[privateFileLockKey(kind,key)]);
    await savePrivateFile(kind,key,body,contentType);
    return commit(db);
  });
}
export async function savePrivateFile(kind:FileKind,key:string,body:Buffer,contentType:string){
  await object(kind,key).save(body,{
    resumable:false,validation:'crc32c',preconditionOpts:{ifGenerationMatch:0},
    metadata:{contentType,cacheControl:'private, no-store'},
  });
}
export async function readPrivateFile(kind:FileKind,key:string):Promise<Buffer>{
  try{return (await object(kind,key).download())[0]}
  catch(error){if((error as {code?:number}).code===404)throw new ApiError(404,'not_found');throw error}
}
export async function deletePrivateFile(kind:FileKind,key:string){
  await object(kind,key).delete({ignoreNotFound:true});
}
export async function privateFileExists(kind:FileKind,key:string){
  return (await object(kind,key).exists())[0];
}
export async function privateFileMetadata(kind:FileKind,key:string){
  return (await object(kind,key).getMetadata())[0];
}
export async function deletePrivateFileVersion(kind:FileKind,key:string,generation:string,metageneration:string){
  await object(kind,key).delete({ifGenerationMatch:generation,ifMetagenerationMatch:metageneration});
}
