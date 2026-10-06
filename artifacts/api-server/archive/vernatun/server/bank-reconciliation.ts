import {Router,type Request} from 'express';
import {z} from 'zod';
import type {PoolClient} from 'pg';
import {pool} from './db.js';
import {ApiError,context,requireAuth,requirePermission,scopedUnit,type Context} from './access.js';
import {transaction,idempotent,record,invoiceAmounts} from './operations.js';
import {uuid,version,minor,currency,day,hash,allocations,orgFinance} from './finance-shared.js';
export const bankReconciliation=Router();bankReconciliation.use(requireAuth);
const entry=z.object({externalId:z.string().trim().min(1).max(160),date:day,amountMinor:z.string().regex(/^-?[1-9]\d{0,13}$/),currency,payerText:z.string().max(200),purpose:z.string().max(1000),rawPayload:z.record(z.string().max(100),z.string().max(1000)).refine(v=>Object.keys(v).length<=64).optional()}).strict();
const importInput=z.object({key:uuid,account:z.string().trim().min(2).max(160),transactions:z.array(entry).min(1).max(1000)}).strict();
const available=`(p.amount_minor-COALESCE((SELECT sum(a.amount_minor) FROM payment_allocations a WHERE a.payment_id=p.id),0))::text`;
const bankStatus=`CASE WHEN b.ignored THEN 'ignored' WHEN b.payment_id IS NULL THEN 'unmatched'
 WHEN COALESCE((SELECT sum(a.amount_minor) FROM payment_allocations a WHERE a.payment_id=b.payment_id),0)>=b.amount_minor THEN 'matched'
 WHEN EXISTS(SELECT 1 FROM payment_allocations a WHERE a.payment_id=b.payment_id) THEN 'partially_matched' ELSE 'unmatched' END`;
async function bankRow(db:PoolClient,c:Context,id:string){
 const row=(await db.query('SELECT * FROM bank_transactions WHERE id=$1 AND organization_id=$2 FOR UPDATE',[id,c.organization_id])).rows[0];
 if(!row)throw new ApiError(404,'not_found');return row;
}
async function accountCandidates(db:PoolClient,c:Context,unitId:string){
 return (await db.query(`SELECT DISTINCT x.id,x.name FROM users x WHERE EXISTS(
 SELECT 1 FROM invoices i WHERE i.unit_id=$1 AND i.organization_id=$2 AND i.payer_user_id=x.id)
 OR EXISTS(SELECT 1 FROM payer_assignments a WHERE a.unit_id=$1 AND a.organization_id=$2 AND a.payer_user_id=x.id)
 OR EXISTS(SELECT 1 FROM role_assignments a WHERE a.unit_id=$1 AND a.organization_id=$2 AND a.user_id=x.id
 AND a.role_key IN ('unit_owner','renter') AND a.active AND a.starts_at<=now() AND (a.expires_at IS NULL OR a.expires_at>now()))
 ORDER BY x.name`,[unitId,c.organization_id])).rows;
}
async function importPreview(db:PoolClient,c:Context,b:z.infer<typeof importInput>,lock=false){
 if(lock)await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[c.organization_id+'bank:'+b.account]);
 const existing=(await db.query('SELECT external_id,fingerprint,id FROM bank_transactions WHERE organization_id=$1 AND account=$2 AND external_id=ANY($3::text[])',[c.organization_id,b.account,b.transactions.map(t=>t.externalId)])).rows;
 const seen=new Map<string,string>();
 const rows=b.transactions.map((t,index)=>{
  // Raw formatting is retained as evidence, but duplicate financial identity
  // compares normalized canonical fields, not CSV column order or whitespace.
  const fingerprint=hash([b.account,t.externalId,t.date,t.amountMinor,t.currency,t.payerText,t.purpose]);
  const old=existing.find(e=>e.external_id===t.externalId);const local=seen.get(t.externalId);seen.set(t.externalId,fingerprint);
  const prior=old?.fingerprint??local;
  return {...t,index,fingerprint,status:prior?(prior===fingerprint?'duplicate':'conflict'):'new',existingId:old?.id,warning:BigInt(t.amountMinor)<0n?'outgoing_not_reconcilable':null};
 });
 return {account:b.account,rows,newCount:rows.filter(r=>r.status==='new').length,duplicateCount:rows.filter(r=>r.status==='duplicate').length,conflictCount:rows.filter(r=>r.status==='conflict').length};
}
bankReconciliation.post('/finance/bank/imports/preview',async(req,res)=>{const c=orgFinance(await requirePermission(req,'payments.reconcile')),b=importInput.parse(req.body);res.json(await transaction(db=>importPreview(db,c,b)))});
bankReconciliation.get('/finance/bank/imports',async(req,res)=>{const c=orgFinance(await requirePermission(req,'payments.reconcile'));res.json((await pool.query('SELECT * FROM bank_import_batches WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 100',[c.organization_id])).rows)});
bankReconciliation.post('/finance/bank/imports',async(req,res)=>{
 const c=orgFinance(await requirePermission(req,'payments.reconcile')),b=importInput.parse(req.body);
 res.status(201).json(await transaction(db=>idempotent(db,req,b.key,b,async()=>{
  const preview=await importPreview(db,c,b,true);if(preview.conflictCount)throw new ApiError(409,'bank_reference_conflict');
  const batch=(await db.query('INSERT INTO bank_import_batches(organization_id,account,imported_count,duplicate_count,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *',[c.organization_id,b.account,preview.newCount,preview.duplicateCount,req.user!.id])).rows[0];
  for(const row of preview.rows.filter(r=>r.status==='new')){
   await db.query('INSERT INTO bank_transactions(organization_id,import_batch_id,account,external_id,transaction_date,amount_minor,currency,payer_text,purpose,raw_payload,fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[c.organization_id,batch.id,b.account,row.externalId,row.date,row.amountMinor,row.currency,row.payerText,row.purpose,JSON.stringify(row.rawPayload??{}),row.fingerprint]);
  }
  await record(db,req,c,'bank.import','bank_import',batch.id,{imported:preview.newCount,duplicates:preview.duplicateCount});return batch;
 })));
});
bankReconciliation.get('/finance/bank/transactions',async(req,res)=>{
 const c=orgFinance(await requirePermission(req,'payments.reconcile'));const status=z.enum(['matched','partially_matched','unmatched','ignored']).optional().parse(req.query.status);
 const page=z.coerce.number().int().min(0).max(100000).default(0).parse(req.query.page),limit=z.coerce.number().int().min(1).max(100).default(100).parse(req.query.limit);
 const search=z.string().trim().max(100).default('').parse(req.query.search);
 res.json((await pool.query(`SELECT * FROM (SELECT b.*,${bankStatus} AS status,p.payer_user_id,a.unit_id,u.number,
 CASE WHEN p.id IS NULL THEN NULL ELSE ${available} END AS credit_minor
 FROM bank_transactions b LEFT JOIN payments p ON p.id=b.payment_id LEFT JOIN payment_accounts a ON a.payment_id=p.id LEFT JOIN units u ON u.id=a.unit_id
 WHERE b.organization_id=$1) t WHERE ($2::text IS NULL OR status=$2)
 AND ($3='' OR external_id ILIKE '%'||$3||'%' OR payer_text ILIKE '%'||$3||'%' OR purpose ILIKE '%'||$3||'%' OR number ILIKE '%'||$3||'%')
 ORDER BY created_at DESC,id DESC LIMIT $4 OFFSET $5`,[c.organization_id,status??null,search,limit,page*limit])).rows);
});
bankReconciliation.get('/finance/accounts',async(req,res)=>{
 const c=orgFinance(await requirePermission(req,'payments.reconcile'));const unit=await scopedUnit(c,uuid.parse(req.query.unitId));
 res.json(await transaction(db=>accountCandidates(db,c,unit.id)));
});
bankReconciliation.get('/finance/bank/transactions/:id/suggestions',async(req,res)=>{
 const c=orgFinance(await requirePermission(req,'payments.reconcile'));
 const unitId=uuid.optional().parse(req.query.unitId),payerId=uuid.optional().parse(req.query.payerId);
 if(unitId)await scopedUnit(c,unitId);
 res.json(await transaction(async db=>{
  const row=await bankRow(db,c,uuid.parse(req.params.id));
  const candidates=(await db.query(`SELECT i.*,${invoiceAmounts},u.number,x.name AS payer_name
  FROM invoices i JOIN units u ON u.id=i.unit_id JOIN users x ON x.id=i.payer_user_id
  WHERE i.organization_id=$1 AND i.currency=$2 AND i.status='published'
  AND (i.amount_minor+COALESCE((SELECT sum(a.amount_minor) FROM adjustments a WHERE a.invoice_id=i.id),0)-COALESCE((SELECT sum(a.amount_minor) FROM payment_allocations a WHERE a.invoice_id=i.id),0))>0
  AND ($3::uuid IS NULL OR EXISTS(SELECT 1 FROM payment_accounts a WHERE a.payment_id=$3 AND a.unit_id=i.unit_id AND a.payer_user_id=i.payer_user_id))
  AND ($4::uuid IS NULL OR i.unit_id=$4) AND ($5::uuid IS NULL OR i.payer_user_id=$5)
  ORDER BY (position(lower(i.id::text) in lower($6::text))>0) DESC,i.period,i.id LIMIT 200`,[c.organization_id,row.currency,row.payment_id,unitId??null,payerId??null,row.purpose])).rows;
  return candidates.map(i=>{
   const codes:string[]=[];if(row.purpose.toLowerCase().includes(i.id.toLowerCase()))codes.push('invoice_reference');
   if(String(row.purpose).split(/[^a-zA-Z0-9А-Яа-яԱ-ֆ-]+/u).includes(String(i.number)))codes.push('unit_reference');
   if(String(row.payer_text).toLocaleLowerCase().includes(String(i.payer_name).toLocaleLowerCase()))codes.push('payer_name');
   return {...i,suggestionCodes:codes,score:codes.reduce((s,k)=>s+(k==='invoice_reference'?100:k==='unit_reference'?50:20),0)};
  }).sort((a,b)=>b.score-a.score);
 }));
});
async function allocate(db:PoolClient,req:Request,c:Context,payment:any,account:any,rows:z.infer<typeof allocations>,kind:'initial'|'credit'){
 // Lock the original payment before balances and invoice locks. All invoice
 // locks follow a deterministic order, including multi-invoice allocations.
 const p=(await db.query('SELECT p.* FROM payments p WHERE p.id=$1 AND p.organization_id=$2 FOR UPDATE',[payment.id,c.organization_id])).rows[0];
 // Read aggregates in a NEW command after the lock: immutable parent rows
 // are not updated when their append-only ledger changes while we wait.
 p.remaining_minor=(await db.query('SELECT '+available+' AS remaining_minor FROM payments p WHERE p.id=$1',[p.id])).rows[0].remaining_minor;
 const total=rows.reduce((s,r)=>s+BigInt(r.amountMinor),0n);
 if(total>BigInt(p.remaining_minor))throw new ApiError(400,'allocation_exceeds_payment');
 for(const row of [...rows].sort((a,b)=>a.invoiceId.localeCompare(b.invoiceId))){
  const i=(await db.query('SELECT i.* FROM invoices i WHERE i.id=$1 AND i.organization_id=$2 FOR UPDATE',[row.invoiceId,c.organization_id])).rows[0];
  if(!i||i.unit_id!==account.unit_id||i.payer_user_id!==p.payer_user_id)throw new ApiError(404,'not_found');
  if(i.status!=='published'||i.currency!==p.currency)throw new ApiError(400,'allocation_identity_mismatch');
  Object.assign(i,(await db.query(`SELECT ${invoiceAmounts} FROM invoices i WHERE i.id=$1`,[i.id])).rows[0]);
  if(BigInt(row.amountMinor)>BigInt(i.balance_minor))throw new ApiError(400,'allocation_exceeds_invoice');
  await db.query('INSERT INTO payment_allocations(organization_id,payment_id,invoice_id,amount_minor,created_by,allocation_kind) VALUES($1,$2,$3,$4,$5,$6)',[c.organization_id,p.id,i.id,row.amountMinor,req.user!.id,kind]);
 }
 return {paymentId:p.id,allocatedMinor:total.toString(),creditMinor:(BigInt(p.remaining_minor)-total).toString(),currency:p.currency};
}
bankReconciliation.post('/finance/bank/transactions/:id/confirm',async(req,res)=>{
 const c=orgFinance(await requirePermission(req,'payments.reconcile')),id=uuid.parse(req.params.id);
 const b=z.object({key:uuid,version,unitId:uuid,payerId:uuid,allocations}).strict().parse(req.body);await scopedUnit(c,b.unitId);
 res.json(await transaction(async db=>{
  const row=await bankRow(db,c,id);
  return idempotent(db,req,b.key,b,async()=>{
   if(row.version!==b.version)throw new ApiError(409,'stale_version');
   if(row.payment_id||row.ignored)throw new ApiError(409,'bank_already_processed');
   if(BigInt(row.amount_minor)<=0n)throw new ApiError(400,'outgoing_not_reconcilable');
   if(!(await accountCandidates(db,c,b.unitId)).some(u=>u.id===b.payerId))throw new ApiError(404,'not_found');
   const p=(await db.query("INSERT INTO payments(organization_id,payer_user_id,amount_minor,currency,source,reference,confirmed_by) VALUES($1,$2,$3,$4,'bank_import',$5,$6) RETURNING *",[c.organization_id,b.payerId,row.amount_minor,row.currency,'bank:'+row.id,req.user!.id])).rows[0];
   const account=(await db.query('INSERT INTO payment_accounts(payment_id,organization_id,unit_id,payer_user_id,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *',[p.id,c.organization_id,b.unitId,b.payerId,req.user!.id])).rows[0];
   const result=await allocate(db,req,c,p,account,b.allocations,'initial');
   await db.query('UPDATE bank_transactions SET payment_id=$2,confirmed_by=$3,confirmed_at=now(),version=version+1 WHERE id=$1',[row.id,p.id,req.user!.id]);
   await record(db,req,c,'bank.confirm','bank_transaction',row.id,{...result,unitId:b.unitId,payerId:b.payerId});return {...result,id:row.id};
  });
 }));
});
bankReconciliation.post('/finance/bank/transactions/:id/ignore',async(req,res)=>{
 const c=orgFinance(await requirePermission(req,'payments.reconcile')),id=uuid.parse(req.params.id),b=z.object({key:uuid,version,reason:z.string().trim().min(3).max(1000)}).strict().parse(req.body);
 res.json(await transaction(async db=>{
  const row=await bankRow(db,c,id);return idempotent(db,req,b.key,b,async()=>{
   if(row.version!==b.version)throw new ApiError(409,'stale_version');if(row.payment_id)throw new ApiError(409,'bank_already_processed');
   const updated=(await db.query('UPDATE bank_transactions SET ignored=true,ignore_reason=$2,version=version+1 WHERE id=$1 RETURNING *',[row.id,b.reason])).rows[0];await record(db,req,c,'bank.ignore','bank_transaction',row.id,{reason:b.reason});return updated;
  });
 }));
});
bankReconciliation.get('/finance/credits',async(req,res)=>{
 const existing=await context(req),own=!existing.permissions.includes('payments.reconcile');
 const c=await requirePermission(req,own?'billing.own':'payments.reconcile');if(!own)orgFinance(c);
 res.json((await pool.query(`SELECT p.id,p.reference,p.currency,p.amount_minor::text,${available} AS credit_minor,p.created_at,a.unit_id,a.payer_user_id,u.number,x.name AS payer_name,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'invoiceId',r.invoice_id,'amountMinor',r.amount_minor::text,'kind',r.allocation_kind,'createdAt',r.created_at) ORDER BY r.created_at,r.id) FROM payment_allocations r WHERE r.payment_id=p.id),'[]'::jsonb) AS allocations
 FROM payment_accounts a JOIN payments p ON p.id=a.payment_id JOIN units u ON u.id=a.unit_id JOIN users x ON x.id=a.payer_user_id
 WHERE a.organization_id=$1 AND ($2::uuid IS NULL OR a.payer_user_id=$2)
 AND ($3::uuid IS NULL OR u.building_id=$3) AND ($4::uuid IS NULL OR a.unit_id=$4)
 ORDER BY p.created_at DESC LIMIT 200`,[c.organization_id,own?req.user!.id:null,c.building_id,c.unit_id])).rows);
});
bankReconciliation.post('/finance/credits/:id/allocate',async(req,res)=>{
 const c=orgFinance(await requirePermission(req,'payments.reconcile')),id=uuid.parse(req.params.id),b=z.object({key:uuid,allocations:allocations.refine(rows=>rows.length>0)}).strict().parse(req.body);
 res.json(await transaction(async db=>{
  const account=(await db.query('SELECT * FROM payment_accounts WHERE payment_id=$1 AND organization_id=$2',[id,c.organization_id])).rows[0];if(!account)throw new ApiError(404,'not_found');
  return idempotent(db,req,b.key,b,async()=>{const result=await allocate(db,req,c,{id},account,b.allocations,'credit');await record(db,req,c,'credit.allocate','payment',id,result);return result});
 }));
});
