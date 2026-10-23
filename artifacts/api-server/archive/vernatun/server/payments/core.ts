import {z} from 'zod';
import type {Request} from 'express';
import type {PoolClient} from 'pg';
import {ApiError,type Context} from '../access.js';
import {transaction,idempotent,record,invoiceAmounts} from '../operations.js';
import {config} from '../config.js';
import {pool} from '../db.js';
import {routePayment,providerForInstance,safeCheckoutUrl,type PaymentProvider,type PaymentEvidence} from './providers.js';

const uuid=z.string().uuid();
export const intentInput=z.object({
 domain:z.enum(['platform','property']),key:uuid,platformInvoiceId:uuid.optional(),
 invoiceIds:z.array(uuid).min(1).max(100).refine(x=>new Set(x).size===x.length).optional(),
 allocationStrategy:z.enum(['oldest_first','selected_invoices','current_period_first']).default('oldest_first'),
}).strict().superRefine((b,c)=>{
 if(b.domain==='platform'?(!b.platformInvoiceId||b.invoiceIds!==undefined):(!b.invoiceIds||b.platformInvoiceId!==undefined))
  c.addIssue({code:'custom',message:'Exactly one obligation domain is required'});
});
export const publicIntentColumns=`n.id,n.public_reference,n.payment_domain,n.organization_id,n.amount_minor::text,n.currency,n.status,
 n.provider_payment_id,n.redirect_url,n.created_at,p.provider_code,
 CASE WHEN n.payment_domain='platform' THEN 'Vernatun' ELSE o.name END AS beneficiary`;
export async function publicIntent(id:string,db:PoolClient|typeof pool=pool){
 return (await db.query(`SELECT ${publicIntentColumns} FROM payment_intents n JOIN payment_provider_instances p ON p.id=n.provider_instance_id
 JOIN organizations o ON o.id=n.organization_id WHERE n.id=$1`,[id])).rows[0];
}
export function canPlatform(c:Context){return c.organization_id?c.permissions.includes('platform_billing.pay'):c.permissions.includes('subscriptions.manage')}
function assertPlatform(c:Context,organizationId:string){
 if(!canPlatform(c)||c.organization_id&&c.organization_id!==organizationId)throw new ApiError(404,'not_found');
}
export async function createIntent(req:Request,c:Context,input:unknown){
 const b=intentInput.parse(input);
 const created=await transaction(async db=>idempotent(db,req,b.key,b,async()=>{
  let organizationId:string,unitId:string|null=null,currency:string,total=0n,invoices:any[]=[];
  if(b.domain==='platform'){
   const i=(await db.query(`SELECT i.*,(i.amount_minor-COALESCE((SELECT sum(a.amount_minor) FROM platform_payment_allocations a WHERE a.platform_invoice_id=i.id),0))::text AS balance_minor
    FROM platform_invoices i WHERE i.id=$1`,[b.platformInvoiceId])).rows[0];
   if(!i)throw new ApiError(404,'not_found');assertPlatform(c,i.organization_id);
   if(['draft','cancelled','paid'].includes(i.status))throw new ApiError(409,'invoice_not_payable');
   organizationId=i.organization_id;currency=i.currency;total=BigInt(i.balance_minor);
  }else{
   if(!c.organization_id||!c.unit_id||!c.permissions.includes('billing.own'))throw new ApiError(403,'forbidden');
   organizationId=c.organization_id;unitId=c.unit_id;
   invoices=(await db.query(`SELECT i.id,i.currency,i.period,${invoiceAmounts} FROM invoices i
    WHERE i.id=ANY($1::uuid[]) AND i.organization_id=$2 AND i.unit_id=$3 AND i.payer_user_id=$4 AND i.status='published' ORDER BY i.period,i.id`,
    [b.invoiceIds,organizationId,unitId,req.user!.id])).rows;
   if(invoices.length!==b.invoiceIds!.length)throw new ApiError(404,'not_found');
   currency=invoices[0].currency;
   if(invoices.some(i=>i.currency!==currency||BigInt(i.balance_minor)<=0n))throw new ApiError(409,'invoice_not_payable');
   total=invoices.reduce((v,i)=>v+BigInt(i.balance_minor),0n);
  }
  if(total<=0n||total>99999999999999n)throw new ApiError(400,'invalid_amount');
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`online-obligation:${b.domain}:${organizationId}:${b.domain==='platform'?b.platformInvoiceId:unitId}`]);
  const active=await db.query(`SELECT n.id FROM payment_intents n WHERE n.payment_domain=$1 AND n.organization_id=$2
   AND n.status IN ('created','pending','requires_action','processing')
   AND (($1='platform' AND n.platform_invoice_id=$3::uuid) OR
    ($1='property' AND EXISTS(SELECT 1 FROM payment_intent_invoices r WHERE r.payment_intent_id=n.id AND r.invoice_id=ANY($4::uuid[]))))`,
   [b.domain,organizationId,b.platformInvoiceId??null,b.invoiceIds??[]]);
  if(active.rowCount)throw new ApiError(409,'payment_already_in_progress');
  const {instance}=await routePayment(db,b.domain,organizationId);
  const n=(await db.query(`INSERT INTO payment_intents(payment_domain,organization_id,unit_id,platform_invoice_id,payer_user_id,
   provider_instance_id,amount_minor,currency,description,allocation_strategy)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
   [b.domain,organizationId,unitId,b.platformInvoiceId??null,req.user!.id,instance.id,total.toString(),currency,
    b.domain==='platform'?'Vernatun subscription invoice':'Property invoices',b.allocationStrategy])).rows[0];
  for(const i of invoices)await db.query('INSERT INTO payment_intent_invoices(payment_intent_id,organization_id,invoice_id,amount_minor) VALUES($1,$2,$3,$4)',[n.id,organizationId,i.id,i.balance_minor]);
  await record(db,req,{...c,organization_id:organizationId},'payment_intent.created','payment_intent',n.id,{domain:b.domain});
  return {id:n.id};
 }));
 // The intent is durable BEFORE external IO. A lost response never retries an
 // initialization with a new order number. Verification/recovery uses this order.
 const claim=await transaction(async db=>{
  const n=(await db.query('SELECT * FROM payment_intents WHERE id=$1 FOR UPDATE',[created.id])).rows[0];
  if(n.status!=='created')return null;
  const instance=(await db.query('SELECT * FROM payment_provider_instances WHERE id=$1',[n.provider_instance_id])).rows[0];
  const provider=providerForInstance(instance);
  await db.query("UPDATE payment_intents SET status='processing',updated_at=now() WHERE id=$1",[n.id]);
  return {n,provider};
 });
 if(claim){
  try{
   const started=await claim.provider.initializePayment({orderId:String(claim.n.provider_order_id),reference:claim.n.public_reference,
    amountMinor:claim.n.amount_minor,currency:claim.n.currency,description:claim.n.description,
    returnUrl:config.APP_ORIGIN+(b.domain==='platform'?(c.organization_id?'/os/payments':'/console/payments'):'/imtun/payments?view=online-payments')+
     (b.domain==='platform'?'?':'&')+'payment='+claim.n.id});
   const redirect=safeCheckoutUrl(claim.provider,started.redirectUrl);
   const providerId=z.string().min(1).max(200).parse(started.providerPaymentId);
   await pool.query("UPDATE payment_intents SET status='requires_action',provider_payment_id=$2,redirect_url=$3,updated_at=now() WHERE id=$1 AND status='processing'",[claim.n.id,providerId,redirect]);
  }catch{
   // Unknown outcome is NOT failure and is not permission to charge again.
   // No raw provider response, request or credential is logged/stored here.
   await pool.query("UPDATE payment_provider_instances SET last_error='initialization_outcome_unknown',updated_at=now() WHERE id=$1",[claim.n.provider_instance_id]);
  }
 }
 return publicIntent(created.id);
}
function validateEvidence(n:any,provider:PaymentProvider,e:PaymentEvidence){
 z.enum(['pending','processing','succeeded','failed','cancelled']).parse(e.status);
 if(e.orderId!==String(n.provider_order_id)||e.merchantIdentity!==provider.merchantIdentity||e.amountMinor!==n.amount_minor
 ||e.currency!==n.currency||!e.providerPaymentId||!e.externalTransactionId
 ||n.provider_payment_id&&n.provider_payment_id!==e.providerPaymentId)throw new ApiError(502,'provider_evidence_mismatch');
 z.string().min(1).max(200).parse(e.providerPaymentId);z.string().min(1).max(200).parse(e.externalTransactionId);
}
async function settleProperty(db:PoolClient,req:Request,c:Context,n:any){
 const p=(await db.query(`INSERT INTO payments(organization_id,payer_user_id,amount_minor,currency,source,reference,confirmed_by)
  VALUES($1,$2,$3,$4,'provider',$5,$6) RETURNING *`,[n.organization_id,n.payer_user_id,n.amount_minor,n.currency,'intent:'+n.id,req.user!.id])).rows[0];
 await db.query('INSERT INTO payment_accounts(payment_id,organization_id,unit_id,payer_user_id,created_by) VALUES($1,$2,$3,$4,$5)',[p.id,n.organization_id,n.unit_id,n.payer_user_id,req.user!.id]);
 // Parent lock precedes every new aggregate read. Invoice locks use UUID order
 // shared with bank reconciliation, independent of the allocation strategy.
 await db.query('SELECT id FROM invoices WHERE id IN (SELECT invoice_id FROM payment_intent_invoices WHERE payment_intent_id=$1) ORDER BY id FOR UPDATE',[n.id]);
 const invoices=(await db.query(`SELECT i.id,i.period,${invoiceAmounts} FROM invoices i JOIN payment_intent_invoices r ON r.invoice_id=i.id
  WHERE r.payment_intent_id=$1 ORDER BY
  CASE WHEN $2='current_period_first' AND i.period=date_trunc('month',now() AT TIME ZONE 'Asia/Yerevan')::date THEN 0 ELSE 1 END,i.period,i.id`,[n.id,n.allocation_strategy])).rows;
 let available=BigInt(n.amount_minor);
 for(const i of invoices){
  const balance=BigInt(i.balance_minor),amount=balance<available?balance:available;
  if(amount<=0n)continue;
   const a=(await db.query('INSERT INTO payment_allocations(organization_id,payment_id,invoice_id,amount_minor,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id',[n.organization_id,p.id,i.id,amount.toString(),req.user!.id])).rows[0];
   await record(db,req,c,'allocation.created','payment_allocation',a.id,{paymentDomain:'property',intentId:n.id,invoiceId:i.id,amountMinor:amount.toString()});
  available-=amount;
 }
 // Surplus remains existing payment-account credit, never a negative invoice.
 return p.id as string;
}
export async function verifyIntent(req:Request,c:Context,id:string){
 const snapshot=(await pool.query('SELECT * FROM payment_intents WHERE id=$1',[id])).rows[0];
 if(!snapshot)throw new ApiError(404,'not_found');
 await authorizeIntent(req,c,snapshot);
 const instance=(await pool.query('SELECT * FROM payment_provider_instances WHERE id=$1',[snapshot.provider_instance_id])).rows[0];
 const provider=providerForInstance(instance);
 const evidence=await provider.getPaymentStatus({orderId:String(snapshot.provider_order_id),providerPaymentId:snapshot.provider_payment_id});
 validateEvidence(snapshot,provider,evidence);
 await transaction(async db=>{
  const n=(await db.query('SELECT * FROM payment_intents WHERE id=$1 FOR UPDATE',[id])).rows[0];
  validateEvidence(n,provider,evidence);
  if(n.status==='succeeded')return;
  if(['failed','cancelled'].includes(n.status))throw new ApiError(409,'terminal_payment');
  if(evidence.status!=='succeeded'){
   await db.query('UPDATE payment_intents SET status=$2,updated_at=now() WHERE id=$1',[id,evidence.status]);
   if(evidence.status==='failed')await record(db,req,{...c,organization_id:n.organization_id},'payment.failed','payment_intent',id);
   return;
  }
  if(n.payment_domain==='platform'){
   await db.query('SELECT id FROM platform_invoices WHERE id=$1 FOR UPDATE',[n.platform_invoice_id]);
   const invoice=(await db.query(`SELECT i.*,(i.amount_minor-COALESCE((SELECT sum(amount_minor) FROM platform_payment_allocations WHERE platform_invoice_id=i.id),0))::text AS balance_minor
    FROM platform_invoices i WHERE id=$1`,[n.platform_invoice_id])).rows[0];
   if(['draft','cancelled'].includes(invoice.status)||BigInt(invoice.balance_minor)<BigInt(n.amount_minor))throw new ApiError(409,'platform_settlement_requires_reconciliation');
  }
  const propertyPaymentId=n.payment_domain==='property'?await settleProperty(db,req,c,n):null;
  const t=(await db.query(`INSERT INTO payment_transactions(payment_intent_id,provider_instance_id,external_transaction_id,transaction_type,
   amount_minor,gross_amount_minor,currency,status,provider_status,property_payment_id)
   VALUES($1,$2,$3,'payment',$4,$4,$5,'succeeded','verified',$6) RETURNING id`,
   [n.id,n.provider_instance_id,evidence.externalTransactionId,n.amount_minor,n.currency,propertyPaymentId])).rows[0];
  if(n.payment_domain==='platform'){
   const a=(await db.query('INSERT INTO platform_payment_allocations(payment_transaction_id,platform_invoice_id,amount_minor) VALUES($1,$2,$3) RETURNING id',[t.id,n.platform_invoice_id,n.amount_minor])).rows[0];
   await record(db,req,{...c,organization_id:n.organization_id},'allocation.created','platform_payment_allocation',a.id,{paymentDomain:'platform',intentId:n.id,invoiceId:n.platform_invoice_id,amountMinor:n.amount_minor});
   await db.query(`UPDATE platform_invoices i SET status=CASE WHEN (SELECT sum(amount_minor) FROM platform_payment_allocations WHERE platform_invoice_id=i.id)>=i.amount_minor THEN 'paid' ELSE 'partially_paid' END WHERE id=$1`,[n.platform_invoice_id]);
   // Never silently extend a contract or reactivate a suspended/cancelled one.
   await db.query(`UPDATE subscriptions s SET status='active',grace_until=NULL,updated_at=now() FROM platform_invoices i
    WHERE i.id=$1 AND i.status='paid' AND s.id=i.subscription_id AND s.status IN ('trial','past_due')
    AND (now() AT TIME ZONE 'Asia/Yerevan')::date BETWEEN s.starts_on AND s.ends_on`,[n.platform_invoice_id]);
  }
  await db.query("UPDATE payment_intents SET status='succeeded',provider_payment_id=$2,updated_at=now() WHERE id=$1",[n.id,evidence.providerPaymentId]);
  await db.query("SELECT emit_notification($1,$2,'payment_received','payment_intent',$3,$4)",[n.payer_user_id,n.organization_id,n.id,'payment.received:'+n.id]);
  await record(db,req,{...c,organization_id:n.organization_id},'payment.succeeded','payment_intent',n.id,{transactionId:t.id,domain:n.payment_domain});
 });
 return publicIntent(id);
}
export async function authorizeIntent(req:Request,c:Context,n:any){
 if(n.payment_domain==='platform'){assertPlatform(c,n.organization_id);return}
 if(!c.organization_id||n.organization_id!==c.organization_id||c.building_id&&(await pool.query('SELECT building_id FROM units WHERE id=$1',[n.unit_id])).rows[0]?.building_id!==c.building_id
  ||c.unit_id&&c.unit_id!==n.unit_id||!(c.permissions.includes('payments.reconcile')||req.method==='GET'&&c.permissions.includes('billing.read'))&&(!c.permissions.includes('billing.own')||n.payer_user_id!==req.user!.id))
  throw new ApiError(404,'not_found');
}
