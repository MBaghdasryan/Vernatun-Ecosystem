import {ApiError} from '../access.js';
import {DevelopmentOutboxProvider} from './development-outbox.js';
import {SMTPEmailProvider} from './smtp.js';
import {ResendEmailProvider} from './resend.js';
import type {EmailProvider,EmailSettings,ProviderDependencies} from './types.js';

export type {EmailProvider,EmailMessage,EmailSettings,ProviderReceipt,ProviderDependencies} from './types.js';
export {DevelopmentOutboxProvider,SMTPEmailProvider,ResendEmailProvider};

class DisabledEmailProvider implements EmailProvider {
 readonly name='disabled';
 isConfigured(){return false}
 async send():Promise<never>{throw new ApiError(503,'email_not_configured')}
}
const factories:Record<string,(s:EmailSettings,d:ProviderDependencies)=>EmailProvider>={
 outbox:s=>new DevelopmentOutboxProvider(s),
 smtp:(s,d)=>new SMTPEmailProvider(s,d.smtpTransport),
 resend:(s,d)=>new ResendEmailProvider(s,d.resendFetch)
};
export function createEmailProvider(settings:EmailSettings,dependencies:ProviderDependencies={}):EmailProvider{
 // All automated tests remain offline, including when real settings are inherited.
 if(settings.mode==='test')return new DevelopmentOutboxProvider(settings);
 return factories[settings.provider??'disabled']?.(settings,dependencies)??new DisabledEmailProvider();
}
