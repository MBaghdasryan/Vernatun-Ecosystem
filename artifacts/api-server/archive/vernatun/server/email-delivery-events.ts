import {Router} from 'express';
import express from 'express';
import {ApiError} from './access.js';
import {ResendEmailProvider} from './email-providers/index.js';
import type {DeliveryEvent} from './email-providers/types.js';
import {pool} from './db.js';
import {randomUUID} from 'node:crypto';
import {rateLimit} from 'express-rate-limit';
import {logger} from '../../../src/lib/logger.js';

// A scope identifies a provider account/connection, not an organization.
// When changing accounts, change the scope along with the signing secret.
export function emailProviderScope(provider:string){
 return provider==='resend'?(process.env.RESEND_WEBHOOK_SCOPE??'primary'):'primary';
}
export async function ingestDeliveryEvent(event:DeliveryEvent){
 // Store only normalized evidence, never raw recipients, diagnostic text or URLs.
 const result=await pool.query(`INSERT INTO email_delivery_events(provider,provider_scope,event_id,message_id,outcome,occurred_at,safe_metadata)
  VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(provider,provider_scope,event_id) DO NOTHING RETURNING id`,
 [event.provider,event.scope,event.eventId,event.messageId,event.outcome,event.occurredAt,JSON.stringify(event.safeMetadata??{})]);
 // Views aggregate committed evidence; no separate mutable status update can
 // fail midway or race a transport receipt. Unmatched events are retained.
 return result.rowCount===1;
}
async function webhookHealth(result:'valid'|'invalid'|'failure'){
 const scope=emailProviderScope('resend');
 await pool.query(`INSERT INTO email_webhook_health(provider,provider_scope,last_received_at,last_valid_at,last_invalid_signature_at,last_failure_at,failures)
  VALUES('resend',$1,now(),CASE WHEN $2='valid' THEN now() END,CASE WHEN $2='invalid' THEN now() END,
   CASE WHEN $2 IN ('invalid','failure') THEN now() END,CASE WHEN $2='valid' THEN 0 ELSE 1 END)
  ON CONFLICT(provider,provider_scope) DO UPDATE SET last_received_at=now(),
   last_valid_at=COALESCE(EXCLUDED.last_valid_at,email_webhook_health.last_valid_at),
   last_invalid_signature_at=COALESCE(EXCLUDED.last_invalid_signature_at,email_webhook_health.last_invalid_signature_at),
   last_failure_at=COALESCE(EXCLUDED.last_failure_at,email_webhook_health.last_failure_at),
   failures=email_webhook_health.failures+EXCLUDED.failures`,[scope,result]);
 if(result!=='valid')await pool.query(`INSERT INTO email_webhook_daily(provider_scope,day,failures)
  VALUES($1,(now() AT TIME ZONE 'UTC')::date,1) ON CONFLICT(provider_scope,day)
  DO UPDATE SET failures=email_webhook_daily.failures+1`,[scope]);
}
export const emailWebhooks=Router();
emailWebhooks.post('/resend',rateLimit({windowMs:60000,limit:300,standardHeaders:'draft-7',legacyHeaders:false}),
 express.raw({type:'application/json',limit:'32kb'}),async(req,res)=>{
 const correlationId=randomUUID();
 const secret=process.env.RESEND_WEBHOOK_SECRET;
 if(!secret)throw new ApiError(503,'webhook_not_configured');
 if(!Buffer.isBuffer(req.body))throw new ApiError(400,'webhook_payload_invalid');
 // Use the provider adapter even when outgoing mail has since switched to SMTP.
 const provider=new ResendEmailProvider({mode:'production'});
 let event:DeliveryEvent|null;
 try{
  event=provider.normalizeWebhook({
   body:req.body.toString('utf8'),secret,scope:emailProviderScope(provider.name),
   headers:{'svix-id':req.get('svix-id')??'','svix-timestamp':req.get('svix-timestamp')??'','svix-signature':req.get('svix-signature')??''}
  });
 }catch(error){
  const invalid=error instanceof ApiError&&error.code==='webhook_signature_invalid';
  logger.warn({correlationId,verified:!invalid,result:invalid?'invalid_signature':'invalid_payload'},'Email webhook rejected');
  await webhookHealth(invalid?'invalid':'failure').catch(()=>{});
  throw error;
 }
 try{
  const stored=event?await ingestDeliveryEvent(event):false;
  // Evidence commit is the acceptance boundary; telemetry failure must not
  // turn already committed events into failed delivery.
  await webhookHealth('valid').catch(()=>{});
  logger.info({correlationId,verified:true,eventType:event?.outcome??'unsupported',
   eventId:event?.eventId,messageId:event?.messageId,result:event?(stored?'stored':'duplicate'):'ignored'},'Email webhook processed');
 }catch(error){
  logger.error({correlationId,verified:true,result:'storage_failure'},'Email webhook retry required');
  await webhookHealth('failure').catch(()=>{});
  throw error;
 }
 res.status(204).end();
});
emailWebhooks.all('/resend',(_req,res)=>res.set('Allow','POST').status(405).json({error:'method_not_allowed'}));
