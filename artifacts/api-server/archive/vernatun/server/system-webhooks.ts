import type {Router,Request} from 'express';
import {z} from 'zod';
import {randomUUID,randomBytes,createHmac} from 'node:crypto';
import {pool} from './db.js';
import {ApiError} from './access.js';
import {requireRecentAuthentication} from './recent-auth.js';
import {operationsCipher} from './operations-encryption.js';
import {signedWebhookPost} from './operations-network.js';
export const webhookEvents=['request.created','request.updated','payment.received','invoice.created','meter.submitted','pass.created'] as const;
const endpoint=z.string().url().max(1000).refine(s=>{const u=new URL(s);return u.protocol==='https:'&&!u.username&&!u.password&&!u.hash&&!u.search&&(!u.port||u.port==='443')});
export function registerWebhooks(router:Router,permit:(req:Request,p:string)=>Promise<unknown>){
 router.get('/system/webhooks',async(req,res)=>{
  await permit(req,'api.read');
  const page=z.coerce.number().int().min(1).max(10000).default(1).parse(req.query.page);
  const hooks=await pool.query(`SELECT id,name,organization_id AS "organizationId",endpoint,events,enabled,created_at AS "createdAt"
   FROM outgoing_webhooks ORDER BY created_at DESC LIMIT 100`);
  const deliveries=await pool.query(`SELECT id,webhook_id AS "webhookId",event_id AS "eventId",event_name AS "eventName",status,
   attempts,next_attempt_at AS "nextAttemptAt",last_status AS "lastStatus",last_error AS "lastError",created_at AS "createdAt",
   count(*) OVER()::int AS total FROM outgoing_webhook_deliveries ORDER BY created_at DESC LIMIT 50 OFFSET $1`,[(page-1)*50]);
  res.json({events:webhookEvents,webhooks:hooks.rows,deliveries:deliveries.rows,page,pageSize:50,total:deliveries.rows[0]?.total??0});
 });
 router.post('/system/webhooks',async(req,res)=>{
  await permit(req,'api.read');await permit(req,'api.clients.manage');requireRecentAuthentication(req);
  const x=z.object({name:z.string().trim().min(2).max(100),organizationId:z.string().uuid().nullable(),endpoint,
   events:z.array(z.enum(webhookEvents)).min(1).max(6),confirmation:z.literal('WEBHOOK')}).strict().parse(req.body);
  const id=randomUUID(),secret=randomBytes(32).toString('base64url');
  const db=await pool.connect();try{await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(73192844)');
   if(Number((await db.query('SELECT count(*) AS n FROM outgoing_webhooks')).rows[0].n)>=100)throw new ApiError(409,'webhook_limit');
   await db.query(`INSERT INTO outgoing_webhooks(id,name,organization_id,endpoint,events,encrypted_secret,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7)`,[id,x.name,x.organizationId,x.endpoint,x.events,operationsCipher().seal(Buffer.from(secret),'webhook:'+id),req.user!.id]);
   await db.query("INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id) VALUES($1,'system.webhook.created','webhook',$2)",[req.user!.id,id]);
   await db.query('COMMIT');res.status(201).json({id,secret});
  }catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
 });
 router.post('/system/webhooks/:id/state',async(req,res)=>{
  await permit(req,'api.read');await permit(req,'api.clients.manage');requireRecentAuthentication(req);
  const id=z.string().uuid().parse(req.params.id),x=z.object({enabled:z.boolean(),confirmation:z.literal('WEBHOOK')}).strict().parse(req.body);
  const db=await pool.connect();try{await db.query('BEGIN');
   const r=await db.query('UPDATE outgoing_webhooks SET enabled=$2 WHERE id=$1 RETURNING id',[id,x.enabled]);
   if(!r.rowCount)throw new ApiError(404,'webhook_not_found');
   await db.query("INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,details) VALUES($1,'system.webhook.state','webhook',$2,$3)",[req.user!.id,id,JSON.stringify({enabled:x.enabled})]);
   await db.query('COMMIT');res.json({id,enabled:x.enabled});
  }catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
 });
 router.post('/system/webhooks/deliveries/:id/:action',async(req,res)=>{
  await permit(req,'api.read');await permit(req,'jobs.manage');requireRecentAuthentication(req);
  const id=z.string().uuid().parse(req.params.id),action=z.enum(['retry','cancel']).parse(req.params.action);
  z.object({confirmation:z.literal('WEBHOOK')}).strict().parse(req.body);
  const db=await pool.connect();try{await db.query('BEGIN');
   const r=await db.query(`UPDATE outgoing_webhook_deliveries SET status=$2,next_attempt_at=now(),attempts=CASE WHEN $2='pending' THEN 0 ELSE attempts END
    WHERE id=$1 AND status=ANY($3::text[]) RETURNING id`,[id,action==='retry'?'pending':'cancelled',action==='retry'?['dead_letter']:['pending','retry']]);
   if(!r.rowCount)throw new ApiError(409,'webhook_delivery_state_changed');
   await db.query("INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id) VALUES($1,$2,'webhook_delivery',$3)",[req.user!.id,'system.webhook.'+action,id]);
   await db.query('COMMIT');res.json({id});
  }catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
 });
}
export async function deliverOutgoingWebhooks(){
 const db=await pool.connect();let locked=false;
 try{
  locked=!!(await db.query('SELECT pg_try_advisory_lock(73192845) AS ok')).rows[0].ok;
  if(!locked)return 0;
  await db.query("UPDATE outgoing_webhook_deliveries SET status='retry',next_attempt_at=now(),last_error='interrupted' WHERE status='running'");
  let count=0;
  for(let i=0;i<10;i++){
   const r=(await db.query(`SELECT d.*,w.endpoint,w.encrypted_secret FROM outgoing_webhook_deliveries d
    JOIN outgoing_webhooks w ON w.id=d.webhook_id WHERE w.enabled AND d.status IN('pending','retry') AND d.next_attempt_at<=now()
    ORDER BY d.next_attempt_at LIMIT 1`)).rows[0];if(!r)break;
   // Recheck enabled under a shared row lock; disable waits for this bounded send.
   await db.query('BEGIN');
   const enabled=(await db.query('SELECT enabled FROM outgoing_webhooks WHERE id=$1 FOR SHARE',[r.webhook_id])).rows[0]?.enabled;
   if(!enabled){await db.query('ROLLBACK');continue}
   const claim=await db.query("UPDATE outgoing_webhook_deliveries SET status='running',attempts=attempts+1,started_at=now() WHERE id=$1 AND status IN('pending','retry') RETURNING attempts",[r.id]);
   if(!claim.rowCount){await db.query('ROLLBACK');continue}
   let code:number|null=null,error:string|null=null;
   try{
    const secret=operationsCipher().open(r.encrypted_secret,'webhook:'+r.webhook_id);
    const body=JSON.stringify(r.payload),timestamp=String(Math.floor(Date.now()/1000));
    const signature=createHmac('sha256',secret).update(r.event_id+'.'+timestamp+'.'+body).digest('hex');secret.fill(0);
    code=await signedWebhookPost(r.endpoint,body,{'X-Vernatun-Event-Id':r.event_id,'X-Vernatun-Timestamp':timestamp,'X-Vernatun-Signature':'v1='+signature});
    if(code<200||code>=300)error='http_error';
   }catch{error='delivery_failed'}
   const attempts=claim.rows[0].attempts,status=!error?'delivered':attempts>=5?'dead_letter':'retry';
   await db.query(`UPDATE outgoing_webhook_deliveries SET status=$2,last_status=$3,last_error=$4,
    finished_at=CASE WHEN $2 IN('delivered','dead_letter') THEN now() ELSE NULL END,
    next_attempt_at=now()+($5::int*interval '1 second') WHERE id=$1`,[r.id,status,code,error,Math.min(3600,30*2**attempts)]);
   await db.query('COMMIT');count++;
  }return count;
 }catch(e){await db.query('ROLLBACK');throw e}finally{if(locked)await db.query('SELECT pg_advisory_unlock(73192845)');db.release()}
}
