import {createHash} from 'node:crypto';
import type {Request} from 'express';
import {pool} from './db.js';
import {transaction,record} from './operations.js';
import type {Context} from './access.js';
import {deliverEmail} from './email.js';
import {config} from './config.js';

export async function sendInvitation(req:Request,c:Context,id:string,token:string){
 const invitation=(await pool.query('SELECT email,organization_id,expires_at FROM invitations WHERE id=$1',[id])).rows[0];
 const url=`${config.APP_ORIGIN}/accept-invitation?token=${token}`;
 const hash=createHash('sha256').update(token).digest('hex');
 try{
  const delivery=await deliverEmail({to:invitation.email,subject:'Vernatun · Invitation / Հրավեր / Приглашение',
   text:`Vernatun invitation / Հրավեր / Приглашение.\nOpen the link to accept / Բացեք հղումը / Откройте ссылку.\nValid until / Մինչև / Действует до: ${new Date(invitation.expires_at).toISOString()}\n${url}`,url},'invitation-'+id);
  await transaction(async db=>{
   await db.query('UPDATE invitations SET email_delivery_status=$1,email_delivery_at=now() WHERE id=$2 AND token_hash=$3',
    [delivery.delivery==='local_only'?'local':'sent',id,hash]);
   await record(db,req,{...c,organization_id:invitation.organization_id},'invitation.delivery','invitation',id,{result:'success',delivery:delivery.delivery});
  });
  return delivery;
 }catch(e){
  await transaction(async db=>{
   await db.query("UPDATE invitations SET email_delivery_status='failed',email_delivery_at=now() WHERE id=$1 AND token_hash=$2",[id,hash]);
   await record(db,req,{...c,organization_id:invitation.organization_id},'invitation.delivery.failed','invitation',id,{result:'failure'});
  });
  throw e;
 }
}
