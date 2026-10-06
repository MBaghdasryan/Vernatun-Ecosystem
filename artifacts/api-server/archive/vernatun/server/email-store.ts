import {pool} from './db.js';
import {emailProviderScope} from './email-delivery-events.js';
import type {EmailMessage,EmailProvider,ProviderReceipt} from './email-providers/types.js';

export type EmailBusiness={
 type:'invitation'|'password_reset'|'delegation'|'notification'|'platform_invoice'|'support'|'other';
 id?:string;organizationId?:string;
};
export async function beginEmail(message:EmailMessage,provider:EmailProvider,key:string,sender?:string,business?:EmailBusiness){
 const prefix=key.slice(0,-37);
 const types:Record<string,EmailBusiness['type']>={invitation:'invitation',reset:'password_reset',delegation:'delegation',notification:'notification'};
 const type=business?.type??types[prefix]??'other';
 const row=await pool.query(`INSERT INTO email_messages(provider,provider_scope,delivery_evidence,business_type,business_id,
  organization_id,recipient,sender) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
 [provider.name,emailProviderScope(provider.name),provider.capabilities.deliveryEvents,type,business?.id??key.slice(-36),
  business?.organizationId??null,message.to.toLowerCase(),sender??null]);
 return row.rows[0].id as string;
}
export async function finishEmail(id:string,receipt:ProviderReceipt){
 await pool.query(`UPDATE email_messages SET transport_status=$2,provider_message_id=$3,
  accepted_at=CASE WHEN $2='accepted' THEN now() END,updated_at=now() WHERE id=$1`,
 [id,receipt.kind==='local'?'local':'accepted',receipt.kind==='accepted'?receipt.messageId??null:null]);
}
