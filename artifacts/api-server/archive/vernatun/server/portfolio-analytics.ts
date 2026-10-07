import {Router} from 'express';
import {z} from 'zod';
import {pool} from './db.js';
import {requireAuth,requirePermission,context,ApiError} from './access.js';
import {transaction,record,idempotent} from './operations.js';
import {uuid,day,currency} from './finance-shared.js';
export const portfolioAnalytics=Router();portfolioAnalytics.use(requireAuth);
const filters=z.object({from:day,to:day,currency:currency.default('AMD'),buildingId:uuid.optional(),propertyId:uuid.optional(),portfolioObjectId:uuid.optional()});
async function scope(req:any,score=false){
 const c=await context(req),p=score&&c.permissions.includes('workorders.accept')?'workorders.accept':c.permissions.includes('reports.read')?'reports.read':'expenses.read';
 await requirePermission(req,p);if(!c.organization_id||c.unit_id)throw new ApiError(403,'forbidden');
 if(!c.modules?.includes(score?'handover':'finance'))throw new ApiError(403,'module_disabled');
 const f=filters.parse(req.query);if(f.to<f.from||Date.parse(f.to)-Date.parse(f.from)>3660*86400000)throw new ApiError(400,'invalid_dates');
 // Preserve legacy propertyId=building compatibility; new group dimension is explicit.
 if(f.buildingId&&f.propertyId&&f.buildingId!==f.propertyId)throw new ApiError(400,'invalid_filters');
 if(f.portfolioObjectId&&!(await pool.query('SELECT 1 FROM portfolio_objects WHERE id=$1 AND organization_id=$2',[f.portfolioObjectId,c.organization_id])).rowCount)throw new ApiError(404,'not_found');
 const buildings=(await pool.query('SELECT id,name,portfolio_object_id FROM buildings WHERE organization_id=$1 AND ($2::uuid IS NULL OR id=$2) AND ($3::uuid IS NULL OR id=$3) AND ($4::uuid IS NULL OR portfolio_object_id=$4) ORDER BY name',[c.organization_id,c.building_id,f.buildingId??f.propertyId??null,f.portfolioObjectId??null])).rows;
 const timezone=(await pool.query('SELECT timezone FROM organizations WHERE id=$1',[c.organization_id])).rows[0].timezone;
 return {c,f,buildings,timezone};
}
portfolioAnalytics.get('/portfolio/analytics',async(req,res)=>{
 const {c,f,buildings,timezone:tz}=await scope(req),rows:any[]=[];
 for(const b of buildings){
 const count=(await pool.query(`SELECT count(*)::int AS total,count(*) FILTER(WHERE EXISTS(SELECT 1 FROM occupancies o WHERE o.unit_id=u.id AND o.starts_on<=$2) OR EXISTS(SELECT 1 FROM leases l WHERE l.unit_id=u.id AND l.starts_on<=$2))::int AS known,count(*) FILTER(WHERE EXISTS(SELECT 1 FROM occupancies o WHERE o.unit_id=u.id AND o.starts_on<=$2 AND (o.ends_on IS NULL OR o.ends_on>=$2))
 OR EXISTS(SELECT 1 FROM leases l WHERE l.unit_id=u.id AND l.cancelled_at IS NULL AND l.starts_on<=$2 AND l.ends_on>=$2))::int AS occupied FROM units u WHERE u.building_id=$1`,[b.id,f.to])).rows[0];
 const invoices=(await pool.query(`SELECT i.amount_minor::text,
 COALESCE((SELECT sum(a.amount_minor) FROM adjustments a WHERE a.invoice_id=i.id AND a.created_at<($3::date+1)::timestamp AT TIME ZONE $5),0)::text AS adjustments,
 COALESCE((SELECT sum(a.amount_minor) FROM payment_allocations a WHERE a.invoice_id=i.id AND a.created_at<($3::date+1)::timestamp AT TIME ZONE $5),0)::text AS paid
 FROM invoices i JOIN units u ON u.id=i.unit_id WHERE u.building_id=$1 AND i.period BETWEEN $2 AND $3 AND i.currency=$4 AND i.status='published'`,[b.id,f.from,f.to,f.currency,tz])).rows;
 let billed=0n,collected=0n;for(const i of invoices){billed+=BigInt(i.amount_minor)+BigInt(i.adjustments);collected+=BigInt(i.paid)}
 const cash=(await pool.query(`SELECT COALESCE(sum(a.amount_minor),0)::text AS value FROM payment_allocations a JOIN payments p ON p.id=a.payment_id JOIN invoices i ON i.id=a.invoice_id JOIN units u ON u.id=i.unit_id
 WHERE u.building_id=$1 AND p.currency=$4 AND p.source NOT IN('opening_balance','sandbox') AND a.created_at>=$2::date::timestamp AT TIME ZONE $5 AND a.created_at<($3::date+1)::timestamp AT TIME ZONE $5`,[b.id,f.from,f.to,f.currency,tz])).rows[0].value;
 const expenses=(await pool.query(`SELECT COALESCE(sum(amount_minor),0)::text AS value FROM expenses WHERE building_id=$1 AND currency=$4
 AND approved_at>=$2::date::timestamp AT TIME ZONE $5 AND approved_at<($3::date+1)::timestamp AT TIME ZONE $5`,[b.id,f.from,f.to,f.currency,tz])).rows[0].value;
 const budget=(await pool.query("SELECT sum(amount_minor)::text AS value FROM operating_budgets WHERE building_id=$1 AND currency=$4 AND period BETWEEN date_trunc('month',$2::date)::date AND date_trunc('month',$3::date)::date",[b.id,f.from,f.to,f.currency])).rows[0].value;
 const contracts=(await pool.query('SELECT count(*)::int AS n FROM leases WHERE unit_id IN(SELECT id FROM units WHERE building_id=$1) AND cancelled_at IS NULL AND ends_on BETWEEN $2 AND $3',[b.id,f.from,f.to])).rows[0].n;
 const work=(await pool.query(`SELECT count(*)::int AS n FROM work_orders w JOIN resident_requests r ON r.id=w.request_id LEFT JOIN units u ON u.id=r.unit_id
 WHERE COALESCE(r.building_id,u.building_id)=$1 AND w.created_at>=$2::date::timestamp AT TIME ZONE $4 AND w.created_at<($3::date+1)::timestamp AT TIME ZONE $4`,[b.id,f.from,f.to,tz])).rows[0].n;
 const sla=(await pool.query(`SELECT count(DISTINCT d.request_id)::int AS n FROM request_sla_deadlines d JOIN resident_requests r ON r.id=d.request_id LEFT JOIN units u ON u.id=r.unit_id LEFT JOIN work_orders w ON w.request_id=r.id
 WHERE COALESCE(r.building_id,u.building_id)=$1 AND d.due_at>=$2::date::timestamp AT TIME ZONE $4 AND d.due_at<($3::date+1)::timestamp AT TIME ZONE $4
 AND NOT(d.kind='resolution' AND w.paused_at IS NOT NULL AND COALESCE((r.sla_snapshot->>'pause_resolution')::boolean,false))
 AND (d.satisfied_at>d.due_at OR (d.satisfied_at IS NULL AND d.due_at<LEAST(now(),($3::date+1)::timestamp AT TIME ZONE $4)))`,[b.id,f.from,f.to,tz])).rows[0].n;
 rows.push({...b,unitCount:count.total,occupancyKnownUnits:count.known,occupiedUnits:count.occupied,occupancyBasisPoints:count.total&&count.known===count.total?Math.floor(count.occupied*10000/count.total):null,
 billedMinor:billed.toString(),collectedMinor:collected.toString(),outstandingMinor:(billed-collected).toString(),collectionRateBasisPoints:billed>0n?Number(collected*10000n/billed):null,
 allocatedCashReceiptsMinor:cash,approvedExpensesMinor:expenses,budgetMinor:budget,budgetVarianceMinor:budget===null?null:(BigInt(budget)-BigInt(expenses)).toString(),
 netAllocatedCashflowMinor:(BigInt(cash)-BigInt(expenses)).toString(),expiringContracts:contracts,workOrders:work,slaViolations:sla});
 }
 const ids=buildings.map(b=>b.id),series=(await pool.query(`WITH facts AS(
 SELECT date_trunc('month',i.period)::date AS period,i.amount_minor+COALESCE((SELECT sum(ad.amount_minor) FROM adjustments ad WHERE ad.invoice_id=i.id AND ad.created_at<($3::date+1)::timestamp AT TIME ZONE $5),0) AS billed,0::bigint AS collected,0::bigint AS expense FROM invoices i JOIN units u ON u.id=i.unit_id
 WHERE u.building_id=ANY($1::uuid[]) AND i.status='published' AND i.currency=$4 AND i.period BETWEEN $2 AND $3
 UNION ALL SELECT date_trunc('month',a.created_at AT TIME ZONE $5)::date,0,a.amount_minor,0 FROM payment_allocations a JOIN payments p ON p.id=a.payment_id JOIN invoices i ON i.id=a.invoice_id JOIN units u ON u.id=i.unit_id
 WHERE u.building_id=ANY($1::uuid[]) AND p.currency=$4 AND p.source NOT IN('opening_balance','sandbox') AND a.created_at>=$2::date::timestamp AT TIME ZONE $5 AND a.created_at<($3::date+1)::timestamp AT TIME ZONE $5
 UNION ALL SELECT date_trunc('month',approved_at AT TIME ZONE $5)::date,0,0,amount_minor FROM expenses
 WHERE building_id=ANY($1::uuid[]) AND currency=$4 AND approved_at>=$2::date::timestamp AT TIME ZONE $5 AND approved_at<($3::date+1)::timestamp AT TIME ZONE $5
 ) SELECT period::text AS period,sum(billed)::text AS "billedMinor",sum(collected)::text AS "collectedMinor",sum(expense)::text AS "approvedExpensesMinor" FROM facts GROUP BY period ORDER BY period`,[ids,f.from,f.to,f.currency,tz])).rows;
 const summary:any={};for(const k of ['unitCount','occupancyKnownUnits','occupiedUnits','expiringContracts','workOrders','slaViolations'])summary[k]=rows.reduce((s,r)=>s+r[k],0);
 for(const k of ['billedMinor','collectedMinor','outstandingMinor','allocatedCashReceiptsMinor','approvedExpensesMinor','netAllocatedCashflowMinor'])summary[k]=rows.reduce((s,r)=>s+BigInt(r[k]),0n).toString();
 summary.occupancyBasisPoints=summary.unitCount&&summary.occupancyKnownUnits===summary.unitCount?Math.floor(summary.occupiedUnits*10000/summary.unitCount):null;
 summary.collectionRateBasisPoints=BigInt(summary.billedMinor)>0n?Number(BigInt(summary.collectedMinor)*10000n/BigInt(summary.billedMinor)):null;
 summary.budgetMinor=rows.length&&rows.every(r=>r.budgetMinor!==null)?rows.reduce((s,r)=>s+BigInt(r.budgetMinor),0n).toString():null;
 summary.budgetVarianceMinor=summary.budgetMinor===null?null:(BigInt(summary.budgetMinor)-BigInt(summary.approvedExpensesMinor)).toString();
 res.json({currency:f.currency,from:f.from,to:f.to,timezone:tz,buildings:rows,summary,series,definitions:{
 property:'Existing building entity; no persisted complex grouping exists yet.',
 occupancy:'Recorded occupancies/noncancelled leases effective on to-date; historical unrecorded occupancy is unknown.',
 collected:'Billed-period cohort allocations through closing date, including opening credit; not new bank receipts.',
 cashflow:'Real non-sandbox/non-opening allocation events minus approved expenses, not proven bank disbursement.',
 series:'Only recorded invoice/allocation/approval months. Invoice-month principal includes adjustments recorded through closing date.',
 budget:'Recorded full-month plans; null means missing, partial-date filters do not prorate.'}});
});
portfolioAnalytics.get('/contractors/scorecard',async(req,res)=>{
 const {f,buildings,timezone:tz}=await scope(req,true);
 res.json((await pool.query(`WITH jobs AS(
 SELECT d.*,p.name,(SELECT min(h.created_at) FROM defect_history h WHERE h.defect_id=d.id AND h.action='report' AND h.created_at<($3::date+1)::timestamp AT TIME ZONE $4) AS first_report,
 EXISTS(SELECT 1 FROM defect_history h WHERE h.defect_id=d.id AND h.action='accept' AND h.created_at<($3::date+1)::timestamp AT TIME ZONE $4) AS accepted,
 EXISTS(SELECT 1 FROM defect_history h WHERE h.defect_id=d.id AND h.action='return' AND h.created_at<($3::date+1)::timestamp AT TIME ZONE $4) AS returned,
 EXISTS(SELECT 1 FROM defect_history h WHERE h.defect_id=d.id AND h.action='reopen' AND h.created_at<($3::date+1)::timestamp AT TIME ZONE $4) AS reopened
 FROM defects d JOIN units u ON u.id=d.unit_id JOIN users p ON p.id=d.contractor_id
 WHERE u.building_id=ANY($1::uuid[]) AND d.created_at>=$2::date::timestamp AT TIME ZONE $4 AND d.created_at<($3::date+1)::timestamp AT TIME ZONE $4)
 SELECT contractor_id AS id,name,count(*)::int AS "jobsAssigned",count(*) FILTER(WHERE first_report IS NOT NULL)::int AS completed,
 count(*) FILTER(WHERE accepted)::int AS accepted,count(*) FILTER(WHERE returned)::int AS returned,
 round(avg(extract(epoch FROM first_report-created_at)/3600),2)::float8 AS "avgCompletionHours",
 count(*) FILTER(WHERE (first_report AT TIME ZONE $4)::date>due_on OR (first_report IS NULL AND due_on<LEAST((now() AT TIME ZONE $4)::date,$3::date)))::int AS "slaViolations",
 count(*) FILTER(WHERE reopened)::int AS "defectsReopened"
 FROM jobs GROUP BY contractor_id,name ORDER BY name`,[buildings.map(b=>b.id),f.from,f.to,tz])).rows);
});
portfolioAnalytics.get('/portfolio/budgets',async(req,res)=>{
 const c=await requirePermission(req,'expenses.read');if(c.unit_id)throw new ApiError(403,'forbidden');
 res.json((await pool.query('SELECT b.*,p.name AS building_name,b.amount_minor::text AS amount_minor,b.period::text AS period FROM operating_budgets b JOIN buildings p ON p.id=b.building_id WHERE b.organization_id=$1 AND ($2::uuid IS NULL OR b.building_id=$2) ORDER BY b.period DESC',[c.organization_id,c.building_id])).rows);
});
portfolioAnalytics.post('/portfolio/budgets',async(req,res)=>{
 const c=await requirePermission(req,'expenses.manage'),b=z.object({key:uuid,buildingId:uuid,period:day.refine(s=>s.endsWith('-01')),currency,amountMinor:z.string().regex(/^\d{1,14}$/),version:z.number().int().positive().optional()}).strict().parse(req.body);
 if(c.unit_id)throw new ApiError(403,'forbidden');
 res.json(await transaction(db=>idempotent(db,req,b.key,b,async()=>{
 if(!(await db.query('SELECT id FROM buildings WHERE id=$1 AND organization_id=$2 AND ($3::uuid IS NULL OR id=$3) FOR UPDATE',[b.buildingId,c.organization_id,c.building_id])).rowCount)throw new ApiError(404,'not_found');
 const old=(await db.query('SELECT * FROM operating_budgets WHERE building_id=$1 AND period=$2 AND currency=$3 FOR UPDATE',[b.buildingId,b.period,b.currency])).rows[0];
 if(old&&old.version!==b.version)throw new ApiError(409,'stale_version');
 const r=old?(await db.query('UPDATE operating_budgets SET amount_minor=$2,version=version+1 WHERE id=$1 RETURNING *,amount_minor::text AS amount_minor',[old.id,b.amountMinor])).rows[0]:
 (await db.query('INSERT INTO operating_budgets(organization_id,building_id,period,currency,amount_minor) VALUES($1,$2,$3,$4,$5) RETURNING *,amount_minor::text AS amount_minor',[c.organization_id,b.buildingId,b.period,b.currency,b.amountMinor])).rows[0];
 await record(db,req,c,'portfolio.budget','operating_budget',r.id,{before:old?.amount_minor??null,after:b.amountMinor});return r;
 })));
});
