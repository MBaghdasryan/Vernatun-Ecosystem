import {Router,type Request} from 'express';
import {z} from 'zod';
import {pool} from '../db.js';
import {ApiError,context,requireAuth,requirePermission} from '../access.js';
import {transaction,record,idempotent,invoiceAmounts} from '../operations.js';
import {operationsCipher,operationsEncryptionState} from '../operations-encryption.js';
import {paymentProviderCatalog} from './providers.js';
import {checkAmeriaConnection} from './ameriabank-connection.js';
import {createIntent,verifyIntent,authorizeIntent,publicIntent,publicIntentColumns,canPlatform} from './core.js';

export const payments=Router();payments.use(requireAuth);
const uuid=z.string().uuid();
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(x=>Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x);
const instanceColumns='id,provider_code,payment_domain,scope_type,organization_id,environment,status,enabled,(encrypted_credentials IS NOT NULL) AS credentials_configured,revision,updated_at,last_health_check,last_success_at,last_error';
const invoiceColumns=`i.*,(SELECT COALESCE(sum(a.amount_minor),0)::text FROM platform_payment_allocations a WHERE a.platform_invoice_id=i.id) AS paid_minor`;
async function workspacePermission(req:Request){
 const c=await context(req);
 const permission=!c.organization_id?'subscriptions.manage':
  c.permissions.includes('payments.reconcile')?'payments.reconcile':
  c.permissions.includes('billing.own')?'billing.own':
  c.permissions.includes('organization.settings')?'organization.settings':
  c.permissions.includes('platform_billing.pay')?'platform_billing.pay':'billing.read';
 return requirePermission(req,permission);
}
async function configurationPermission(req:Request,code:string){
 const c=await context(req);
 if(code==='telcell')throw new ApiError(409,'utility_contract_scope_required');
 if(code==='ameriabank'){
  if(c.organization_id)throw new ApiError(403,'platform_scope_required');
  return requirePermission(req,'subscriptions.manage');
 }
 if(!c.organization_id||c.building_id||c.unit_id)throw new ApiError(403,'organization_scope_required');
 return requirePermission(req,'organization.settings');
}
async function scopedInstance(req:Request){
 const id=uuid.parse(req.params.id),c=await context(req);
 // Authenticate scope BEFORE loading any ciphertext or provider state.
 const i=(await pool.query(`SELECT ${instanceColumns} FROM payment_provider_instances WHERE id=$1 AND
  (($2::uuid IS NULL AND organization_id IS NULL AND provider_code='ameriabank') OR
   ($2::uuid IS NOT NULL AND organization_id=$2 AND provider_code='arca'))`,[id,c.organization_id])).rows[0];
 if(!i)throw new ApiError(404,'not_found');
 await configurationPermission(req,i.provider_code);return {i,c};
}
const readiness=(instance:any)=>({
 status:instance?.status==='disabled'?'disabled':instance?'contract_required':'not_configured',
 onlineAvailable:false,
 reason:instance?.status==='disabled'?'provider_disabled':instance?'verified_provider_contract_required':'payment_provider_not_configured',
});
payments.get('/payments/workspace',async(req,res)=>{
 const c=await workspacePermission(req),platform=!c.organization_id;
 const definitions=paymentProviderCatalog.filter(p=>platform?p.code!=='arca':p.code!=='ameriabank');
 const instances=(await pool.query(`SELECT ${instanceColumns} FROM payment_provider_instances
  WHERE ($1::uuid IS NULL AND scope_type='platform') OR organization_id=$1 ORDER BY provider_code,environment`,[c.organization_id])).rows;
  const staffRead=c.permissions.includes('payments.reconcile')||c.permissions.includes('billing.read');
  const own=c.permissions.includes('billing.own')&&!staffRead;
  const mayRead=platform||own||staffRead||canPlatform(c);
 const intents=mayRead?(await pool.query(`SELECT ${publicIntentColumns} FROM payment_intents n
  JOIN payment_provider_instances p ON p.id=n.provider_instance_id JOIN organizations o ON o.id=n.organization_id
  LEFT JOIN units u ON u.id=n.unit_id
   WHERE ($1::uuid IS NULL AND n.payment_domain='platform') OR
   (n.organization_id=$1 AND ((n.payment_domain='platform' AND $6::boolean) OR
    (n.payment_domain='property' AND $7::boolean AND ($2::uuid IS NULL OR u.building_id=$2)
     AND ($3::uuid IS NULL OR n.unit_id=$3) AND (NOT $4::boolean OR n.payer_user_id=$5))))
   ORDER BY n.created_at DESC,n.id LIMIT 101`,
   [c.organization_id,c.building_id,c.unit_id,own,req.user!.id,canPlatform(c),own||staffRead])).rows:[];
 const platformInvoices=canPlatform(c)?(await pool.query(`SELECT ${invoiceColumns} FROM platform_invoices i
  WHERE $1::uuid IS NULL OR i.organization_id=$1 ORDER BY i.issued_at DESC,i.id LIMIT 101`,[c.organization_id])).rows:[];
 const subscriptions=platform?(await pool.query(`SELECT s.id,o.name AS organization_name,p.name,p.amount_minor::text,p.currency,s.starts_on,s.ends_on
  FROM subscriptions s JOIN subscription_plans p ON p.id=s.plan_id JOIN organizations o ON o.id=s.organization_id
  WHERE s.status IN ('active','trial','past_due') ORDER BY o.name,s.id LIMIT 101`)).rows:[];
 const payableInvoices=own&&c.unit_id?(await pool.query(`SELECT * FROM (SELECT i.id,i.period,i.currency,${invoiceAmounts}
  FROM invoices i WHERE i.organization_id=$1 AND i.unit_id=$2 AND i.payer_user_id=$3 AND i.status='published') due
  WHERE balance_minor::bigint>0 ORDER BY period,id LIMIT 101`,[c.organization_id,c.unit_id,req.user!.id])).rows:[];
 const rail=instances.find(i=>i.provider_code===(platform?'ameriabank':'arca')&&i.environment===(process.env.NODE_ENV==='production'?'production':'sandbox'));
 res.json({providers:definitions,instances,intents:intents.slice(0,100),
  platformInvoices:platformInvoices.slice(0,100),subscriptions:subscriptions.slice(0,100),
  payableInvoices:payableInvoices.slice(0,100),
  readiness:readiness(rail),canConfigure:platform||(!c.building_id&&!c.unit_id&&c.permissions.includes('organization.settings')),
  canIssuePlatformInvoice:platform,hasMore:[intents,platformInvoices,subscriptions,payableInvoices].some(r=>r.length>100)});
});
const ledgerQuery=z.object({q:z.string().trim().max(160).default(''),from:date.optional(),to:date.optional(),
 page:z.coerce.number().int().min(1).max(10000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(25)})
 .strict().refine(b=>!b.from||!b.to||b.from<=b.to,{path:['to'],message:'invalid_date_range'});
const ledgerBase=`SELECT i.id,o.company_type,o.name AS organization_name,i.issued_at,i.billing_period,
 p.name AS plan_name,i.amount_minor::text AS amount_minor,i.currency,i.status,
 COALESCE((SELECT sum(a.amount_minor) FROM platform_payment_allocations a WHERE a.platform_invoice_id=i.id),0)::text AS paid_minor
 FROM platform_invoices i JOIN organizations o ON o.id=i.organization_id
 JOIN subscriptions s ON s.id=i.subscription_id JOIN subscription_plans p ON p.id=s.plan_id`;
function ledgerWhere(b:z.infer<typeof ledgerQuery>){
 const params:unknown[]=[],where:string[]=[];
 if(b.q){const pattern=`%${b.q.replace(/[\\%_]/g,'\\$&')}%`;
  params.push(pattern);const n=params.length;
  where.push(`(o.name ILIKE $${n} OR p.name ILIKE $${n} OR o.company_type ILIKE $${n})`);}
 if(b.from){params.push(b.from);where.push(`i.issued_at >= $${params.length}::date`);}
 if(b.to){params.push(b.to);where.push(`i.issued_at < $${params.length}::date + interval '1 day'`);}
 return {where:where.join(' AND ')||'TRUE',params};
}
async function platformLedger(req:Request,res:any,exportCsv:boolean){
 const c=await context(req);
 if(c.organization_id)throw new ApiError(403,'platform_scope_required');
 await requirePermission(req,'subscriptions.manage');
 const b=ledgerQuery.parse(req.query),filter=ledgerWhere(b);
 if(exportCsv){
  const rows=(await pool.query(`${ledgerBase} WHERE ${filter.where} ORDER BY i.issued_at DESC,i.id DESC LIMIT 10001`,filter.params)).rows;
  if(rows.length>10000)throw new ApiError(413,'export_limit_exceeded');
  const cell=(value:unknown)=>{const raw=String(value??''),safe=/^\s*[=+\-@]/.test(raw)?`'${raw}`:raw;return '"'+safe.replace(/"/g,'""')+'"';};
  const csv=['company_type,organization,issued_at,billing_period,plan,amount,currency,paid,status',
   ...rows.map(r=>[r.company_type,r.organization_name,r.issued_at,r.billing_period,r.plan_name,
    r.amount_minor,r.currency,r.paid_minor,r.status].map(cell).join(','))].join('\r\n');
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition','attachment; filename="company-payments.csv"');
  res.send('\uFEFF'+csv);return;
 }
 const countParams:unknown[]=[b.q,`%${b.q.replace(/[\\%_]/g,'\\$&')}%`,b.from??null,b.to??null];
 const total=Number((await pool.query(`SELECT count(*)::int AS n FROM (${ledgerBase}) t
  WHERE ($1='' OR t.organization_name ILIKE $2 OR t.plan_name ILIKE $2 OR t.company_type ILIKE $2)
   AND ($3::date IS NULL OR t.issued_at >= $3::date)
   AND ($4::date IS NULL OR t.issued_at < $4::date + interval '1 day')`,countParams)).rows[0].n);
 const rows=(await pool.query(`${ledgerBase} WHERE ${filter.where} ORDER BY i.issued_at DESC,i.id DESC
  LIMIT $${filter.params.length+1} OFFSET $${filter.params.length+2}`,
 [...filter.params,b.pageSize,(b.page-1)*b.pageSize])).rows;
 res.json({items:rows,total,page:b.page,pageSize:b.pageSize});
}
payments.get('/payments/platform-ledger',async(req,res)=>platformLedger(req,res,false));
payments.get('/payments/platform-ledger/export.csv',async(req,res)=>platformLedger(req,res,true));
const credentials=z.object({clientId:z.string().min(1).max(200),username:z.string().min(1).max(200),password:z.string().min(1).max(2000)}).strict();
payments.post('/payments/provider-instances',async(req,res)=>{
 const b=z.object({providerCode:z.enum(['ameriabank','arca','telcell']),environment:z.enum(['sandbox','production']),
  revision:z.number().int().positive().optional(),credentials:credentials.optional()}).strict().parse(req.body);
 const c=await configurationPermission(req,b.providerCode);
 if(b.providerCode!=='ameriabank'&&b.credentials)throw new ApiError(409,'provider_credential_schema_contract_required');
 if(b.credentials&&operationsEncryptionState()!=='configured')throw new ApiError(409,'operations_encryption_not_configured');
 res.status(201).json(await transaction(async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`payment-config:${b.providerCode}:${c.organization_id??'platform'}:${b.environment}`]);
  const prior=(await db.query(`SELECT id,revision FROM payment_provider_instances WHERE provider_code=$1 AND environment=$2 AND organization_id IS NOT DISTINCT FROM $3::uuid FOR UPDATE`,
   [b.providerCode,b.environment,c.organization_id])).rows[0];
  if(prior&&prior.revision!==b.revision)throw new ApiError(409,'stale_version');
  if(!prior&&b.revision!==undefined)throw new ApiError(409,'stale_version');
  const id=prior?.id??(await db.query('SELECT gen_random_uuid() AS id')).rows[0].id;
  const encrypted=b.credentials?operationsCipher().seal(Buffer.from(JSON.stringify(b.credentials)),`payment:${id}:${c.organization_id??'platform'}:${b.providerCode}`):null;
  if(prior)await db.query(`UPDATE payment_provider_instances SET encrypted_credentials=COALESCE($2,encrypted_credentials),
   status='contract_required',enabled=false,revision=revision+1,updated_at=now(),
   last_health_check=NULL,last_success_at=NULL,last_error=NULL WHERE id=$1`,[id,encrypted]);
  else await db.query(`INSERT INTO payment_provider_instances(id,provider_code,provider_type,payment_domain,scope_type,organization_id,environment,encrypted_credentials)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[id,b.providerCode,b.providerCode==='ameriabank'?'PLATFORM_PAYMENT':'PROPERTY_PAYMENT',
    b.providerCode==='ameriabank'?'platform':'property',c.organization_id?'organization':'platform',c.organization_id,b.environment,encrypted]);
  await record(db,req,c,prior&&b.credentials?'credentials.rotated':'provider.configured','payment_provider_instance',id,{provider:b.providerCode,environment:b.environment});
  return (await db.query(`SELECT ${instanceColumns} FROM payment_provider_instances WHERE id=$1`,[id])).rows[0];
 }));
});
payments.post('/payments/provider-instances/:id/disable',async(req,res)=>{
 const {i,c}=await scopedInstance(req);
 res.json(await transaction(async db=>{
  const changed=(await db.query(`UPDATE payment_provider_instances SET enabled=false,status='disabled',revision=revision+1,updated_at=now() WHERE id=$1 RETURNING ${instanceColumns}`,[i.id])).rows[0];
  await record(db,req,c,'provider.disabled','payment_provider_instance',i.id);return changed;
 }));
});
payments.post('/payments/provider-instances/:id/test',async(req,res)=>{
 const {i,c}=await scopedInstance(req);
 if(i.provider_code==='ameriabank'&&i.status!=='disabled'){
  if(!i.credentials_configured){res.json({status:'credentials_required',onlineAvailable:false,reason:'credentials_missing'});return}
  if(operationsEncryptionState()!=='configured')throw new ApiError(409,'operations_encryption_not_configured');
  // Persist a short throttle before network IO; concurrent requests cannot flood
  // the bank. Capture the exact credential revision, not a later configuration.
  const row=(await pool.query(`UPDATE payment_provider_instances SET last_health_check=now()
   WHERE id=$1 AND revision=$2 AND status<>'disabled'
   AND (last_health_check IS NULL OR last_health_check<now()-interval '30 seconds')
   RETURNING encrypted_credentials`,[i.id,i.revision])).rows[0];
  if(!row)throw new ApiError(409,'connection_test_busy_or_configuration_changed');
  let result;
  try{
   const bytes=operationsCipher().open(row.encrypted_credentials,`payment:${i.id}:platform:ameriabank`);
   try{result=await checkAmeriaConnection(JSON.parse(bytes.toString('utf8')),i.environment)}finally{bytes.fill(0)}
  }catch{result={status:'failed',onlineAvailable:false,reason:'credentials_unavailable'} as const}
  const persisted=await transaction(async db=>{
   const updated=await db.query(`UPDATE payment_provider_instances SET last_error=$3,
    last_success_at=CASE WHEN $4 THEN now() ELSE last_success_at END
    WHERE id=$1 AND revision=$2 AND status<>'disabled' RETURNING id`,
    [i.id,i.revision,result.status==='connected'?null:result.reason,result.status==='connected']);
   if(!updated.rowCount)return false;
   await record(db,req,c,'provider.connection_tested','payment_provider_instance',i.id,
    {provider:'ameriabank',environment:i.environment,status:result.status,reason:result.reason});
   return true;
  });
  if(!persisted)throw new ApiError(409,'stale_version');
  res.json(result);return;
 }
 res.json({status:i.status==='disabled'?'disabled':'contract_required',onlineAvailable:false,
  reason:i.credentials_configured?'credentials_saved_transaction_test_required':'verified_provider_contract_required'});
});
payments.post('/payments/platform-invoices',async(req,res)=>{
 const c=await requirePermission(req,'subscriptions.manage');if(c.organization_id)throw new ApiError(403,'platform_scope_required');
 const b=z.object({subscriptionId:uuid,period:z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  dueOn:date,key:uuid}).strict().parse(req.body);
 res.status(201).json(await transaction(async db=>idempotent(db,req,b.key,b,async()=>{
  const s=(await db.query(`SELECT s.*,p.amount_minor::text,p.currency FROM subscriptions s JOIN subscription_plans p ON p.id=s.plan_id
   WHERE s.id=$1 FOR UPDATE OF s`,[b.subscriptionId])).rows[0];
  if(!s)throw new ApiError(404,'not_found');
  if(!['active','trial','past_due'].includes(s.status)||b.period+ '-01'>new Date(s.ends_on).toISOString().slice(0,10)
   ||b.period<new Date(s.starts_on).toISOString().slice(0,7))throw new ApiError(409,'subscription_period_not_billable');
  const prior=(await db.query('SELECT * FROM platform_invoices WHERE subscription_id=$1 AND billing_period=$2',[s.id,b.period+'-01'])).rows[0];
  if(prior)throw new ApiError(409,'platform_invoice_exists');
  const row=(await db.query(`INSERT INTO platform_invoices(organization_id,subscription_id,billing_period,amount_minor,currency,due_at,created_by)
   VALUES($1,$2,$3,$4,$5,($6::date+time '23:59:59') AT TIME ZONE 'Asia/Yerevan',$7) RETURNING *`,
   [s.organization_id,s.id,b.period+'-01',s.amount_minor,s.currency,b.dueOn,req.user!.id])).rows[0];
  await record(db,req,{...c,organization_id:s.organization_id},'invoice.created','platform_invoice',row.id,{domain:'platform'});
  return {...row,amount_minor:String(row.amount_minor),paid_minor:'0'};
 })));
});
payments.post('/payments/intents',async(req,res)=>{
 const active=await context(req);
 const c=req.body?.domain==='platform'?await requirePermission(req,active.organization_id?'platform_billing.pay':'subscriptions.manage'):await requirePermission(req,'billing.own');
 res.status(201).json(await createIntent(req,c,req.body));
});
payments.get('/payments/intents/:id',async(req,res)=>{
 const c=await workspacePermission(req),id=uuid.parse(req.params.id);
 const n=(await pool.query('SELECT * FROM payment_intents WHERE id=$1',[id])).rows[0];
 if(!n)throw new ApiError(404,'not_found');await authorizeIntent(req,c,n);
 const transactions=(await pool.query(`SELECT id,transaction_type,amount_minor::text,currency,status,external_transaction_id,confirmed_at
  FROM payment_transactions WHERE payment_intent_id=$1 ORDER BY confirmed_at,id`,[id])).rows;
 const allocations=n.payment_domain==='property'?(await pool.query(`SELECT a.invoice_id,a.amount_minor::text FROM payment_allocations a
  JOIN payment_transactions t ON t.property_payment_id=a.payment_id WHERE t.payment_intent_id=$1`,[id])).rows:
  (await pool.query(`SELECT a.platform_invoice_id AS invoice_id,a.amount_minor::text FROM platform_payment_allocations a
  JOIN payment_transactions t ON t.id=a.payment_transaction_id WHERE t.payment_intent_id=$1`,[id])).rows;
 res.json({intent:await publicIntent(id),transactions,allocations});
});
payments.post('/payments/intents/:id/verify',async(req,res)=>{
 const active=await context(req),id=uuid.parse(req.params.id);
 const n=(await pool.query(`SELECT payment_domain FROM payment_intents WHERE id=$1 AND
  (($2::uuid IS NULL AND payment_domain='platform') OR organization_id=$2)`,[id,active.organization_id])).rows[0];
 if(!n)throw new ApiError(404,'not_found');
 const c=await requirePermission(req,n.payment_domain==='platform'?(active.organization_id?'platform_billing.pay':'subscriptions.manage'):
  active.permissions.includes('payments.reconcile')?'payments.reconcile':'billing.own');
 z.object({}).strict().parse(req.body??{});
 res.json(await verifyIntent(req,c,id));
});
payments.get('/utilities/workspace',async(req,res)=>{
 const c=await requirePermission(req,'billing.own');
 if(!c.organization_id||!c.unit_id)throw new ApiError(403,'unit_scope_required');
 // No contract = no active catalog, subscriber lookup, cached fake zero or Pay.
 res.json({status:'CONTRACT_REQUIRED',capabilities:[],catalog:[],accounts:[],balanceState:'unavailable'});
});
