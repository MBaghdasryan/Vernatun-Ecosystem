import {Router,type Response} from 'express';
import {z} from 'zod';
import {pool} from './db.js';
import {context,requirePermission,ApiError} from './access.js';

export const platformAnalytics=Router();
platformAnalytics.use('/platform/analytics',async(req,res,next)=>{
 try{
  const c=await context(req);
  if(c.role_key!=='platform_admin')throw new ApiError(403,'forbidden');
  await requirePermission(req,c.permissions.includes('organizations.manage')?'organizations.manage':'organizations.read');
  next();
 }catch(error){next(error)}
});

const querySchema=z.object({
 from:z.string().date().optional(),
 to:z.string().date().optional(),
 currency:z.enum(['AMD','RUB','USD']).default('AMD'),
}).strict().refine(v=>!v.from||!v.to||v.from<=v.to,{path:['to'],message:'invalid_date_range'});

type AnalyticsQuery=z.infer<typeof querySchema>;
function dateRange(q:AnalyticsQuery){
 const today=new Date().toISOString().slice(0,10);
 const defaultFrom=new Date();defaultFrom.setUTCMonth(defaultFrom.getUTCMonth()-11);defaultFrom.setUTCDate(1);
 return {from:q.from??defaultFrom.toISOString().slice(0,10),to:q.to??today,currency:q.currency};
}

async function loadAnalytics(input:unknown){
 const range=dateRange(querySchema.parse(input));
 const [organizations,buildings,companyTypes,support,onboarding,invoices,monthly]=await Promise.all([
  pool.query(`SELECT count(*)::int AS total,
    count(*) FILTER(WHERE status='active')::int AS active,
    count(*) FILTER(WHERE status='pilot')::int AS pilot,
    count(*) FILTER(WHERE status IN ('paused','suspended'))::int AS paused
   FROM organizations`),
  pool.query('SELECT count(*)::int AS total FROM buildings'),
  pool.query(`SELECT company_type,count(*)::int AS count FROM organizations GROUP BY company_type ORDER BY company_type`),
  pool.query(`SELECT count(*) FILTER(WHERE status IN ('open','in_progress'))::int AS open,
    count(*) FILTER(WHERE status IN ('open','in_progress') AND priority IN ('high','urgent'))::int AS urgent
   FROM support_cases`),
  pool.query(`SELECT count(*)::int AS total,
    count(*) FILTER(WHERE completed_at IS NOT NULL)::int AS completed,
    count(*) FILTER(WHERE completed_at IS NULL)::int AS open,
    count(*) FILTER(WHERE completed_at IS NULL AND due_on<current_date)::int AS overdue
   FROM onboarding_steps`),
  pool.query(`SELECT count(*)::int AS count,
    COALESCE(sum(amount_minor),0)::text AS billed_minor,
    COALESCE(sum(amount_minor) FILTER(WHERE status='paid'),0)::text AS paid_minor,
    count(*) FILTER(WHERE status IN ('issued','partially_paid','overdue'))::int AS open_count
   FROM platform_invoices WHERE currency=$3 AND issued_at >= $1::date AND issued_at < ($2::date + interval '1 day')`,
   [range.from,range.to,range.currency]),
  pool.query(`SELECT m.month::date AS month,
    (SELECT count(*)::int FROM organizations o WHERE o.created_at>=m.month AND o.created_at<m.month+interval '1 month') AS organizations,
    (SELECT COALESCE(sum(i.amount_minor),0)::text FROM platform_invoices i WHERE i.billing_period=m.month::date AND i.currency=$3) AS billed_minor,
    (SELECT COALESCE(sum(i.amount_minor) FILTER(WHERE i.status='paid'),0)::text FROM platform_invoices i WHERE i.billing_period=m.month::date AND i.currency=$3) AS paid_minor,
    (SELECT count(*)::int FROM support_cases s WHERE s.created_at>=m.month AND s.created_at<m.month+interval '1 month') AS support_cases
   FROM generate_series(date_trunc('month',$1::date),date_trunc('month',$2::date),interval '1 month') m(month)
   ORDER BY m.month`,[range.from,range.to,range.currency]),
 ]);
 return {
  period:range,
  metrics:{...organizations.rows[0],buildings:Number(buildings.rows[0].total),
   billedMinor:invoices.rows[0].billed_minor,paidMinor:invoices.rows[0].paid_minor,
   openInvoices:Number(invoices.rows[0].open_count),invoiceCount:Number(invoices.rows[0].count),
   openSupport:Number(support.rows[0].open),urgentSupport:Number(support.rows[0].urgent),
   onboardingTotal:Number(onboarding.rows[0].total),onboardingCompleted:Number(onboarding.rows[0].completed),
   onboardingOpen:Number(onboarding.rows[0].open),onboardingOverdue:Number(onboarding.rows[0].overdue)},
  companyTypes:companyTypes.rows,
  monthly:monthly.rows.map((r:any)=>({...r,month:String(r.month).slice(0,10),organizations:Number(r.organizations),support_cases:Number(r.support_cases)})),
 };
}

function csvCell(value:unknown){
 const text=String(value??''),safe=/^\s*[=+\-@]/.test(text)?`'${text}`:text;
 return '"'+safe.replace(/"/g,'""')+'"';
}
function analyticsCsv(res:Response,data:Awaited<ReturnType<typeof loadAnalytics>>){
 const {period,metrics,monthly}=data;
 const rows:unknown[][]=[
  ['metric','value','currency','from','to'],
  ['organizations',metrics.total,'',period.from,period.to],
  ['active_organizations',metrics.active,'',period.from,period.to],
  ['pilot_organizations',metrics.pilot,'',period.from,period.to],
  ['paused_organizations',metrics.paused,'',period.from,period.to],
  ['buildings',metrics.buildings,'',period.from,period.to],
  ['billed_minor',metrics.billedMinor,period.currency,period.from,period.to],
  ['paid_minor',metrics.paidMinor,period.currency,period.from,period.to],
  ['open_invoices',metrics.openInvoices,'',period.from,period.to],
  ['invoice_count',metrics.invoiceCount,'',period.from,period.to],
  ['open_support_cases',metrics.openSupport,'',period.from,period.to],
  ['urgent_support_cases',metrics.urgentSupport,'',period.from,period.to],
  ['onboarding_total',metrics.onboardingTotal,'',period.from,period.to],
  ['onboarding_completed',metrics.onboardingCompleted,'',period.from,period.to],
  ['onboarding_open',metrics.onboardingOpen,'',period.from,period.to],
  ['onboarding_overdue',metrics.onboardingOverdue,'',period.from,period.to],
  [],
  ['month','new_organizations','billed_minor','paid_minor','support_cases','currency'],
  ...monthly.map(m=>[m.month,m.organizations,m.billed_minor,m.paid_minor,m.support_cases,period.currency]),
 ];
 res.setHeader('Content-Type','text/csv; charset=utf-8');
 res.setHeader('Content-Disposition','attachment; filename="vernatun-platform-analytics.csv"');
 res.send('\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n'));
}

platformAnalytics.get('/platform/analytics',async(req,res)=>{
 res.set('Cache-Control','private, no-store').json(await loadAnalytics(req.query));
});
platformAnalytics.get('/platform/analytics/export.csv',async(req,res)=>{
 analyticsCsv(res,await loadAnalytics(req.query));
});
