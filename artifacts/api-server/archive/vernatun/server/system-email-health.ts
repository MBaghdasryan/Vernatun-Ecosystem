import {systemQuery} from './system-query.js';

const keys=['email_last_accepted','email_last_sent','email_last_delivered','email_failed_24h','email_bounced_24h','email_complained_24h','email_delayed_24h','email_unknown_24h'] as const;
type Metric={key:string;value:string|null;status:'healthy'|'degraded'|'unavailable'};

// Historical evidence across providers/accounts, not a live provider probe.
// Unmatched webhooks and local outbox records cannot establish delivery.
export async function emailHealthMetrics():Promise<Metric[]>{
 try{
  const {rows:[r]}=await systemQuery({text:`WITH evidence AS (
   SELECT m.id,e.outcome,e.occurred_at FROM email_messages m
   JOIN email_delivery_events e ON e.provider=m.provider AND e.provider_scope=m.provider_scope
    AND e.message_id=m.provider_message_id
   WHERE m.delivery_evidence AND m.transport_status='accepted'
  )
  SELECT
   (SELECT max(accepted_at) FROM email_messages WHERE transport_status='accepted') AS accepted,
   max(occurred_at) FILTER(WHERE outcome='sent') AS sent,
   max(occurred_at) FILTER(WHERE outcome='delivered') AS delivered,
   count(DISTINCT id) FILTER(WHERE outcome='failed' AND occurred_at>=now()-interval '24 hours')::text AS failed,
   count(DISTINCT id) FILTER(WHERE outcome='bounced' AND occurred_at>=now()-interval '24 hours')::text AS bounced,
   count(DISTINCT id) FILTER(WHERE outcome='complained' AND occurred_at>=now()-interval '24 hours')::text AS complained,
   count(DISTINCT id) FILTER(WHERE outcome='delayed' AND occurred_at>=now()-interval '24 hours')::text AS delayed,
   (SELECT count(*)::text FROM email_messages WHERE transport_status='unknown'
    AND created_at>=now()-interval '24 hours') AS unknown
  FROM evidence`,query_timeout:3000});
  return keys.map(key=>{
   const field=key.replace(/^email_(last_)?/,'').replace(/_24h$/,'');
   const value=r[field] instanceof Date?r[field].toISOString():r[field]??null;
   return {key,value,status:value===null?'unavailable':key.endsWith('_24h')&&Number(value)>0?'degraded':'healthy'};
  });
 }catch{
  // A failed read is not evidence of zero failures. Never return SQL/error text.
  return keys.map(key=>({key,value:null,status:'unavailable'}));
 }
}
