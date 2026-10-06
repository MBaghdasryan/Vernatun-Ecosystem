import nodemailer from 'nodemailer';
import {mkdir,writeFile} from 'node:fs/promises';
import {z} from 'zod';
import {config} from './config.js';
import {ApiError} from './access.js';

export type EmailMessage={to:string;subject:string;text:string;url:string};
export type EmailSettings={mode:string;provider?:string;host?:string;port?:number;user?:string;password?:string;from?:string};
type Transport={sendMail:(message:Record<string,unknown>)=>Promise<{accepted?:unknown[];rejected?:unknown[]}>};
export function settingsFromEnvironment():EmailSettings{
 if(config.NODE_ENV==='test')return {mode:'test',provider:'outbox'};
 return {mode:config.NODE_ENV,provider:process.env.MAIL_PROVIDER??(config.NODE_ENV==='production'?'disabled':'outbox'),
  host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT??587),user:process.env.SMTP_USER,
  password:process.env.SMTP_PASS??process.env.SMTP_PASSWORD,from:process.env.SMTP_FROM};
}
export function emailProviderState(s:EmailSettings=settingsFromEnvironment()){
 if(s.provider==='outbox'&&s.mode!=='production')return 'local_outbox';
 if(s.provider!=='smtp'||!s.host||!s.from||!z.string().email().safeParse(s.from).success||
  !Number.isInteger(s.port)||(s.port??0)<1||(s.port??0)>65535||
  Boolean(s.user)!==Boolean(s.password)||
  (s.mode==='production'&&(!s.user||!s.password)))return 'not_configured';
 return 'smtp';
}
export function assertEmailConfigured(s:EmailSettings=settingsFromEnvironment()){
 if(emailProviderState(s)==='not_configured')throw new ApiError(503,'email_not_configured');
}
export async function deliverEmail(message:EmailMessage,key:string,options?:{settings:EmailSettings;transport?:Transport}){
 const settings=options?.settings??settingsFromEnvironment();assertEmailConfigured(settings);
 if(!/^(reset|invitation)-[0-9a-f-]{36}$/.test(key))throw new Error('Unsafe private outbox key');
 if(emailProviderState(settings)==='local_outbox'){
  const directory=settings.mode==='test'?'.local/test/outbox':'.local/outbox';
  await mkdir(directory,{recursive:true,mode:0o700});
  await writeFile(`${directory}/${key}.json`,JSON.stringify({email:message.to,...message},null,2),{mode:0o600});
  return {delivery:'local_only' as const,url:message.url};
 }
 const transporter=options?.transport??nodemailer.createTransport({
  host:settings.host,port:settings.port,secure:settings.port===465,requireTLS:settings.mode==='production'&&settings.port!==465,
  ...(settings.user?{auth:{user:settings.user,pass:settings.password}}:{}),
  tls:{minVersion:'TLSv1.2',rejectUnauthorized:true},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:20000
 });
 try{
  const result=await transporter.sendMail({from:settings.from,to:message.to,subject:message.subject,text:message.text});
  if(!result.accepted?.length||result.rejected?.length)throw new Error('Recipient was not accepted');
  // Accepted by SMTP is not a guarantee of inbox delivery.
  return {delivery:'smtp_accepted' as const};
 }catch{throw new ApiError(503,'email_delivery_failed')}
}
