import {mkdir,writeFile} from 'node:fs/promises';
import {assertConfigured,assertSafeEmailKey,type EmailMessage,type EmailProvider,type EmailSettings,type ProviderReceipt} from './types.js';

export class DevelopmentOutboxProvider implements EmailProvider {
 readonly name='outbox';
 readonly capabilities={deliveryEvents:false,opens:false,clicks:false} as const;
 constructor(private readonly settings:EmailSettings){}
 isConfigured(){return this.settings.mode==='development'||this.settings.mode==='test'}
 async send(message:EmailMessage,key:string):Promise<ProviderReceipt>{
  assertConfigured(this);assertSafeEmailKey(key);
  const directory=this.settings.mode==='test'?'.local/test/outbox':'.local/outbox';
  await mkdir(directory,{recursive:true,mode:0o700});
  await writeFile(`${directory}/${key}.json`,JSON.stringify({email:message.to,...message},null,2),{mode:0o600});
  return {kind:'local',url:message.url};
 }
}
