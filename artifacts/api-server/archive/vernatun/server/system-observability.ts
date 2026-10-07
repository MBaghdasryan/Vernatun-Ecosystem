import {randomUUID} from 'node:crypto';
import type {RequestHandler} from 'express';
import {pool} from './db.js';
import {systemQuery} from './system-query.js';
import {apiBuildId,eventEnvironment,safeErrorStack} from './system-diagnostics.js';

// Deliberately no arbitrary payload, raw stack, URL query, header or body storage.
// This allowlist is the redaction boundary, not a blacklist of known secrets.
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9-]{36}$/i.test(v)?v:null;
export const safeCode=(v:unknown)=>typeof v==='string'&&/^[a-z0-9_]{1,60}$/i.test(v)?v:'internal_error';
let pending=0,dropped=0;
export const logQueue=()=>({pending,dropped});
export async function recordSystemEvent(event:{category:string;event:string;level?:string;requestId?:string;actor?:string;contextId?:string;endpoint?:string;method?:string;status?:number;latency?:number;error?:string;job?:string;exception?:unknown}){
 if(pending>=50){dropped++;return}
 pending++;
 try{
  await systemQuery({text:`INSERT INTO system_log_events(category,level,event,request_id,actor_user_id,organization_id,endpoint,method,http_status,latency_ms,error_code,job,application_version,environment,safe_stack)
  VALUES($1,$2,$3,$4,$5,(SELECT organization_id FROM role_assignments WHERE id=$6 AND user_id=$5),$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
  values:[safeCode(event.category),safeCode(event.level??'info'),safeCode(event.event),uuid(event.requestId),uuid(event.actor),uuid(event.contextId),
   event.endpoint?.slice(0,240)??null,event.method?.slice(0,10)??null,event.status??null,event.latency??null,event.error?safeCode(event.error):null,event.job?safeCode(event.job):null,
   apiBuildId,eventEnvironment,['error','fatal'].includes(event.level??'info')?safeErrorStack(event.exception):null],query_timeout:3000});
 }catch{dropped++}finally{pending--}
}
export const systemRequestLog:RequestHandler=(req,res,next)=>{
 const id=randomUUID(),start=performance.now();res.setHeader('X-Request-ID',id);
 res.on('finish',()=>{
  // Only Express route templates; unknown paths may contain credentials.
  const path=typeof req.route?.path==='string'?req.route.path:'[unmatched]';
  const status=res.statusCode,auth=req.originalUrl.startsWith('/api/auth/')||req.originalUrl.startsWith('/api/mfa/');
  void recordSystemEvent({category:status===401||status===403||status===429?'security':auth?'authentication':'api',
   event:'request_finished',level:status>=500?'error':status>=400?'warning':'info',requestId:id,
   actor:req.user?.id,contextId:req.session?.contextId,endpoint:path,method:req.method,status,
   latency:Math.min(2147483647,Math.round(performance.now()-start)),error:res.locals.systemErrorCode,exception:res.locals.systemException});
 });next();
};
export async function observedJob(job:string,run:()=>Promise<unknown>){
 const id=randomUUID();
 try{await pool.query('INSERT INTO system_job_runs(id,job,status) VALUES($1,$2,\'running\')',[id,job])}catch{
  // Observability failure must not stop existing maintenance.
  dropped++;
 }
 const heartbeat=setInterval(()=>{void pool.query('UPDATE system_job_runs SET heartbeat_at=now() WHERE id=$1',[id]).catch(()=>{dropped++})},30000);heartbeat.unref();
 await recordSystemEvent({category:'job',event:'job_started',job});
 try{
  await run();
  await pool.query("UPDATE system_job_runs SET status='completed',finished_at=now(),heartbeat_at=now() WHERE id=$1",[id]).catch(()=>{dropped++});
  await recordSystemEvent({category:'job',event:'job_completed',job});
 }catch(e){
  const error=safeCode((e as {code?:unknown}).code);
  await pool.query("UPDATE system_job_runs SET status='failed',finished_at=now(),error_code=$2 WHERE id=$1",[id,error]).catch(()=>{dropped++});
  await recordSystemEvent({category:'job',event:'job_failed',level:'error',job,error,exception:e});throw e;
 }finally{clearInterval(heartbeat)}
}
