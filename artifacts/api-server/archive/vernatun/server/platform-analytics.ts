import {Router} from 'express';
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

platformAnalytics.get('/platform/analytics',async(req,res)=>{
 const q=z.object({from:z.string().date().optional(),to:z.string().date().optional(),currency:z.enum(['AMD','RUB','USD']).default('AMD')}).strict()
  .refine(v=>!v.from||!v.to||v.from<=v.to,{path:['to'],message:'invalid_date_range'}).parse(req.query);
 const today=new Date().toISOString().slice(0,10);
 const defaultFrom=new Date();defaultFrom.setUTCMonth(defaultFrom.getUTCMonth()-11);defaultFrom.setUTCDate(1);
 const from=q.from??defaultFrom.toISOString().slice(0,10),to=q.to??today;
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
   FROM platform_invoices WHERE currency=$3 AND issued_at >= $1::date AND issued_at < ($2::date + interval '1 day')`,[from,to,q.currency]),
  pool.query(`SELECT m.month::date AS month,
    (SELECT count(*)::int FROM organizations o WHERE o.created_at>=m.month AND o.created_at<m.month+interval '1 month') AS organizations,
    (SELECT COALESCE(sum(i.amount_minor),0)::text FROM platform_invoices i WHERE i.billing_period=m.month::date AND i.currency=$3) AS billed_minor,
    (SELECT COALESCE(sum(i.amount_minor) FILTER(WHERE i.status='paid'),0)::text FROM platform_invoices i WHERE i.billing_period=m.month::date AND i.currency=$3) AS paid_minor,
    (SELECT count(*)::int FROM support_cases s WHERE s.created_at>=m.month AND s.created_at<m.month+interval '1 month') AS support_cases
   FROM generate_series(date_trunc('month',$1::date),date_trunc('month',$2::date),interval '1 month') m(month)
   ORDER BY m.month`,[from,to,q.currency]),
 ]);
 res.json({
  period:{from,to,currency:q.currency},
  metrics:{...organizations.rows[0],buildings:Number(buildings.rows[0].total),
   billedMinor:invoices.rows[0].billed_minor,paidMinor:invoices.rows[0].paid_minor,
   openInvoices:Number(invoices.rows[0].open_count),invoiceCount:Number(invoices.rows[0].count),
   openSupport:Number(support.rows[0].open),urgentSupport:Number(support.rows[0].urgent),
   onboardingTotal:Number(onboarding.rows[0].total),onboardingCompleted:Number(onboarding.rows[0].completed),
   onboardingOpen:Number(onboarding.rows[0].open),onboardingOverdue:Number(onboarding.rows[0].overdue)},
  companyTypes:companyTypes.rows,
  monthly:monthly.rows.map((r:any)=>({...r,month:String(r.month).slice(0,10),organizations:Number(r.organizations),support_cases:Number(r.support_cases)})),
 });
});
