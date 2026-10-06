import {createHash} from 'node:crypto';
import {ReplitConnectors} from '@replit/connectors-sdk';
import {z} from 'zod';
import {ApiError} from '../access.js';
import {assertConfigured,validSender,type EmailMessage,type EmailProvider,type EmailSettings,type ProviderReceipt,type ResendFetch} from './types.js';

export class ResendEmailProvider implements EmailProvider {
 readonly name='resend';
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
