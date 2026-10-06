import {z} from 'zod';
import {ApiError} from '../access.js';

export type EmailMessage={to:string;subject:string;text:string;url:string};
export type EmailSettings={mode:string;provider?:string;host?:string;port?:number;user?:string;password?:string;from?:string};
export type ProviderReceipt={kind:'accepted';messageId?:string}|{kind:'local';url:string};
export interface EmailProvider {
 readonly name:string;
 isConfigured():boolean;
 send(message:EmailMessage,key:string):Promise<ProviderReceipt>;
}
export type SMTPTransport={sendMail:(message:Record<string,unknown>)=>Promise<{accepted?:unknown[];rejected?:unknown[]}>};
export type ResendFetch=(path:string,init:RequestInit)=>Promise<Response>;
export type ProviderDependencies={smtpTransport?:SMTPTransport;resendFetch?:ResendFetch};
export function validSender(from?:string){return z.string().email().safeParse(from).success}
export function assertConfigured(provider:EmailProvider){
 if(!provider.isConfigured())throw new ApiError(503,'email_not_configured');
}
export function assertSafeEmailKey(key:string){
 if(!/^[a-z][a-z0-9_-]{0,63}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(key))
  throw new Error('Unsafe private outbox key');
}
