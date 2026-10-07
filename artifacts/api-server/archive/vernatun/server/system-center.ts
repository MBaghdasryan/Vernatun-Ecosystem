import {Router,type Request} from 'express';
import {z} from 'zod';
import {pool,audit} from './db.js';
import {ApiError,requirePermission,requireAuth} from './access.js';
import {rateLimit} from 'express-rate-limit';
import {PostgresRateStore} from './rate-limit.js';
import {config} from './config.js';
import {logQueue} from './system-observability.js';
import {systemQuery} from './system-query.js';
import {emailProviderState} from './email.js';
import {storageMode} from './storage-providers.js';
import {registerSystemErrors} from './system-errors.js';
import {apiBuildId} from './system-diagnostics.js';
import {emailHealthMetrics} from './system-email-health.js';
import {privateStorageHealth} from './private-files.js';
import {cachedStorageHealth} from './operations-cache.js';
import {registerSystemTools} from './system-tools.js';
import {registerSystemSessions} from './system-sessions.js';
import {registerSystemRetention} from './system-retention.js';
import {registerSystemBackups} from './system-backups.js';
import {backupHealthMetrics} from './system-backup-health.js';
import {registerBackupPolicies} from './system-backup-policies.js';
import {registerApiCenter} from './system-api.js';
import {registerIntegrations} from './system-integrations.js';
import {registerWebhooks} from './system-webhooks.js';

export const systemCenter=Router();
systemCenter.use('/system',requireAuth,rateLimit({windowMs:60000,limit:120,store:new PostgresRateStore('system-read'),keyGenerator:req=>req.user!.id,standardHeaders:'draft-7',legacyHeaders:false,message:{error:'rate_limited'}}));
const startedAt=new Date(Date.now()-process.uptime()*1000).toISOString();
async function permit(req:Request,p:string){
 const c=await requirePermission(req,p);
 if(c.organization_id||c.building_id||c.unit_id||!['platform_admin','support','platform_engineer'].includes(c.role_key))throw new ApiError(403,'platform_scope_required');
 return c;
}
type Metric={key:string;value:string|null;status:'healthy'|'degraded'|'down'|'unavailable'|'not_configured'};
async function overview(){
 const metrics:Metric[]=[
  {key:'environment',value:config.NODE_ENV,status:'healthy'},
  {key:'node',value:process.version,status:'healthy'},
  {key:'uptime_seconds',value:String(Math.floor(process.uptime())),status:'healthy'},
  {key:'started_at',value:startedAt,status:'healthy'},
  {key:'api',value:'responding',status:'healthy'},
  {key:'build_version',value:apiBuildId,status:apiBuildId?'healthy':'unavailable'},
  ...['application_version','frontend_version','git_commit','integrations'].map(key=>({key,value:null,status:'unavailable' as const})),
  {key:'cache',value:'memory · storage-health',status:'healthy'},
  {key:'pool_total',value:String(pool.totalCount),status:'healthy'},
  {key:'pool_idle',value:String(pool.idleCount),status:'healthy'},
  {key:'pool_waiting',value:String(pool.waitingCount),status:pool.waitingCount?'degraded':'healthy'},
  {key:'log_events_dropped',value:String(logQueue().dropped),status:logQueue().dropped?'degraded':'healthy'},
 ];
 try{const email=emailProviderState();metrics.push({key:'email_configuration',value:email,status:email==='not_configured'?'not_configured':'healthy'});
 metrics.push({key:'email_delivery_probe',value:null,status:'unavailable'})}
 catch{metrics.push({key:'email_configuration',value:null,status:'unavailable'})}
 try{metrics.push({key:'storage_provider',value:storageMode(),status:'healthy'})}
 catch{metrics.push({key:'storage_provider',value:null,status:'unavailable'})}
 try{
  const r=await systemQuery({text:`SELECT current_setting('server_version') AS version,pg_database_size(current_database())::text AS bytes,
  (SELECT max(name) FROM schema_migrations) AS migration`,query_timeout:3000});
  metrics.push({key:'database',value:r.rows[0].version,status:'healthy'},{key:'database_bytes',value:r.rows[0].bytes,status:'healthy'},
   {key:'migration',value:r.rows[0].migration,status:'healthy'});
 }catch{metrics.push({key:'database',value:null,status:'down'})}
 try{
  const r=await systemQuery({text:`SELECT count(*) FILTER(WHERE status='running' AND heartbeat_at>now()-interval '2 minutes')::int AS running,
   count(*) FILTER(WHERE status='failed')::int AS failed,
   count(*) FILTER(WHERE status='running' AND heartbeat_at<=now()-interval '2 minutes')::int AS interrupted FROM system_job_runs
   WHERE started_at>now()-interval '24 hours'`,query_timeout:3000});
  metrics.push(...['running','failed','interrupted'].map(key=>({key:'jobs_'+key,value:String(r.rows[0][key]),status:key!=='running'&&r.rows[0][key]>0?'degraded' as const:'healthy' as const})));
 }catch{metrics.push({key:'jobs',value:null,status:'unavailable'})}
 metrics.push(...await emailHealthMetrics());
 metrics.push(...await backupHealthMetrics());
 metrics.push({key:'storage',...await cachedStorageHealth(privateStorageHealth)});
 return {observedAt:new Date().toISOString(),status:metrics.some(m=>m.status==='down')?'critical':metrics.some(m=>m.status==='degraded'||m.status==='unavailable'||m.status==='not_configured')?'warning':'healthy',metrics};
}
systemCenter.get('/system/overview',async(req,res)=>{await permit(req,'system.read');res.json(await overview())});
systemCenter.get('/system/health',async(req,res)=>{await permit(req,'system.health.read');res.json(await overview())});
registerSystemErrors(systemCenter,permit);
registerSystemTools(systemCenter,permit);
registerSystemSessions(systemCenter,permit);
registerSystemRetention(systemCenter,permit);
registerSystemBackups(systemCenter,permit);
registerBackupPolicies(systemCenter,permit);
registerApiCenter(systemCenter,permit);
registerIntegrations(systemCenter,permit);
registerWebhooks(systemCenter,permit);
const query=z.object({
 page:z.coerce.number().int().min(1).max(10000).default(1),from:z.string().datetime().optional(),to:z.string().datetime().optional(),
 level:z.enum(['info','warning','error','fatal']).optional(),
 category:z.enum(['api','authentication','security','job','system','application','database','email','integration']).optional(),
 user:z.string().uuid().optional(),organization:z.string().uuid().optional(),requestId:z.string().uuid().optional(),
 status:z.coerce.number().int().min(100).max(599).optional(),endpoint:z.string().max(240).optional(),
 errorCode:z.string().max(60).optional(),job:z.string().max(60).optional(),q:z.string().max(100).optional(),
}).strict();
function logFilters(f:z.infer<typeof query>){
 const values:unknown[]=[],where:string[]=[];
 if(f.from&&f.to&&Date.parse(f.from)>Date.parse(f.to))throw new ApiError(400,'invalid_date_range');
 const add=(column:string,value:unknown,op='=')=>{if(value!==undefined){values.push(value);where.push(`${column} ${op} $${values.length}`)}};
 add('created_at',f.from,'>=');add('created_at',f.to,'<=');add('level',f.level);add('category',f.category);
 add('actor_user_id',f.user);add('organization_id',f.organization);add('request_id',f.requestId);add('http_status',f.status);
 add('endpoint',f.endpoint);add('error_code',f.errorCode);add('job',f.job);
 if(f.q){values.push('%'+f.q.replace(/[\\%_]/g,'\\$&')+'%');where.push(`concat_ws(' ',event,endpoint,error_code,job,id::text) ILIKE $${values.length}`)}
 return {values,where:where.length?'WHERE '+where.join(' AND '):''};
}
const logColumns=`id::text,created_at AS "createdAt",category,level,service,event,request_id AS "requestId",
 actor_user_id AS "actorId",organization_id AS "organizationId",endpoint,method,http_status AS status,latency_ms AS "latencyMs",
 error_code AS "errorCode",job,application_version AS "applicationVersion",environment,safe_stack AS "stackTrace"`;
systemCenter.get('/system/logs',async(req,res)=>{
 await permit(req,'logs.read');const f=query.parse(req.query),{values,where}=logFilters(f);
 values.push((f.page-1)*50);
 const r=await pool.query(`SELECT ${logColumns} FROM system_log_events ${where}
 ORDER BY created_at DESC,id DESC LIMIT 51 OFFSET $${values.length}`,values);
 res.json({page:f.page,hasMore:r.rows.length>50,items:r.rows.slice(0,50)});
});
const exportInput=query.omit({page:true}).extend({format:z.enum(['json','csv']),from:z.string().datetime(),to:z.string().datetime()}).strict();
const exportLimit=rateLimit({windowMs:60000,limit:5,store:new PostgresRateStore('system-log-export'),keyGenerator:req=>req.user!.id,standardHeaders:'draft-7',legacyHeaders:false,message:{error:'rate_limited'}});
// CSV escaping also prevents spreadsheet formula execution, including whitespace prefixes.
export function logCsvCell(value:unknown){
 let text=value instanceof Date?value.toISOString():value==null?'':String(value);
 if(/^[\s\u0000-\u001f]*[=+\-@]/.test(text)||/^[\t\r\n]/.test(text))text="'"+text;
 return '"'+text.replace(/"/g,'""')+'"';
}
systemCenter.post('/system/log-exports',async(req,_res,next)=>{
 await permit(req,'logs.read');await permit(req,'logs.export');next();
},exportLimit,async(req,res)=>{
 const f=exportInput.parse(req.body);
 if(Date.parse(f.to)-Date.parse(f.from)>31*86400000)throw new ApiError(400,'export_range_too_large');
 const {values,where}=logFilters({...f,page:1});
 const r=await systemQuery({text:`SELECT ${logColumns} FROM system_log_events ${where} ORDER BY created_at DESC,id DESC LIMIT 5001`,values,query_timeout:5000});
 if(r.rows.length>5000)throw new ApiError(413,'export_too_large');
 const columns=['id','createdAt','category','level','service','event','requestId','actorId','organizationId','endpoint','method','status','latencyMs','errorCode','job','applicationVersion','environment','stackTrace'];
 const content=f.format==='json'?JSON.stringify(r.rows,null,2):
  '\uFEFF'+[columns.map(logCsvCell).join(','),...r.rows.map(row=>columns.map(c=>logCsvCell(row[c])).join(','))].join('\r\n')+'\r\n';
 if(Buffer.byteLength(content,'utf8')>5*1024*1024)throw new ApiError(413,'export_too_large');
 // Fail closed: no export is returned unless its immutable audit entry is written.
 // Do not copy free-text search input or downloaded records into business audit.
 await audit(req.user!.id,null,'system.logs.export','system_logs',null,{format:f.format,from:f.from,to:f.to,rows:r.rows.length,filterKeys:Object.keys(f).filter(k=>!['format','from','to'].includes(k))});
 res.setHeader('Cache-Control','no-store');
 res.json({filename:`vernatun-logs-${new Date().toISOString().replace(/[:.]/g,'-')}.${f.format}`,
  contentType:f.format==='json'?'application/json;charset=utf-8':'text/csv;charset=utf-8',content,rows:r.rows.length});
});
systemCenter.get('/system/jobs',async(req,res)=>{
 await permit(req,'jobs.read');const f=z.object({page:z.coerce.number().int().min(1).max(10000).default(1)}).strict().parse(req.query);
 const r=await pool.query(`SELECT id,job,started_at AS "startedAt",finished_at AS "finishedAt",heartbeat_at AS "heartbeatAt",
 CASE WHEN status='running' AND heartbeat_at<now()-interval '2 minutes' THEN 'interrupted' ELSE status END AS status,error_code AS "errorCode"
 FROM system_job_runs ORDER BY started_at DESC,id DESC LIMIT 51 OFFSET $1`,[(f.page-1)*50]);
 res.json({page:f.page,hasMore:r.rows.length>50,items:r.rows.slice(0,50)});
});
