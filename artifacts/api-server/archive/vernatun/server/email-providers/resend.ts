import {createHash} from 'node:crypto';
import {ReplitConnectors} from '@replit/connectors-sdk';
import {z} from 'zod';
import {Webhook} from 'svix';
import {ApiError} from '../access.js';
import {assertConfigured,validSender,type EmailMessage,type EmailProvider,type EmailSettings,type ProviderReceipt,type ResendFetch,type WebhookInput,type DeliveryEvent} from './types.js';

export class ResendEmailProvider implements EmailProvider {
 readonly name='resend';
 readonly capabilities={deliveryEvents:true,opens:false,clicks:false} as const;
 normalizeWebhook(input:WebhookInput):DeliveryEvent|null{
  let verified:unknown;
  // Svix 2 verifies bytes but returns void. Parse only after signature verification.
  try{new Webhook(input.secret).verify(input.body,input.headers)}
  catch{throw new ApiError(400,'webhook_signature_invalid')}
  try{verified=JSON.parse(input.body)}
  catch{throw new ApiError(400,'webhook_payload_invalid')}
  const envelope=z.object({type:z.string()}).safeParse(verified);
  if(!envelope.success)throw new ApiError(400,'webhook_payload_invalid');
  const outcomes={'email.sent':'sent','email.delivery_delayed':'delayed','email.delivered':'delivered',
   'email.bounced':'bounced','email.complained':'complained','email.failed':'failed'} as const;
  const outcome=Object.hasOwn(outcomes,envelope.data.type)?outcomes[envelope.data.type as keyof typeof outcomes]:undefined;
  // Open/click and unrelated events are deliberately not retained.
  if(!outcome)return null;
  const event=z.object({created_at:z.string().datetime({offset:true}),data:z.object({email_id:z.string().uuid()})}).safeParse(verified);
  if(!event.success)throw new ApiError(400,'webhook_payload_invalid');
  const eventId=z.string().regex(/^[A-Za-z0-9_-]{1,200}$/).parse(input.headers['svix-id']);
  // Provider free-form diagnostics can contain addresses, tokens or message
  // contents. Retain only known bounce classification codes, never raw text.
  const bounce=(verified as {data?:{bounce?:{type?:unknown;subType?:unknown}}}).data?.bounce;
  const safeMetadata:Record<string,string>={};
  const codes=new Set(['Permanent','Transient','Undetermined','Hard','Soft','General','NoEmail','Suppressed','MailboxFull','MessageTooLarge','ContentRejected','AttachmentRejected']);
  for(const [key,value] of Object.entries(bounce??{})){
   if(['type','subType'].includes(key)&&typeof value==='string'&&codes.has(value))safeMetadata[key]=value;
  }
  return {provider:this.name,scope:input.scope,eventId,messageId:event.data.data.email_id,outcome,occurredAt:event.data.created_at,safeMetadata};
 }
 constructor(private readonly settings:EmailSettings,private readonly fetchEmail?:ResendFetch){}
 isConfigured(){return this.settings.mode!=='test'&&validSender(this.settings.from)}
 async send(message:EmailMessage,key:string):Promise<ProviderReceipt>{
  assertConfigured(this);
  const payload={from:this.settings.from,to:[message.to],subject:message.subject,text:message.text};
  // Repeated transport attempts share a key; a rotated invitation/reset token does not.
  const digest=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const idempotencyKey=`vernatun-${key}-${digest}`;
  try{
   // No API key in this app. The connector injects credentials and refreshes identity.
   const fetchEmail=this.fetchEmail??new ReplitConnectors().createProxyFetch('resend');
   const response=await fetchEmail('/emails',{
    method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':idempotencyKey},
    body:JSON.stringify(payload),signal:AbortSignal.timeout(20000)
   });
   if(!response.ok)throw new Error('Provider did not accept the message');
   const result=z.object({id:z.string().uuid()}).safeParse(await response.json());
   if(!result.success)throw new Error('Invalid provider receipt');
   // API acceptance is not mailbox delivery. No URL/token is returned or logged.
   return {kind:'accepted',messageId:result.data.id};
  }catch{throw new ApiError(503,'email_delivery_failed')}
 }
}
