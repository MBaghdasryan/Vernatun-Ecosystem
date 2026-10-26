import {Router} from 'express';
import {pool} from './db.js';
import {ApiError,requireAuth,requirePermission} from './access.js';
import {ownScope} from './resident-continuity-store.js';
export const residentFinanceTransparency=Router();residentFinanceTransparency.use(requireAuth);
residentFinanceTransparency.get('/building-finance',async(req,res)=>{
 const s=await ownScope(req);await requirePermission(req,'billing.own');
 if(!s.settings.financeTransparency)throw new ApiError(403,'feature_disabled');
 const rows=(await pool.query(`SELECT i.period::text AS period,i.currency,count(DISTINCT i.unit_id)::int AS units,
  CASE WHEN count(DISTINCT i.unit_id)>=5 THEN sum(i.amount_minor)::text ELSE NULL END AS "publishedMinor",
  CASE WHEN count(DISTINCT i.unit_id)>=5 THEN sum(COALESCE(a.paid,0))::text ELSE NULL END AS "allocatedMinor"
  FROM invoices i JOIN units u ON u.id=i.unit_id AND u.organization_id=i.organization_id
  JOIN organizations o ON o.id=i.organization_id LEFT JOIN LATERAL(
   SELECT sum(amount_minor) AS paid FROM payment_allocations WHERE invoice_id=i.id AND organization_id=i.organization_id
  )a ON true WHERE i.organization_id=$1 AND u.building_id=$2 AND i.status='published'
  AND i.period>=date_trunc('month',now() AT TIME ZONE o.timezone)::date-interval '5 months'
  AND i.period<=date_trunc('month',now() AT TIME ZONE o.timezone)::date
  GROUP BY i.period,i.currency ORDER BY i.period DESC,i.currency`,[s.organizationId,s.buildingId])).rows;
 // Not a balance or profit statement: no inferred budgets, expenses or individual debt.
 res.json(rows.map(r=>({period:r.period,currency:r.currency,publishedMinor:r.publishedMinor,
  allocatedMinor:r.allocatedMinor,status:r.units>=5?'AVAILABLE':'INSUFFICIENT_COHORT'})));
});
