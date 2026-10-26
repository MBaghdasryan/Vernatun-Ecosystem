import {pool} from './db.js';
import {enabled,type ResidentScope} from './resident-policy.js';

// Read-only composition over canonical domains. Null means unavailable, not zero.
export async function residentHomeSummary(s:ResidentScope,userId:string,currency:string,canFinance:boolean){
 const permissions=s.c.permissions,modules=s.c.modules??[];
 const allowed=(permission:string,module:string)=>!s.administrative&&permissions.includes(permission)&&modules.includes(module);
 const scope=[s.organizationId,s.buildingId];
 const latestPayment=canFinance?(await pool.query(`SELECT p.id,sum(a.amount_minor)::text AS "amountMinor",
  p.currency,p.created_at AS "createdAt" FROM payments p
  JOIN payment_allocations a ON a.payment_id=p.id AND a.organization_id=p.organization_id
  JOIN invoices i ON i.id=a.invoice_id AND i.organization_id=a.organization_id
  WHERE i.organization_id=$1 AND i.unit_id=$2 AND i.payer_user_id=$3
  AND i.currency=$4 AND p.currency=$4 AND p.payer_user_id=$3
  GROUP BY p.id ORDER BY p.created_at DESC,p.id LIMIT 1`,[s.organizationId,s.unitId,userId,currency])).rows[0]??null:null;
 const announcements=allowed('announcements.read','community')?(await pool.query(`SELECT id,title,left(body,300) AS description,
  created_at AS "createdAt" FROM announcements WHERE organization_id=$1 AND building_id=$2 AND published
  ORDER BY created_at DESC,id LIMIT 3`,scope)).rows:null;
 const activeVoting=allowed('meetings.read','community')?(await pool.query(`SELECT id,title,left(description,300) AS description,
  starts_at AS "createdAt" FROM meetings WHERE organization_id=$1 AND building_id=$2 AND mode='weighted'
  AND status='published' AND starts_at<=now() AND ends_at>now() ORDER BY ends_at,id LIMIT 3`,scope)).rows:null;
 const activeGuestPasses=allowed('access.create','access')?Number((await pool.query(`SELECT count(*) FROM visitor_passes p
  JOIN units u ON u.id=p.unit_id AND u.organization_id=p.organization_id WHERE p.organization_id=$1
  AND u.building_id=$2 AND p.unit_id=$3 AND p.created_by=$4 AND p.revoked_at IS NULL
  AND p.valid_from<=now() AND p.valid_until>now() AND p.state NOT IN('revoked','expired','used')`,
  [...scope,s.unitId,userId])).rows[0].count):null;
 const emergencyContacts=!s.administrative?(await pool.query(`SELECT id,title,data->>'phone' AS phone FROM resident_product_records
  WHERE organization_id=$1 AND building_id=$2 AND kind='contacts' AND status='active'
  AND deleted_at IS NULL AND data->>'category'='emergency' ORDER BY title,id LIMIT 5`,scope)).rows:[];
 const services=!s.administrative&&enabled(s,'services')?(await pool.query(`SELECT id,title,left(body,300) AS description,
  created_at AS "createdAt" FROM resident_product_records WHERE organization_id=$1 AND building_id=$2 AND kind='services'
  AND deleted_at IS NULL AND status='active' ORDER BY created_at DESC,id LIMIT 3`,scope)).rows:null;
 let unreadMessages:number|null=null;
 if(!s.administrative&&enabled(s,'conversations')){
  unreadMessages=Number((await pool.query(`SELECT count(*) FROM resident_product_messages m
   JOIN resident_product_records r ON r.id=m.record_id
   LEFT JOIN resident_record_marks seen ON seen.record_id=r.id AND seen.user_id=$3 AND seen.mark='read'
   WHERE r.organization_id=$1 AND r.building_id=$2 AND r.kind='conversations' AND r.deleted_at IS NULL
   AND ((r.owner_user_id=$3 AND (r.unit_id IS NULL OR r.unit_id=$4)) OR EXISTS(
    SELECT 1 FROM resident_product_records p WHERE p.id=r.parent_id AND p.kind='listings'
    AND p.owner_user_id=$3 AND p.unit_id=$4 AND p.deleted_at IS NULL))
   AND m.sender_id<>$3 AND (seen.created_at IS NULL OR m.created_at>seen.created_at)`,
   [...scope,userId,s.unitId])).rows[0].count);
 }
 const pendingAgreements=!s.administrative?Number((await pool.query(`SELECT count(*) FROM resident_product_records r
  WHERE r.organization_id=$1 AND r.building_id=$2 AND r.kind='agreements' AND r.status='active'
  AND r.deleted_at IS NULL AND (r.data->>'mandatory')::boolean AND NOT EXISTS(
   SELECT 1 FROM resident_record_marks a WHERE a.record_id=r.id AND a.user_id=$3 AND a.mark='accepted')`,
  [...scope,userId])).rows[0].count):null;
 const pendingHouseholdInvitations=!s.administrative&&permissions.includes('residents.delegate')?Number((await pool.query(`SELECT count(*)
  FROM resident_delegations d WHERE d.owner_assignment_id=$1 AND d.organization_id=$2 AND d.unit_id=$3
  AND d.revoked_at IS NULL AND d.expires_at>now() AND d.assignment_id IS NULL AND EXISTS(
   SELECT 1 FROM invitations i WHERE i.delegation_id=d.id AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>now())`,
  [s.c.id,s.organizationId,s.unitId])).rows[0].count):null;
 return {latestPayment,unreadMessages,announcements,activeVoting,activeGuestPasses,emergencyContacts,services,
  pendingAgreements,pendingHouseholdInvitations,utilityStatus:canFinance?'CONTRACT_REQUIRED' as const:'UNAVAILABLE' as const,
  serviceInterruptions:'UNAVAILABLE' as const,elevatorStatus:'NOT_CONFIGURED' as const,accessStatus:'NOT_CONFIGURED' as const};
}
