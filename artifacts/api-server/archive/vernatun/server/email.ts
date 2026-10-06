import {config} from './config.js';
import {createEmailProvider,type EmailMessage,type EmailSettings,type ProviderDependencies} from './email-providers/index.js';
import {assertConfigured,assertSafeEmailKey,type SMTPTransport} from './email-providers/types.js';
import {beginEmail,finishEmail,type EmailBusiness} from './email-store.js';
import {ApiError} from './access.js';
import {logger} from '../../../src/lib/logger.js';
export class EmailAcceptancePersistenceError extends ApiError{
 constructor(){super(503,'email_receipt_unrecorded')}
}

export type {EmailMessage,EmailSettings,EmailProvider} from './email-providers/index.js';
export {createEmailProvider} from './email-providers/index.js';
export function settingsFromEnvironment():EmailSettings{
 if(config.NODE_ENV==='test')return {mode:'test',provider:'outbox'};
 return {mode:config.NODE_ENV,provider:process.env.MAIL_PROVIDER??(config.NODE_ENV==='production'?'disabled':'outbox'),
  host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT??587),user:process.env.SMTP_USER,
  password:process.env.SMTP_PASS??process.env.SMTP_PASSWORD,from:process.env.EMAIL_FROM??process.env.SMTP_FROM};
}
export function emailProviderState(settings:EmailSettings=settingsFromEnvironment()){
 const provider=createEmailProvider(settings);
 return provider.isConfigured()?(provider.name==='outbox'?'local_outbox':provider.name):'not_configured';
}
export function assertEmailConfigured(settings:EmailSettings=settingsFromEnvironment()){
 assertConfigured(createEmailProvider(settings));
}
export type EmailDelivery={delivery:'local_only';provider:string;url:string}|
 {delivery:'smtp_accepted'|'resend_accepted'|'provider_accepted';provider:string;messageId?:string};
export async function deliverEmail(message:EmailMessage,key:string,options?:{settings?:EmailSettings;transport?:SMTPTransport;dependencies?:ProviderDependencies;business?:EmailBusiness}):Promise<EmailDelivery>{
 assertSafeEmailKey(key);
 const provider=createEmailProvider(options?.settings??settingsFromEnvironment(),{
  ...options?.dependencies,...(options?.transport?{smtpTransport:options.transport}:{})
 });
 assertConfigured(provider);
 const id=await beginEmail(message,provider,key,(options?.settings??settingsFromEnvironment()).from,options?.business);
 // A timeout or lost transport response cannot prove non-delivery. Leave the
 // token-free record unknown on failure; signed failure evidence is separate.
 const receipt=await provider.send(message,key);
 try{await finishEmail(id,receipt)}catch{
  logger.error({emailRecordId:id,provider:provider.name,result:'receipt_unrecorded'},
   'Email transport completed but receipt persistence failed');
  throw new EmailAcceptancePersistenceError();
 }
 if(receipt.kind==='local')return {delivery:'local_only' as const,provider:provider.name,url:receipt.url};
 // Preserve the existing SMTP receipt for callers; new adapters use the same facade.
 const delivery=provider.name==='smtp'?'smtp_accepted':provider.name==='resend'?'resend_accepted':'provider_accepted';
 return {delivery,provider:provider.name,...(receipt.messageId?{messageId:receipt.messageId}:{})};
}
