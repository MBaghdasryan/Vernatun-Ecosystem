import {transaction} from './operations.js';
import {subscriptionPolicy} from './subscription-policy.js';
// Append-only evidence + unique request/kind/level prevents repeat alerts across workers/restarts.
export async function runSlaEscalations(){
 return transaction(async db=>{
  const work=(await db.query(`SELECT d.*,r.organization_id,r.sla_snapshot,u.building_id,u.id AS unit_id,w.paused_at
   FROM request_sla_deadlines d JOIN resident_requests r ON r.id=d.request_id JOIN units u ON u.id=r.unit_id LEFT JOIN work_orders w ON w.request_id=r.id
   WHERE d.satisfied_at IS NULL AND d.due_at<=now()+interval '15 minutes' AND r.status<>'closed'
   AND NOT(d.kind='resolution' AND w.paused_at IS NOT NULL AND COALESCE((r.sla_snapshot->>'pause_resolution')::boolean,false))
   AND NOT EXISTS(SELECT 1 FROM request_escalations e WHERE e.request_id=d.request_id AND e.kind=d.kind AND e.level=CASE WHEN d.due_at<now() THEN 2 ELSE 1 END)
   ORDER BY r.id,d.kind LIMIT 500 FOR UPDATE OF r SKIP LOCKED`)).rows;
  let inserted=0;
  for(const d of work){
   if(!(await subscriptionPolicy(d.organization_id)).modules.includes('requests'))continue;
   const level=new Date(d.due_at).getTime()<Date.now()?2:1;
   const evidence=(await db.query('INSERT INTO request_escalations(request_id,kind,level) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id',[d.request_id,d.kind,level])).rows[0];
   if(!evidence)continue;inserted++;
   await db.query('UPDATE resident_requests SET escalation_level=greatest(escalation_level,$2) WHERE id=$1',[d.request_id,level]);
   await db.query(`INSERT INTO notifications(user_id,organization_id,kind,entity_id)
    SELECT DISTINCT a.user_id,$1::uuid,$2::text,$3::uuid FROM role_assignments a JOIN memberships m ON m.user_id=a.user_id AND m.organization_id=a.organization_id JOIN users x ON x.id=a.user_id
    WHERE a.organization_id=$1 AND a.role_key IN('manager','dispatcher') AND a.active AND m.active AND NOT x.blocked
    AND a.starts_at<=now() AND (a.expires_at IS NULL OR a.expires_at>now()) AND (a.building_id IS NULL OR a.building_id=$4) AND (a.unit_id IS NULL OR a.unit_id=$5)`,
    [d.organization_id,'sla.'+d.kind+'.'+(level===2?'breached':'approaching'),d.request_id,d.building_id,d.unit_id]);
   await db.query("INSERT INTO audit_events(organization_id,action,entity_type,entity_id,details) VALUES($1,'request.sla_escalated','resident_request',$2,$3)",[d.organization_id,d.request_id,JSON.stringify({kind:d.kind,level,dueAt:d.due_at})]);
  }
  return inserted;
 });
}
