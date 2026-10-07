import {Router,type Request} from 'express';
import {z} from 'zod';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {isIP} from 'node:net';
import {pool} from './db.js';
import {ApiError} from './access.js';
import {requireRecentAuthentication} from './recent-auth.js';
import {rateLimit} from 'express-rate-limit';
import {PostgresRateStore} from './rate-limit.js';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parseDocument} from 'yaml';
import {sourceRoot} from './operations-backups.js';
import {subscriptionPolicy} from './subscription-policy.js';

export async function apiDocument(){
 const raw=await readFile(resolve(await sourceRoot(),'lib/api-spec/openapi.yaml'),'utf8');
 const doc=parseDocument(raw,{uniqueKeys:true});
 if(doc.errors.length)throw new ApiError(503,'openapi_invalid');
 const value=doc.toJSON();const ids=new Set<string>();
 for(const path of Object.values(value.paths??{}) as any[])for(const [method,op] of Object.entries(path) as [string,any][]){
  if(!['get','post','patch','put','delete','head','options'].includes(method))continue;
  if(!op.operationId||ids.has(op.operationId))throw new ApiError(503,'openapi_invalid');
  ids.add(op.operationId);
 }
 const check=(x:any)=>{if(!x||typeof x!=='object')return;
  if(x.$ref){if(!x.$ref.startsWith('#/'))throw new ApiError(503,'openapi_external_ref_disabled');
   const found=x.$ref.slice(2).split('/').reduce((v:any,k:string)=>v?.[k.replace(/~1/g,'/').replace(/~0/g,'~')],value);
   if(!found)throw new ApiError(503,'openapi_invalid');
  }
  for(const child of Object.values(x))check(child);
 };check(value);return value;
}

export const externalScopes=['platform.health.read','properties.read','units.read','requests.read'] as const;
const scopes=z.array(z.enum(externalScopes)).min(1).max(4).refine(a=>new Set(a).size===a.length);
const clientInput=z.object({name:z.string().trim().min(2).max(100),description:z.string().max(500).default(''),
 organizationId:z.string().uuid().nullable(),clientType:z.enum(['platform','organization','integration','machine_to_machine']),
 allowedScopes:scopes,allowedIps:z.array(z.string().refine(s=>isIP(s)!==0)).max(20).default([]),confirmation:z.literal('API CLIENT')}).strict();
const keyInput=z.object({name:z.string().trim().min(2).max(100),scopes,
 expiresAt:z.string().datetime().refine(s=>Date.parse(s)>Date.now()&&Date.parse(s)<=Date.now()+366*86400000),
 requestsPerMinute:z.number().int().min(1).max(300),confirmation:z.literal('API KEY')}).strict();
const clientColumns=`id,organization_id AS "organizationId",name,description,client_type AS "clientType",status,
 allowed_scopes AS "allowedScopes",allowed_ips AS "allowedIps",created_at AS "createdAt",last_used_at AS "lastUsedAt"`;
const keyColumns=`id,client_id AS "clientId",name,prefix,scopes,expires_at AS "expiresAt",revoked_at AS "revokedAt",
 last_used_at AS "lastUsedAt",requests_per_minute AS "requestsPerMinute",created_at AS "createdAt"`;
export function registerApiCenter(router:Router,permit:(req:Request,p:string)=>Promise<unknown>){
 router.get('/system/api/docs',async(req,res)=>{await permit(req,'api.read');res.json(await apiDocument())});
 router.get('/system/api',async(req,res)=>{
  await permit(req,'api.read');
  const page=z.coerce.number().int().min(1).max(10000).default(1).parse(req.query.page);
  const clients=await pool.query(`SELECT ${clientColumns},count(*) OVER()::int AS total FROM api_clients ORDER BY created_at DESC LIMIT 50 OFFSET $1`,[(page-1)*50]);
  const keys=await pool.query(`SELECT ${keyColumns} FROM api_keys WHERE client_id=ANY($1::uuid[]) ORDER BY created_at DESC`,[clients.rows.map(r=>r.id)]);
  res.json({scopes:externalScopes,clients:clients.rows,keys:keys.rows,page,pageSize:50,total:clients.rows[0]?.total??0});
 });
 router.post('/system/api/clients',async(req,res)=>{
  await permit(req,'api.read');await permit(req,'api.clients.manage');requireRecentAuthentication(req);
  const x=clientInput.parse(req.body);
  if(x.allowedScopes.some(s=>s!=='platform.health.read')&&!x.organizationId)throw new ApiError(400,'api_organization_required');
  const db=await pool.connect();
  try{await db.query('BEGIN');
   const row=(await db.query(`INSERT INTO api_clients(name,description,organization_id,client_type,allowed_scopes,allowed_ips,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING ${clientColumns}`,[x.name,x.description,x.organizationId,x.clientType,x.allowedScopes,x.allowedIps,req.user!.id])).rows[0];
   await db.query("INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id) VALUES($1,'system.api.client.created','api_client',$2)",[req.user!.id,row.id]);
   await db.query('COMMIT');res.status(201).json(row);
  }catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
 });
 router.patch('/system/api/clients/:id',async(req,res)=>{
  await permit(req,'api.read');await permit(req,'api.clients.manage');requireRecentAuthentication(req);
  const id=z.string().uuid().parse(req.params.id);
  const x=z.object({status:z.enum(['active','disabled']),confirmation:z.literal('API CLIENT')}).strict().parse(req.body);
  const db=await pool.connect();
  try{await db.query('BEGIN');const r=await db.query(`UPDATE api_clients SET status=$2 WHERE id=$1 RETURNING ${clientColumns}`,[id,x.status]);
   if(!r.rowCount)throw new ApiError(404,'api_client_not_found');
   await db.query("INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,details) VALUES($1,'system.api.client.status','api_client',$2,$3)",[req.user!.id,id,JSON.stringify({status:x.status})]);
   await db.query('COMMIT');res.json(r.rows[0]);
  }catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
 });
 router.post('/system/api/clients/:id/keys',async(req,res)=>{
  await permit(req,'api.read');await permit(req,'api.keys.manage');requireRecentAuthentication(req);
  const client=z.string().uuid().parse(req.params.id),x=keyInput.parse(req.body);
  const db=await pool.connect();try{
   await db.query('BEGIN');const c=(await db.query('SELECT * FROM api_clients WHERE id=$1 FOR UPDATE',[client])).rows[0];
   if(!c||c.status!=='active')throw new ApiError(409,'api_client_inactive');
   if(x.scopes.some(s=>!c.allowed_scopes.includes(s)))throw new ApiError(400,'api_scope_not_allowed');
   if(Number((await db.query('SELECT count(*) AS n FROM api_keys WHERE client_id=$1 AND revoked_at IS NULL',[client])).rows[0].n)>=20)throw new ApiError(409,'api_key_limit');
   const id=randomUUID(),secret='vnt_'+randomBytes(8).toString('hex')+'_'+randomBytes(32).toString('base64url');
   const row=(await db.query(`INSERT INTO api_keys(id,client_id,name,prefix,key_hash,scopes,expires_at,requests_per_minute,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${keyColumns}`,[id,client,x.name,secret.slice(0,20),createHash('sha256').update(secret).digest('hex'),x.scopes,x.expiresAt,x.requestsPerMinute,req.user!.id])).rows[0];
   await db.query("INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id) VALUES($1,'system.api.key.created','api_key',$2)",[req.user!.id,id]);
   await db.query('COMMIT');res.set('Cache-Control','no-store').status(201).json({...row,secret});
  }catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
 });
 router.post('/system/api/keys/:id/:action',async(req,res)=>{
  await permit(req,'api.read');await permit(req,'api.keys.manage');requireRecentAuthentication(req);
  const id=z.string().uuid().parse(req.params.id),action=z.enum(['revoke','rotate']).parse(req.params.action);
  z.object({confirmation:z.literal('API KEY')}).strict().parse(req.body);
  const db=await pool.connect();try{
   await db.query('BEGIN');
   const key=(await db.query('SELECT * FROM api_keys WHERE id=$1 FOR UPDATE',[id])).rows[0];
   if(!key)throw new ApiError(404,'api_key_not_found');
   let fresh:any=null,secret:string|undefined;
   if(action==='rotate'){
    const c=(await db.query('SELECT * FROM api_clients WHERE id=$1 FOR SHARE',[key.client_id])).rows[0];
    if(key.revoked_at||new Date(key.expires_at).getTime()<=Date.now()||c.status!=='active')throw new ApiError(409,'api_key_inactive');
    secret='vnt_'+randomBytes(8).toString('hex')+'_'+randomBytes(32).toString('base64url');
    fresh=(await db.query(`INSERT INTO api_keys(client_id,name,prefix,key_hash,scopes,expires_at,requests_per_minute,created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${keyColumns}`,[key.client_id,key.name,secret.slice(0,20),createHash('sha256').update(secret).digest('hex'),key.scopes,key.expires_at,key.requests_per_minute,req.user!.id])).rows[0];
   }
   await db.query('UPDATE api_keys SET revoked_at=coalesce(revoked_at,now()) WHERE id=$1',[id]);
   await db.query("INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id) VALUES($1,$2,'api_key',$3)",[req.user!.id,'system.api.key.'+action,id]);
   await db.query('COMMIT');res.json(fresh?{...fresh,secret}:{id,revoked:true});
  }catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
 });
}

export const externalApi=Router();
externalApi.use(rateLimit({windowMs:60000,limit:300,store:new PostgresRateStore('external-api-ip'),standardHeaders:'draft-7',legacyHeaders:false}));
externalApi.use(async(req,res,next)=>{
 const token=req.get('Authorization')?.match(/^Bearer (vnt_[a-f0-9]{16}_[A-Za-z0-9_-]{43})$/)?.[1];
 if(!token)throw new ApiError(401,'api_key_required');
 const k=(await pool.query(`SELECT k.id,k.scopes,k.requests_per_minute,c.organization_id,c.allowed_ips,c.id AS client_id
  FROM api_keys k JOIN api_clients c ON c.id=k.client_id WHERE k.key_hash=$1 AND k.revoked_at IS NULL
  AND k.expires_at>now() AND c.status='active'`,[createHash('sha256').update(token).digest('hex')])).rows[0];
 if(!k)throw new ApiError(401,'api_key_invalid');
 if(k.allowed_ips.length&&!k.allowed_ips.includes(req.ip))throw new ApiError(403,'api_ip_denied');
 res.locals.apiKey=k;next();
});
externalApi.use(rateLimit({windowMs:60000,limit:(_req,res)=>res.locals.apiKey.requests_per_minute,
 keyGenerator:(_req,res)=>res.locals.apiKey.id,store:new PostgresRateStore('external-api-key'),standardHeaders:'draft-7',legacyHeaders:false}));
externalApi.get('/health',async(req,res)=>{
 const k=res.locals.apiKey;if(!k.scopes.includes('platform.health.read'))throw new ApiError(403,'api_scope_required');
 await pool.query('UPDATE api_keys SET last_used_at=now() WHERE id=$1',[k.id]);res.json({status:'responding',version:'v1'});
});
for(const resource of ['properties','units','requests'] as const)externalApi.get('/'+resource,async(req,res)=>{
 const k=res.locals.apiKey;if(!k.scopes.includes(resource+'.read'))throw new ApiError(403,'api_scope_required');
 if(!k.organization_id)throw new ApiError(403,'api_organization_required');
 const page=z.coerce.number().int().min(1).max(10000).default(1).parse(req.query.page);
 const sql=resource==='properties'?'SELECT id,name,address FROM buildings WHERE organization_id=$1 ORDER BY id LIMIT 50 OFFSET $2':
  resource==='units'?'SELECT u.id,u.building_id,u.number FROM units u JOIN buildings b ON b.id=u.building_id WHERE b.organization_id=$1 ORDER BY u.id LIMIT 50 OFFSET $2':
  'SELECT id,subject,status,created_at FROM resident_requests WHERE organization_id=$1 ORDER BY id LIMIT 50 OFFSET $2';
 if(resource==='requests'&&!(await subscriptionPolicy(k.organization_id)).modules.includes('requests'))throw new ApiError(403,'module_disabled');
 const r=await pool.query(sql,[k.organization_id,(page-1)*50]);
 await pool.query('UPDATE api_keys SET last_used_at=now() WHERE id=$1',[k.id]);
 await pool.query('UPDATE api_clients SET last_used_at=now() WHERE id=$1',[k.client_id]);
 res.json({items:r.rows,page,pageSize:50,organizationId:k.organization_id});
});
