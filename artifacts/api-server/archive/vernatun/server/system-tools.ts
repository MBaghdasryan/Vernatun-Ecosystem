import type {Router,Request} from 'express';
import {z} from 'zod';
import {audit} from './db.js';
import {config} from './config.js';
import {storageMode} from './storage-providers.js';
import {emailProviderState} from './email.js';
import {operationsCache,clearHealthCache} from './operations-cache.js';
import {requireRecentAuthentication} from './recent-auth.js';
import {operationsEncryptionState} from './operations-encryption.js';

export function registerSystemTools(router:Router,permit:(req:Request,p:string)=>Promise<unknown>){
 router.get('/system/environment',async(req,res)=>{
  await permit(req,'environment.read');
  // Fixed allowlist: never enumerate process.env or expose values of secrets.
  const provider=(load:()=>string)=>{try{return load()}catch{return 'unavailable'}};
  const metrics=[
   {key:'environment',value:config.NODE_ENV},{key:'node',value:process.version},
   {key:'database_engine',value:'PostgreSQL'},{key:'storage_provider',value:provider(storageMode)},
   {key:'email_configuration',value:provider(emailProviderState)},{key:'cache_provider',value:'memory'},
   {key:'redis_configuration',value:'not_configured'},
   {key:'session_secret',value:config.SESSION_SECRET?'configured':'not_configured'},
   {key:'email_webhook_secret',value:process.env.RESEND_WEBHOOK_SECRET?'configured':'not_configured'},
   {key:'operations_encryption',value:operationsEncryptionState()},
  ].map(m=>({...m,status:m.value==='not_configured'?'not_configured':m.value==='unavailable'?'unavailable':'healthy'}));
  res.json({observedAt:new Date().toISOString(),status:metrics.some(m=>m.status!=='healthy')?'warning':'healthy',metrics});
 });
 router.get('/system/cache',async(req,res)=>{
  await permit(req,'cache.read');
  res.json({provider:'memory',scope:'process',redisConfigured:false,namespaces:[
   {name:'storage-health',scope:'global',entries:operationsCache.count('storage-health'),ttlSeconds:60},
  ]});
 });
 router.post('/system/cache/clear',async(req,res)=>{
  await permit(req,'cache.read');await permit(req,'cache.clear');requireRecentAuthentication(req);
  const b=z.object({namespace:z.enum(['storage-health','all']),confirmation:z.literal('CLEAR CACHE')}).strict().parse(req.body);
  // Fail closed before changing the cache when audit persistence is unavailable.
  await audit(req.user!.id,null,'system.cache.clear.request','cache',null,{namespace:b.namespace,scope:'process'});
  const start=performance.now(),count=await clearHealthCache();
  await audit(req.user!.id,null,'system.cache.clear.completed','cache',null,{namespace:b.namespace,count,scope:'process'});
  res.json({count,durationMs:Math.round(performance.now()-start),scope:'process'});
 });
}
