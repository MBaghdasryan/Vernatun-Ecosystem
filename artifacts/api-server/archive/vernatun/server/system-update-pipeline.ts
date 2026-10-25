import {createHash,randomBytes} from 'node:crypto';

export type ReleaseAction='deploy'|'rollback';
export type ReleasePipelineConfiguration={endpoint:URL;token:string;callbackBase:URL};
export type ReleaseDispatchResult=
 |{kind:'accepted'}
 |{kind:'rejected'}
 |{kind:'unknown'};

function safeUrl(value:string|undefined){
 if(!value)return null;
 try{
  const url=new URL(value);
  if(url.username||url.password||url.hash||url.search)return null;
  const localTest=process.env.NODE_ENV==='test'&&['127.0.0.1','localhost'].includes(url.hostname);
  return url.protocol==='https:'||localTest?url:null;
 }catch{return null}
}

export function releasePipelineConfiguration():ReleasePipelineConfiguration|null{
 const endpoint=safeUrl(process.env.VERNATUN_RELEASE_PIPELINE_URL),
  callbackBase=safeUrl(process.env.VERNATUN_RELEASE_CALLBACK_URL),
  token=process.env.VERNATUN_RELEASE_PIPELINE_TOKEN;
 if(!endpoint||!callbackBase||!token||token.length<32)return null;
 return {endpoint,token,callbackBase};
}

export function releaseCallbackToken(){
 const value=randomBytes(32).toString('hex');
 return {value,hash:createHash('sha256').update(value).digest('hex')};
}

export function releaseCallbackUrl(base:URL,updateId:string){
 const url=new URL(base.toString());
 url.pathname=`${url.pathname.replace(/\/+$/,'')}/${encodeURIComponent(updateId)}/pipeline-result`;
 return url.toString();
}

export async function sendReleaseToPipeline(input:{
 action:ReleaseAction;jobId:string;updateId:string;callbackToken:string;callbackUrl:string;
 packageBytes?:Buffer;version:string|null;checksum:string;backupId:string;schemaVersion:string;
 databaseMigrationRequired:boolean;currentReleaseRef?:string|null;targetReleaseRef?:string|null;
}):Promise<ReleaseDispatchResult>{
 const config=releasePipelineConfiguration();
 if(!config)return {kind:'rejected'};
 const headers:Record<string,string>={
  Authorization:`Bearer ${config.token}`,
  'Content-Type':input.packageBytes?'application/zip':'application/json',
  'Idempotency-Key':input.jobId,
  'X-Vernatun-Action':input.action,
  'X-Vernatun-Update-Id':input.updateId,
  'X-Vernatun-Job-Id':input.jobId,
  'X-Vernatun-Callback-Url':input.callbackUrl,
  'X-Vernatun-Callback-Token':input.callbackToken,
  'X-Vernatun-Artifact-SHA256':input.checksum,
  'X-Vernatun-Backup-Id':input.backupId,
  'X-Vernatun-Schema-Version':input.schemaVersion,
 };
 let body:Buffer|string;
 if(input.packageBytes){
  headers['X-Vernatun-Version']=input.version??'';
  headers['X-Vernatun-Migrations-Required']=String(input.databaseMigrationRequired);
  body=input.packageBytes;
 }else{
  body=JSON.stringify({updateId:input.updateId,jobId:input.jobId,targetReleaseRef:input.targetReleaseRef,
   currentReleaseRef:input.currentReleaseRef,backupId:input.backupId,schemaVersion:input.schemaVersion,
   artifactChecksum:input.checksum});
 }
 try{
  const response=await fetch(config.endpoint,{method:'POST',headers,body,redirect:'error',signal:AbortSignal.timeout(20_000)});
  if(response.status>=400&&response.status<500)return {kind:'rejected'};
  if(response.status!==202)return {kind:'unknown'};
  const reader=response.body?.getReader();
  if(!reader)return {kind:'unknown'};
  const chunks:Uint8Array[]=[];let size=0;
  try{
   while(true){
    const {done,value}=await reader.read();if(done)break;
    size+=value.length;if(size>4096){await reader.cancel();return {kind:'unknown'}}
    chunks.push(value);
   }
  }finally{reader.releaseLock()}
  const result=JSON.parse(Buffer.concat(chunks).toString('utf8')) as {jobId?:unknown};
  return result.jobId===input.jobId?{kind:'accepted'}:{kind:'unknown'};
 }catch{return {kind:'unknown'}}
}

