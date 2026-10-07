import type {Router,Request} from 'express';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {pool} from './db.js';
import {ApiError} from './access.js';
import {requireRecentAuthentication} from './recent-auth.js';
import {integrationProvider,providerCatalog} from './integration-providers.js';
import {operationsCipher} from './operations-encryption.js';
const cols=`id,provider,organization_id AS "organizationId",display_name AS "displayName",environment,config,enabled,status,revision,
 encrypted_credentials IS NOT NULL AS "credentialsConfigured",last_check_at AS "lastCheckAt",last_error AS "lastError",created_at AS "createdAt"`;
export function registerIntegrations(router:Router,permit:(req:Request,p:string)=>Promise<unknown>){
 router.get('/system/integrations',async(req,res)=>{
  await permit(req,'integrations.read');
  const page=z.coerce.number().int().min(1).max(10000).default(1).parse(req.query.page);
  const rows=await pool.query(`SELECT ${cols},count(*) OVER()::int AS total FROM integration_instances ORDER BY created_at DESC LIMIT 50 OFFSET $1`,[(page-1)*50]);
  res.json({providers:providerCatalog(),instances:rows.rows,page,pageSize:50,total:rows.rows[0]?.total??0});
 });
 router.post('/system/integrations',async(req,res)=>{
  await permit(req,'integrations.read');await permit(req,'integrations.manage');requireRecentAuthentication(req);
  const x=z.object({provider:z.literal('smtp'),organizationId:z.string().uuid().nullable(),displayName:z.string().trim().min(2).max(100),
   environment:z.enum(['sandbox','production']),config:z.unknown(),credentials:z.unknown(),confirmation:z.literal('INTEGRATION')}).strict().parse(req.body);
  const p=integrationProvider(x.provider)!,configuration=p.configurationSchema.parse(x.config),credentials=p.credentialSchema.parse(x.credentials);
  const id=randomUUID(),sealed=operationsCipher().seal(Buffer.from(JSON.stringify(credentials)),'integration:'+id);
  const db=await pool.connect();try{await db.query('BEGIN');
   await db.query(`INSERT INTO integration_instances(id,provider,organization_id,display_name,environment,config,encrypted_credentials,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[id,x.provider,x.organizationId,x.displayName,x.environment,configuration,sealed,req.user!.id]);
   await db.query("INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id) VALUES($1,'system.integration.created','integration',$2)",[req.user!.id,id]);
   await db.query('COMMIT');res.status(201).json({id});
  }catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
 });
 router.put('/system/integrations/:id',async(req,res)=>{
  await permit(req,'integrations.read');await permit(req,'integrations.manage');requireRecentAuthentication(req);
  const id=z.string().uuid().parse(req.params.id);
  const x=z.object({displayName:z.string().trim().min(2).max(100),config:z.unknown(),credentials:z.unknown().optional(),revision:z.number().int().positive(),confirmation:z.literal('INTEGRATION')}).strict().parse(req.body);
  const db=await pool.connect();try{await db.query('BEGIN');
   const row=(await db.query('SELECT * FROM integration_instances WHERE id=$1 FOR UPDATE',[id])).rows[0];
   if(!row)throw new ApiError(404,'integration_not_found');
   if(row.revision!==x.revision)throw new ApiError(409,'integration_changed');
   const p=integrationProvider(row.provider);if(!p)throw new ApiError(409,'provider_required');
   const cfg=p.configurationSchema.parse(x.config);
   const sealed=x.credentials===undefined?row.encrypted_credentials:operationsCipher().seal(Buffer.from(JSON.stringify(p.credentialSchema.parse(x.credentials))),'integration:'+id);
   await db.query(`UPDATE integration_instances SET display_name=$2,config=$3,encrypted_credentials=$4,revision=revision+1,
    enabled=false,status='not_configured',checked_revision=NULL,last_error=NULL,updated_at=now() WHERE id=$1`,[id,x.displayName,cfg,sealed]);
   await db.query("INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id) VALUES($1,'system.integration.updated','integration',$2)",[req.user!.id,id]);
   await db.query('COMMIT');res.json({id});
  }catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
 });
 router.post('/system/integrations/:id/:action',async(req,res)=>{
  await permit(req,'integrations.read');
  const id=z.string().uuid().parse(req.params.id),action=z.enum(['test','activate','deactivate','delete']).parse(req.params.action);
  await permit(req,action==='test'?'integrations.test':'integrations.manage');requireRecentAuthentication(req);
  const x=z.object({revision:z.number().int().positive(),confirmation:z.literal('INTEGRATION')}).strict().parse(req.body);
  const db=await pool.connect();try{await db.query('BEGIN');
   const row=(await db.query('SELECT * FROM integration_instances WHERE id=$1 FOR UPDATE',[id])).rows[0];
   if(!row)throw new ApiError(404,'integration_not_found');
   if(row.revision!==x.revision)throw new ApiError(409,'integration_changed');
   const p=integrationProvider(row.provider);if(!p&&action!=='delete')throw new ApiError(409,'provider_required');
   let status='disabled';
   if(action==='delete'){await db.query('DELETE FROM integration_instances WHERE id=$1',[id]);status='deleted'}
   else if(action==='test'){
    const credentials=JSON.parse(operationsCipher().open(row.encrypted_credentials,'integration:'+id).toString('utf8'));
    status=await p!.testConnection(row.config,credentials);
    await db.query(`UPDATE integration_instances SET status=$2,last_check_at=now(),last_error=$3,checked_revision=revision,
     enabled=CASE WHEN $2='connected' THEN enabled ELSE false END WHERE id=$1`,[id,status,status==='connected'?null:status]);
   }else{
    if(action==='activate'&&(row.checked_revision!==row.revision||row.status!=='connected'||Date.now()-new Date(row.last_check_at).getTime()>300000))throw new ApiError(409,'recent_connection_test_required');
    await db.query('UPDATE integration_instances SET enabled=$2,status=$3,revision=revision+1,updated_at=now() WHERE id=$1',[id,action==='activate',action==='activate'?'connected':'disabled']);
    status=action==='activate'?'connected':'disabled';
   }
   await db.query("INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,details) VALUES($1,$2,'integration',$3,$4)",[req.user!.id,'system.integration.'+action,id,JSON.stringify({status})]);
   await db.query('COMMIT');res.json({id,status});
  }catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
 });
}
