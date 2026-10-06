import {Router,type Request} from 'express';
import {z} from 'zod';
import {pool} from './db.js';
import {ApiError,context,requireAuth} from './access.js';
import {settingsFromEnvironment,createEmailProvider} from './email.js';
import {emailProviderScope} from './email-delivery-events.js';

export const emailOperations=Router();
emailOperations.use(requireAuth);
async function admin(req:Request){
 const c=await context(req);
 if(c.role_key!=='platform_admin'||c.organization_id)throw new ApiError(403,'forbidden');
}
const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{
 const d=new Date(v+'T00:00:00Z');return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===v;
});
const status=z.enum(['unknown','local','accepted','sent','delayed','delivered','bounced','complained','failed']);
const businessType=z.enum(['invitation','password_reset','delegation','notification','platform_invoice','support','other']);
function period(query:Record<string,unknown>){
 const {from,to}=z.object({from:day.default(new Date(Date.now()-29*86400000).toISOString().slice(0,10)),
  to:day.default(new Date().toISOString().slice(0,10))}).parse(query);
 if(from>to||(Date.parse(to)-Date.parse(from))/86400000>366)throw new ApiError(400,'validation_error');
 return {from,to};
}
// Responses select safe columns explicitly. Never send full recipient, subject,
// token hashes, HTML, reset/invitation URLs or the raw provider payload.
const columns=`id,business_type,business_id,provider,
 left(split_part(recipient,'@',1),1)||'***@'||split_part(recipient,'@',2) AS recipient_masked,
 CASE WHEN provider_message_id IS NOT NULL THEN left(provider_message_id,8)||'…' END AS provider_message_id_short,
 status,created_at,accepted_at,last_event_at`;
emailOperations.get('/platform/email/messages',async(req,res)=>{
 await admin(req);const dates=period(req.query);
 const q=z.object({page:z.coerce.number().int().min(1).max(100000).default(1),
  pageSize:z.coerce.number().int().min(1).max(100).default(20),status:status.optional(),
  provider:z.enum(['resend','smtp','outbox','disabled']).optional(),businessType:businessType.optional(),
  recipient:z.string().trim().min(1).max(254).optional()}).parse(req.query);
 const args:unknown[]=[dates.from,dates.to];
 let where='created_at >= $1::date AND created_at < ($2::date+1)';
 for(const [field,value] of [['status',q.status],['provider',q.provider],['business_type',q.businessType]]){
  if(value){args.push(value);where+=` AND ${field}=$${args.length}`}
 }
 if(q.recipient){args.push(q.recipient.toLowerCase());where+=` AND strpos(lower(recipient),$${args.length})>0`}
 // Count and page share one database snapshot to avoid inconsistent pagination.
 const result=await pool.query(`WITH filtered AS MATERIALIZED (SELECT * FROM email_message_outcomes WHERE ${where})
  SELECT (SELECT count(*)::int FROM filtered) AS total,
   COALESCE((SELECT jsonb_agg(row) FROM (SELECT ${columns} FROM filtered ORDER BY created_at DESC,id DESC
    LIMIT $${args.length+1} OFFSET $${args.length+2}) row),'[]'::jsonb) AS items`,
 [...args,q.pageSize,(q.page-1)*q.pageSize]);
 res.json({...result.rows[0],page:q.page,pageSize:q.pageSize});
});
emailOperations.get('/platform/email/messages/:id',async(req,res)=>{
 await admin(req);const id=z.string().uuid().parse(req.params.id);
 const found=(await pool.query(`SELECT ${columns},sender,provider_scope FROM email_message_outcomes WHERE id=$1`,[id])).rows[0];
 if(!found)throw new ApiError(404,'not_found');
 const events=(await pool.query(`SELECT CASE WHEN ev.outcome='delayed' THEN 'email.delivery_delayed' ELSE 'email.'||ev.outcome END AS event_type,
  ev.outcome,ev.occurred_at,ev.received_at,ev.safe_metadata FROM email_delivery_events ev JOIN email_messages m
  ON m.delivery_evidence AND m.provider=ev.provider AND m.provider_scope=ev.provider_scope AND m.provider_message_id=ev.message_id
  WHERE m.id=$1 ORDER BY ev.occurred_at,ev.id`,[id])).rows;
 res.json({message:found,events});
});
emailOperations.get('/platform/email/health',async(req,res)=>{
 await admin(req);const dates=period(req.query),settings=settingsFromEnvironment(),provider=createEmailProvider(settings);
 const summaries=(await pool.query(`SELECT status,count(*)::int AS n FROM email_message_outcomes
  WHERE created_at >= $1::date AND created_at < ($2::date+1) GROUP BY status`,[dates.from,dates.to])).rows;
 const counts:Record<string,number>=Object.fromEntries(status.options.map(k=>[k,0]));
 for(const row of summaries)counts[row.status]=row.n;
 const last=(await pool.query(`WITH cohort AS (SELECT * FROM email_messages
  WHERE created_at >= $1::date AND created_at < ($2::date+1))
  SELECT (SELECT max(accepted_at) FROM cohort) AS "lastAccepted",
  max(ev.occurred_at) FILTER(WHERE ev.outcome='delivered') AS "lastDelivered",
  max(ev.occurred_at) FILTER(WHERE ev.outcome='bounced') AS "lastBounce",
  max(ev.occurred_at) FILTER(WHERE ev.outcome='complained') AS "lastComplaint",
  max(ev.occurred_at) FILTER(WHERE ev.outcome='failed') AS "lastFailure"
  FROM email_delivery_events ev JOIN cohort m ON m.delivery_evidence AND m.provider=ev.provider
   AND m.provider_scope=ev.provider_scope AND m.provider_message_id=ev.message_id`,[dates.from,dates.to])).rows[0];
 const scope=emailProviderScope('resend');
 const h=(await pool.query('SELECT * FROM email_webhook_health WHERE provider=$1 AND provider_scope=$2',['resend',scope])).rows[0];
 const failures=(await pool.query('SELECT COALESCE(sum(failures),0)::int AS n FROM email_webhook_daily WHERE provider_scope=$1 AND day BETWEEN $2::date AND $3::date',[scope,dates.from,dates.to])).rows[0].n;
 const eligible=counts.accepted+counts.sent+counts.delayed+counts.delivered+counts.bounced+counts.complained+counts.failed;
 res.json({provider:provider.name,providerStatus:provider.isConfigured()?'configured_unverified':'not_configured',
  sender:settings.from??null,period:dates,counts,deliveryRate:eligible?counts.delivered/eligible:null,...last,
  webhook:{configured:!!process.env.RESEND_WEBHOOK_SECRET,signatureVerificationReady:!!process.env.RESEND_WEBHOOK_SECRET,
   lastEventReceived:h?.last_received_at??null,lastValidEvent:h?.last_valid_at??null,
   lastInvalidSignature:h?.last_invalid_signature_at??null,recentFailures:failures},liveVerification:'not_performed'});
});
