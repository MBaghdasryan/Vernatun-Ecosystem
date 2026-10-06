import nodemailer from 'nodemailer';
import {ApiError} from '../access.js';
import {assertConfigured,validSender,type EmailMessage,type EmailProvider,type EmailSettings,type ProviderReceipt,type SMTPTransport} from './types.js';

export class SMTPEmailProvider implements EmailProvider {
 readonly name='smtp';
 constructor(private readonly settings:EmailSettings,private readonly transport?:SMTPTransport){}
 isConfigured(){
  const s=this.settings;
  return s.mode!=='test'&&Boolean(s.host)&&validSender(s.from)&&Number.isInteger(s.port)&&(s.port??0)>=1&&(s.port??0)<=65535&&
   Boolean(s.user)===Boolean(s.password)&&(s.mode!=='production'||Boolean(s.user&&s.password));
 }
 async send(message:EmailMessage,_key:string):Promise<ProviderReceipt>{
  assertConfigured(this);
  const s=this.settings;
  const transport=this.transport??nodemailer.createTransport({
   host:s.host,port:s.port,secure:s.port===465,requireTLS:s.mode==='production'&&s.port!==465,
   ...(s.user?{auth:{user:s.user,pass:s.password}}:{}),
   tls:{minVersion:'TLSv1.2',rejectUnauthorized:true},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:20000
  });
  try{
   const result=await transport.sendMail({from:s.from,to:message.to,subject:message.subject,text:message.text});
   const accepted=result.accepted?.some(x=>typeof x==='string'&&x.toLowerCase()===message.to.toLowerCase());
   if(!accepted||result.rejected?.length)throw new Error('Recipient was not accepted');
   return {kind:'accepted'};
  }catch{throw new ApiError(503,'email_delivery_failed')}
 }
}
