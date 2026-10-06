import {createHash,randomUUID} from 'node:crypto';
import type {Request} from 'express';
import {transaction,record} from './operations.js';
import {ApiError,type Context} from './access.js';
import {deliverEmail,settingsFromEnvironment,createEmailProvider,EmailAcceptancePersistenceError,type EmailDelivery} from './email.js';
import {config} from './config.js';
import {emailProviderScope} from './email-delivery-events.js';

export async function sendInvitation(req:Request,c:Context,id:string,token:string,options?:Parameters<typeof deliverEmail>[2]){
 const settings=options?.settings??settingsFromEnvironment(),provider=createEmailProvider(settings);
 const hash=createHash('sha256').update(token).digest('hex');
 const attemptId=randomUUID(),scope=emailProviderScope(provider.name);
 const invitation=await transaction(async db=>{
  const i=(await db.query('SELECT * FROM invitations WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(!i||i.token_hash!==hash||i.accepted_at||i.revoked_at)throw new ApiError(409,'invalid_transition');
  await db.query(`INSERT INTO invitation_email_attempts(id,invitation_id,organization_id,token_hash,provider,provider_scope,delivery_evidence)
   VALUES($1,$2,$3,$4,$5,$6,$7)`,[attemptId,id,i.organization_id,hash,provider.name,scope,provider.capabilities.deliveryEvents]);
  await db.query("UPDATE invitations SET current_email_attempt_id=$1,email_delivery_status='unknown',email_delivery_at=NULL WHERE id=$2",[attemptId,id]);
  await record(db,req,{...c,organization_id:i.organization_id},'invitation.delivery.attempt','invitation',id,{attemptId,provider:provider.name});
  return i;
 });
 const url=`${config.APP_ORIGIN}/accept-invitation?token=${token}`;
 let delivery:EmailDelivery;
 try{
  delivery=await deliverEmail({to:invitation.email,subject:'Vernatun · Invitation / Հրավեր / Приглашение',
   text:`Vernatun invitation / Հրավեր / Приглашение.\nOpen the link to accept / Բացեք հղումը / Откройте ссылку.\nValid until / Մինչև / Действует до: ${new Date(invitation.expires_at).toISOString()}\n${url}`,url},'invitation-'+attemptId,
   {...options,settings,business:{type:'invitation',id,organizationId:invitation.organization_id}});
 }catch(e){
  // Observability persistence failure after acceptance is not transport failure.
  if(e instanceof EmailAcceptancePersistenceError)throw e;
  await transaction(async db=>{
   await db.query(`INSERT INTO invitation_email_receipts(attempt_id,provider,provider_scope,outcome) VALUES($1,$2,$3,'failed')`,[attemptId,provider.name,scope]);
   await db.query("UPDATE invitations SET email_delivery_status='failed',email_delivery_at=now() WHERE id=$1 AND token_hash=$2 AND current_email_attempt_id=$3",[id,hash,attemptId]);
   await record(db,req,{...c,organization_id:invitation.organization_id},'invitation.delivery.failed','invitation',id,{result:'failure',attemptId});
  });
  throw e;
 }
 // A persistence error after acceptance must not invent a failed transport receipt.
 await transaction(async db=>{
  await db.query(`INSERT INTO invitation_email_receipts(attempt_id,provider,provider_scope,message_id,outcome) VALUES($1,$2,$3,$4,$5)`,
   [attemptId,provider.name,scope,'messageId' in delivery?delivery.messageId??null:null,delivery.delivery==='local_only'?'local':'accepted']);
  await db.query('UPDATE invitations SET email_delivery_status=$1,email_delivery_at=now() WHERE id=$2 AND token_hash=$3 AND current_email_attempt_id=$4',
   [delivery.delivery==='local_only'?'local':'sent',id,hash,attemptId]);
  await record(db,req,{...c,organization_id:invitation.organization_id},'invitation.delivery','invitation',id,
   {result:'success',delivery:delivery.delivery,provider:delivery.provider,attemptId});
 });
 return delivery;
}
