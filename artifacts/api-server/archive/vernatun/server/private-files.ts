import {Storage} from '@google-cloud/storage';
import {ApiError} from './access.js';

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

function object(kind:FileKind,key:string){
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\.jpg)?$/i.test(key)){
    throw new Error('Invalid private storage key');
  }
  const dir=process.env.PRIVATE_OBJECT_DIR?.replace(/\/+$/,'');
  const match=dir?.match(/^\/([^/]+)\/(.+)$/);
  if(!match)throw new Error('App Storage requires PRIVATE_OBJECT_DIR');
  const namespace=process.env.NODE_ENV==='test'?'vernatun-test':'vernatun';
  return client.bucket(match[1]!).file(`${match[2]}/${namespace}/${kind}/${key}`);
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
