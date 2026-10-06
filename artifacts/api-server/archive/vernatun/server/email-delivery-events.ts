import {Router} from 'express';
import express from 'express';
import {ApiError} from './access.js';
import {ResendEmailProvider} from './email-providers/index.js';
import type {DeliveryEvent} from './email-providers/types.js';
import {pool} from './db.js';

// A scope identifies a provider account/connection, not an organization.
// When changing accounts, change the scope along with the signing secret.
export function emailProviderScope(provider:string){
 return provider==='resend'?(process.env.RESEND_WEBHOOK_SCOPE??'primary'):'primary';
}
export async function ingestDeliveryEvent(event:DeliveryEvent){
 // Store only normalized evidence, never raw recipients, diagnostic text or URLs.
 await pool.query(`INSERT INTO email_delivery_events(provider,provider_scope,event_id,message_id,outcome,occurred_at)
  VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(provider,provider_scope,event_id) DO NOTHING`,
 [event.provider,event.scope,event.eventId,event.messageId,event.outcome,event.occurredAt]);
}
export const emailWebhooks=Router();
emailWebhooks.post('/resend',express.raw({type:'application/json',limit:'32kb'}),async(req,res)=>{
 const secret=process.env.RESEND_WEBHOOK_SECRET;
 if(!secret)throw new ApiError(503,'webhook_not_configured');
 if(!Buffer.isBuffer(req.body))throw new ApiError(400,'webhook_payload_invalid');
 // Use the provider adapter even when outgoing mail has since switched to SMTP.
 const provider=new ResendEmailProvider({mode:'production'});
 const event=provider.normalizeWebhook({
  body:req.body.toString('utf8'),secret,scope:emailProviderScope(provider.name),
  headers:{'svix-id':req.get('svix-id')??'','svix-timestamp':req.get('svix-timestamp')??'','svix-signature':req.get('svix-signature')??''}
 });
 if(event)await ingestDeliveryEvent(event);
 res.status(204).end();
});
