import {config} from '../config.js';
import {ApiError} from '../access.js';
import type {PoolClient} from 'pg';

export type PaymentDomain='platform'|'property';
export type PaymentStatus='pending'|'processing'|'succeeded'|'failed'|'cancelled';
export interface PaymentEvidence {
 status:PaymentStatus;providerPaymentId:string;orderId:string;merchantIdentity:string;
 amountMinor:string;currency:string;externalTransactionId:string;
}
export interface PaymentProvider {
 readonly domain:PaymentDomain;
 readonly merchantIdentity:string;
 readonly checkoutOrigins:readonly string[];
 initializePayment(input:{orderId:string;reference:string;amountMinor:string;currency:string;returnUrl:string;description:string}):Promise<{providerPaymentId:string;redirectUrl:string}>;
 getPaymentStatus(input:{orderId:string;providerPaymentId:string|null}):Promise<PaymentEvidence>;
 verifyCallback?(raw:Buffer,headers:Record<string,string>):Promise<{orderId:string}>;
 confirmPayment?(reference:string):Promise<PaymentEvidence>;
 refundPayment?(reference:string,amountMinor:string):Promise<PaymentEvidence>;
 cancelPayment?(reference:string):Promise<PaymentEvidence>;
 getCapabilities():readonly string[];
 healthCheck():Promise<'transaction_test_required'|'degraded'>;
}
export interface UtilityPaymentEvidence {
 externalTransactionId:string;amountMinor:string;currency:string;
 aggregatorStatus:'pending'|'succeeded'|'failed'|'cancelled';
 utilitySettlementStatus:'unknown'|'pending'|'posted'|'rejected';
}
export interface UtilityAggregatorProvider {
 getCapabilities():readonly ('subscriber_check'|'balance_lookup'|'payment'|'status'|'cancel'|'registry')[];
 getServiceRegistry?():Promise<readonly {externalServiceId:string;utilityType:string;name:string;requiredSubscriberFields:readonly string[]}[]>;
 validateSubscriber(input:{serviceId:string;subscriber:Readonly<Record<string,string>>}):Promise<{valid:boolean}>;
 lookupBalance?(input:{serviceId:string;subscriber:Readonly<Record<string,string>>}):Promise<{totalDueMinor:string;currency:string;retrievedAt:string;externalReference:string}>;
 createPayment?(input:{serviceId:string;subscriber:Readonly<Record<string,string>>;amountMinor:string;currency:string;idempotencyKey:string}):Promise<UtilityPaymentEvidence>;
 getPaymentStatus?(reference:string):Promise<UtilityPaymentEvidence>;
 cancelPayment?(reference:string):Promise<UtilityPaymentEvidence>;
}
export const paymentProviderCatalog=[
 {code:'ameriabank',name:'Ameriabank VPOS',domain:'platform',providerType:'PLATFORM_PAYMENT',scope:'platform',
  status:'contract_required',credentialFields:['clientId','username','password'],capabilities:[] as string[]},
 {code:'arca',name:'ArCa / IPay',domain:'property',providerType:'PROPERTY_PAYMENT',scope:'organization',
  status:'contract_required',credentialFields:[] as string[],capabilities:[] as string[]},
 {code:'telcell',name:'Telcell utilities',domain:'utility',providerType:'UTILITY_AGGREGATOR',scope:'contract_required',
  status:'contract_required',credentialFields:[] as string[],capabilities:[] as string[]},
] as const;

// The official Ameria Help documents request/response fields, but not the
// contracted merchant mode, success-state semantics, callback authentication or
// checkout URL. ArCa and Telcell partner contracts were not supplied. Do not
// turn public endpoint names into a supposedly verified live adapter.
export class AmeriabankPlatformPaymentProvider {
 readonly allowedPaymentDomain='platform';
 readonly status='CONTRACT_REQUIRED';
 readonly documentedOperations=['InitPayment','GetPaymentDetails','ConfirmPayment','RefundPayment','CancelPayment'];
 getCapabilities(){return []}
}
export class ArcaPropertyPaymentProvider {
 readonly allowedPaymentDomain='property';
 readonly status='CONTRACT_REQUIRED';
 getCapabilities(){return []}
}
export class TelcellUtilityAggregatorProvider {
 readonly status='CONTRACT_REQUIRED';
 getCapabilities():ReturnType<UtilityAggregatorProvider['getCapabilities']>{return []}
}

const testPorts=new Map<string,PaymentProvider>();
// Dependency injection is deliberately test-process-only. There is no HTTP,
// env-var or database switch that can activate a mock in production.
export function installTestPaymentProvider(id:string,provider:PaymentProvider){
 if(config.NODE_ENV!=='test')throw new Error('test_payment_provider_forbidden');
 testPorts.set(id,provider);
}
export function clearTestPaymentProviders(){testPorts.clear()}
export function providerForInstance(instance:{id:string;payment_domain:string;enabled:boolean}):PaymentProvider{
 const provider=config.NODE_ENV==='test'?testPorts.get(instance.id):undefined;
 if(!instance.enabled||!provider)throw new ApiError(409,'provider_contract_required');
 if(provider.domain!==instance.payment_domain)throw new ApiError(409,'payment_domain_mismatch');
 return provider;
}
export async function routePayment(db:PoolClient,domain:PaymentDomain,organizationId:string){
 const environment=config.NODE_ENV==='production'?'production':'sandbox';
 const instance=(await db.query(`SELECT * FROM payment_provider_instances WHERE payment_domain=$1 AND environment=$2
 AND (($1='platform' AND scope_type='platform' AND organization_id IS NULL)
 OR ($1='property' AND scope_type='organization' AND organization_id=$3))`,[domain,environment,organizationId])).rows[0];
 if(!instance)throw new ApiError(409,'payment_provider_not_configured');
 return {instance,provider:providerForInstance(instance)};
}
export function safeCheckoutUrl(provider:PaymentProvider,value:string){
 let url:URL;try{url=new URL(value)}catch{throw new ApiError(502,'unsafe_provider_redirect')}
 if(url.protocol!=='https:'||url.username||url.password||!provider.checkoutOrigins.includes(url.origin))throw new ApiError(502,'unsafe_provider_redirect');
 return url.href;
}
