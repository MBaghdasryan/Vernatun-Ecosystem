import {z} from 'zod';
import nodemailer from 'nodemailer';
import {publicHost} from './operations-network.js';

export const integrationCategories=['payments','utility_aggregators','banks','sms','email','access_control','intercom','cameras','metering','ai','chatbots','crm_erp','government'] as const;
export type ConnectionResult='connected'|'authentication_failed'|'timeout'|'invalid_configuration'|'provider_error';
export interface IntegrationProvider {
 id:string;name:string;category:typeof integrationCategories[number];version:string;capabilities:string[];
 configurationSchema:z.ZodTypeAny;credentialSchema:z.ZodTypeAny;
 testConnection(config:unknown,credentials:unknown):Promise<ConnectionResult>;
 healthCheck(config:unknown,credentials:unknown):Promise<ConnectionResult>;
 activate(config:unknown,credentials:unknown):Promise<ConnectionResult>;
 deactivate():Promise<void>;
}
const smtpConfig=z.object({host:z.string().min(1).max(253),port:z.union([z.literal(465),z.literal(587)])}).strict();
const smtpCredentials=z.object({username:z.string().min(1).max(320),password:z.string().min(1).max(2000)}).strict();
const smtpTest=async(config:unknown,credentials:unknown):Promise<ConnectionResult>=>{
 const c=smtpConfig.safeParse(config),s=smtpCredentials.safeParse(credentials);
 if(!c.success||!s.success)return 'invalid_configuration';
 let transport:ReturnType<typeof nodemailer.createTransport>|undefined;
 try{
  const ip=await publicHost(c.data.host);
  transport=nodemailer.createTransport({host:ip,port:c.data.port,secure:c.data.port===465,requireTLS:true,
   tls:{servername:c.data.host,rejectUnauthorized:true},auth:{user:s.data.username,pass:s.data.password},
   connectionTimeout:5000,greetingTimeout:5000,socketTimeout:5000,logger:false,debug:false});
  await transport.verify();return 'connected';
 }catch(e){const code=(e as {code?:string}).code;return code==='EAUTH'?'authentication_failed':code==='ETIMEDOUT'?'timeout':'provider_error'}
 finally{transport?.close()}
};
export const smtpIntegration:IntegrationProvider={id:'smtp',name:'SMTP',category:'email',version:'1.0.0',
 capabilities:['test_connection','health_check'],configurationSchema:smtpConfig,credentialSchema:smtpCredentials,
 testConnection:smtpTest,healthCheck:smtpTest,activate:smtpTest,async deactivate(){}};
export function integrationProvider(id:string){return id==='smtp'?smtpIntegration:undefined}
export function providerCatalog(){return integrationCategories.map(category=>category==='email'?
 {id:'smtp',name:'SMTP',category,version:'1.0.0',adapterInstalled:true,capabilities:smtpIntegration.capabilities,
 configurationFields:['host','port'],credentialFields:['username','password']}:
 {id:category+'.provider_required',name:category,category,version:null,adapterInstalled:false,capabilities:[],configurationFields:[],credentialFields:[]});}

export type {PaymentProvider,UtilityAggregatorProvider} from './payments/providers.js';
export interface BankingProvider {
 importStatement(bytes:Buffer):Promise<unknown[]>;
 normalizeTransactions(rows:unknown[]):Promise<{reference:string;amountMinor:string;currency:string;date:string}[]>;
 fetchTransactions?(since:string):Promise<unknown[]>;
 validateAccount?(reference:string):Promise<boolean>;
 healthCheck():Promise<ConnectionResult>;
}
export interface SmsProvider {send(to:string,text:string):Promise<{reference:string}>}
export class NotConfiguredSmsProvider implements SmsProvider {async send():Promise<{reference:string}>{throw Error('provider_required')}}
export interface AccessControlProvider {validateCredential(reference:string):Promise<boolean>;openDevice(id:string):Promise<void>;deviceStatus(id:string):Promise<string>;accessEvents(since:string):Promise<unknown[]>}
export interface CameraProvider {listCameras():Promise<{id:string;name:string}[]>;stream(id:string):Promise<{url:string;expiresAt:string}>;snapshot(id:string):Promise<Buffer>;events(since:string):Promise<unknown[]>}
export interface AIProvider {complete(input:{prompt:string;model:string;maxTokens:number;timeout:number}):Promise<string>}
