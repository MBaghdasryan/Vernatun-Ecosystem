import {config} from './config.js';
import {Router,type Request} from 'express';
import {z} from 'zod';
import {pool} from './db.js';
import {ApiError,context,requireAuth,requirePermission,scopedUnit} from './access.js';
import {transaction,record,idempotent,invoiceAmounts} from './operations.js';
import type {PoolClient} from 'pg';
import {resolvePayers} from './payer-responsibility-store.js';
import {createVersionedTariff} from './billing-configuration.js';
export const finance=Router();finance.use(requireAuth);
finance.post('/finance/tariffs',async(req,res,next)=>{
 if(typeof req.body?.serviceId!=='string')return next();
 const c=await requirePermission(req,'billing.calculate');
 res.status(201).json(await createVersionedTariff(req,c));
});
const uuid=z.string().uuid(),amount=z.string().regex(/^[1-9]\d{0,13}$/),currency=z.enum(['AMD','RUB','USD']);
const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s);
async function invoice(req:Request,id:string,db:PoolClient){
 const c=await context(req);
 const r=(await db.query('SELECT i.* FROM invoices i JOIN units u ON u.id=i.unit_id WHERE i.id=$1 AND i.organization_id=$2 AND ($3::uuid IS NULL OR u.building_id=$3) AND ($4::uuid IS NULL OR u.id=$4) FOR UPDATE OF i',[id,c.organization_id,c.building_id,c.unit_id])).rows[0];
 if(!r)throw new ApiError(404,'not_found');
 // Recompute append-only balances in a fresh command after the invoice lock.
 return Object.assign(r,(await db.query(`SELECT ${invoiceAmounts} FROM invoices i WHERE i.id=$1`,[id])).rows[0]);
}
finance.get('/finance',async(req,res)=>{const c=await requirePermission(req,'billing.read');const selected=currency.parse(req.query.currency??req.user!.currency);const invoices=(await pool.query(`SELECT i.*,u.number,${invoiceAmounts},(SELECT json_agg(l) FROM invoice_lines l WHERE l.invoice_id=i.id) AS lines FROM invoices i JOIN units u ON u.id=i.unit_id WHERE i.organization_id=$1 AND i.currency=$2 AND ($3::uuid IS NULL OR u.building_id=$3) AND ($4::uuid IS NULL OR u.id=$4) ORDER BY i.period DESC`,[c.organization_id,selected,c.building_id,c.unit_id])).rows;const tariffs=(await pool.query('SELECT t.*,s.name FROM tariffs t JOIN services s ON s.id=t.service_id WHERE t.organization_id=$1 AND t.currency=$2 ORDER BY created_at DESC',[c.organization_id,selected])).rows;const payers=(await pool.query(`SELECT p.*,u.number,s.name AS service_name,x.name AS payer_name FROM payer_assignments p JOIN units u ON u.id=p.unit_id JOIN services s ON s.id=p.service_id JOIN users x ON x.id=p.payer_user_id WHERE p.organization_id=$1 AND ($2::uuid IS NULL OR u.building_id=$2) AND ($3::uuid IS NULL OR u.id=$3)`,[c.organization_id,c.building_id,c.unit_id])).rows;res.json({invoices,tariffs,payers})});
finance.get('/finance/payer-candidates',async(req,res)=>{const c=await requirePermission(req,'billing.calculate');const unit=await scopedUnit(c,uuid.parse(req.query.unitId));res.json((await pool.query(`SELECT DISTINCT u.id,u.name FROM users u JOIN role_assignments a ON a.user_id=u.id JOIN memberships m ON m.user_id=u.id AND m.organization_id=a.organization_id WHERE a.organization_id=$1 AND a.unit_id=$2 AND a.role_key IN ('unit_owner','renter') AND a.active AND m.active AND NOT u.blocked AND a.starts_at<=now() AND (a.expires_at IS NULL OR a.expires_at>now())`,[c.organization_id,unit.id])).rows)});
finance.post('/finance/tariffs',async(req,res)=>{const c=await requirePermission(req,'billing.calculate');if(c.building_id)throw new ApiError(403,'forbidden');const b=z.object({name:z.string().trim().min(2).max(160),amountMinor:amount,currency,basis:z.enum(['unit','area'])}).strict().parse(req.body);res.status(201).json(await transaction(async db=>{const s=(await db.query('INSERT INTO services(organization_id,name) VALUES($1,$2) RETURNING id',[c.organization_id,b.name])).rows[0];const t=(await db.query('INSERT INTO tariffs(organization_id,service_id,amount_minor,currency,basis) VALUES($1,$2,$3,$4,$5) RETURNING *',[c.organization_id,s.id,b.amountMinor,b.currency,b.basis])).rows[0];await record(db,req,c,'tariff.create','tariff',t.id);return t}))});
finance.post('/finance/payers',async(req,res)=>{const c=await requirePermission(req,'billing.calculate');const b=z.object({unitId:uuid,payerId:uuid,serviceId:uuid,startsOn:day,endsOn:day.optional()}).strict().parse(req.body);await scopedUnit(c,b.unitId);if(b.endsOn&&b.endsOn<b.startsOn)throw new ApiError(400,'validation_error');res.status(201).json(await transaction(async db=>{await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[b.unitId+b.serviceId]);const valid=await db.query(`SELECT a.id FROM role_assignments a JOIN memberships m ON m.user_id=a.user_id AND m.organization_id=a.organization_id JOIN users u ON u.id=a.user_id WHERE a.user_id=$1 AND a.unit_id=$2 AND a.organization_id=$3 AND a.role_key IN ('unit_owner','renter') AND a.active AND m.active AND NOT u.blocked AND a.starts_at<=now() AND (a.expires_at IS NULL OR a.expires_at>now())`,[b.payerId,b.unitId,c.organization_id]);if(!valid.rowCount)throw new ApiError(403,'forbidden');if(!(await db.query('SELECT id FROM services WHERE id=$1 AND organization_id=$2',[b.serviceId,c.organization_id])).rowCount)throw new ApiError(404,'not_found');if((await db.query(`SELECT id FROM payer_assignments WHERE unit_id=$1 AND service_id=$2 AND starts_on<=COALESCE($3::date,'infinity'::date) AND COALESCE(ends_on,'infinity'::date)>=$4::date`,[b.unitId,b.serviceId,b.endsOn??null,b.startsOn])).rowCount)throw new ApiError(409,'payer_overlap');const r=(await db.query('INSERT INTO payer_assignments(organization_id,unit_id,payer_user_id,service_id,starts_on,ends_on) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[c.organization_id,b.unitId,b.payerId,b.serviceId,b.startsOn,b.endsOn??null])).rows[0];await record(db,req,c,'payer.assign','payer_assignment',r.id);return r}))});
finance.post('/finance/calculate',async(req,res)=>{
 const c=await requirePermission(req,'billing.calculate');
 const b=z.object({payerAssignmentId:uuid,tariffId:uuid,period:day.refine(v=>v.endsWith('-01'))}).strict().parse(req.body);
 res.status(201).json(await transaction(async db=>{
   // Keep unit -> payer assignment order; batch posting and lease mutations
   // reserve the unit first as well.
  await db.query(`SELECT u.id FROM units u JOIN payer_assignments p ON p.unit_id=u.id
   WHERE p.id=$1 AND p.organization_id=$2 FOR SHARE OF u`,[b.payerAssignmentId,c.organization_id]);
  const p=(await db.query(`SELECT p.*,u.area::text,u.building_id FROM payer_assignments p JOIN units u ON u.id=p.unit_id
   WHERE p.id=$1 AND p.organization_id=$2 AND p.starts_on<=$3 AND(p.ends_on IS NULL OR p.ends_on>=$3) FOR UPDATE OF p`,
   [b.payerAssignmentId,c.organization_id,b.period])).rows[0];
  if(!p||c.building_id&&c.building_id!==p.building_id||c.unit_id&&c.unit_id!==p.unit_id)throw new ApiError(404,'not_found');
  const t=(await db.query('SELECT t.*,s.name FROM tariffs t JOIN services s ON s.id=t.service_id WHERE t.id=$1 AND t.organization_id=$2 AND t.service_id=$3',[b.tariffId,c.organization_id,p.service_id])).rows[0];
  if(!t)throw new ApiError(404,'not_found');
  const prior=(await db.query('SELECT invoice_id,tariff_id FROM charges WHERE payer_assignment_id=$1 AND period=$2',[p.id,b.period])).rows[0];
  if(prior){if(prior.tariff_id!==t.id)throw new ApiError(409,'already_calculated');return {id:prior.invoice_id,replayed:true}}
  const effective=(await resolvePayers(db,[p.id],b.period,true))[0];
  const qty=t.basis==='unit'?100n:BigInt(p.area.replace('.','')),total=(BigInt(t.amount_minor)*qty+50n)/100n;
  if(total<=0n||total>99999999999999n)throw new ApiError(400,'invalid_amount');
  const i=(await db.query(`INSERT INTO invoices(organization_id,unit_id,payer_user_id,period,amount_minor,currency,status,created_by)
   VALUES($1,$2,$3,$4,$5,$6,'draft',$7) RETURNING *`,
   [c.organization_id,p.unit_id,effective.payerId,b.period,total.toString(),t.currency,req.user!.id])).rows[0];
  await db.query('INSERT INTO invoice_lines(invoice_id,description,quantity_hundredths,rate_minor,amount_minor) VALUES($1,$2,$3,$4,$5)',[i.id,t.name,qty.toString(),t.amount_minor,total.toString()]);
  await db.query(`INSERT INTO charges(organization_id,payer_assignment_id,period,tariff_id,invoice_id,payer_delegation_id)
   VALUES($1,$2,$3,$4,$5,$6)`,[c.organization_id,p.id,b.period,t.id,i.id,effective.delegationId]);
  await record(db,req,c,'invoice.calculate','invoice',i.id,{payerDelegationId:effective.delegationId});return i;
 }));
});
finance.post('/finance/invoices/:id/publish',async(req,res)=>{const c=await requirePermission(req,'billing.publish');const id=uuid.parse(req.params.id);res.json(await transaction(async db=>{const i=await invoice(req,id,db);if(i.status==='published')return {id,status:i.status};await db.query("UPDATE invoices SET status='published',published_by=$1,published_at=now() WHERE id=$2",[req.user!.id,id]);await record(db,req,c,'invoice.publish','invoice',id);return {id,status:'published'}}))});
finance.post('/finance/payments',async(req,res)=>{const c=await requirePermission(req,'payments.reconcile');const b=z.object({invoiceId:uuid,amountMinor:amount,source:z.enum(['manual_bank','sandbox']),reference:z.string().trim().min(3).max(120)}).strict().parse(req.body);res.status(201).json(await transaction(async db=>{const i=await invoice(req,b.invoiceId,db);if(b.source==='sandbox'&&config.NODE_ENV==='production')throw new ApiError(403,'sandbox_disabled');if(i.status!=='published')throw new ApiError(409,'not_published');await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[c.organization_id+b.source+b.reference]);const old=(await db.query('SELECT * FROM payments WHERE organization_id=$1 AND source=$2 AND reference=$3',[c.organization_id,b.source,b.reference])).rows[0];if(old){const allocation=(await db.query('SELECT invoice_id FROM payment_allocations WHERE payment_id=$1',[old.id])).rows[0];if(old.amount_minor!==b.amountMinor||allocation?.invoice_id!==i.id)throw new ApiError(409,'idempotency_conflict');return {...old,replayed:true}}if(BigInt(b.amountMinor)>BigInt(i.balance_minor))throw new ApiError(400,'overpayment');const p=(await db.query('INSERT INTO payments(organization_id,payer_user_id,amount_minor,currency,source,reference,confirmed_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[c.organization_id,i.payer_user_id,b.amountMinor,i.currency,b.source,b.reference,req.user!.id])).rows[0];await db.query('INSERT INTO payment_allocations(organization_id,payment_id,invoice_id,amount_minor,created_by) VALUES($1,$2,$3,$4,$5)',[c.organization_id,p.id,i.id,b.amountMinor,req.user!.id]);await record(db,req,c,'payment.confirm','payment',p.id,{source:b.source});return p}))});
finance.post('/finance/adjustments',async(req,res)=>{const c=await requirePermission(req,'billing.publish');const b=z.object({invoiceId:uuid,amountMinor:z.string().regex(/^-?[1-9]\d{0,13}$/),reason:z.string().trim().min(5).max(1000),key:uuid}).strict().parse(req.body);res.status(201).json(await transaction(async db=>{const i=await invoice(req,b.invoiceId,db);return idempotent(db,req,b.key,b,async()=>{if(i.status!=='published'||BigInt(i.balance_minor)+BigInt(b.amountMinor)<0n)throw new ApiError(400,'invalid_amount');const a=(await db.query('INSERT INTO adjustments(organization_id,invoice_id,amount_minor,reason,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *',[c.organization_id,i.id,b.amountMinor,b.reason,req.user!.id])).rows[0];await record(db,req,c,'invoice.adjust','adjustment',a.id,{invoiceId:i.id});return a})}))});
finance.get('/finance/invoices/:id/details',async(req,res)=>{
 const c=await context(req);await requirePermission(req,c.permissions.includes('billing.read')?'billing.read':'billing.own');
 res.json(await transaction(async db=>{
  const i=await invoice(req,uuid.parse(req.params.id),db);
  if(!c.permissions.includes('billing.read')&&(i.payer_user_id!==req.user!.id||i.status!=='published'))throw new ApiError(404,'not_found');
  return {...i,
   lines:(await db.query('SELECT * FROM invoice_lines WHERE invoice_id=$1',[i.id])).rows,
   payments:(await db.query(`SELECT p.id,p.source,p.reference,p.created_at,a.amount_minor::text,
    a.id AS allocation_id,a.allocation_kind,a.created_at AS allocated_at
    FROM payments p JOIN payment_allocations a ON a.payment_id=p.id
    WHERE a.invoice_id=$1 ORDER BY a.created_at,a.id`,[i.id])).rows,
   adjustments:(await db.query('SELECT id,amount_minor::text,reason,created_at FROM adjustments WHERE invoice_id=$1',[i.id])).rows};
 }));
});
