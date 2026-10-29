-- Allow a platform support employee to be invited without inventing an organization.
-- Global platform administrators remain non-invitable.
ALTER TABLE invitations ALTER COLUMN organization_id DROP NOT NULL;
ALTER TABLE invitations DROP CONSTRAINT invitations_role_key_check;
ALTER TABLE invitations ADD CONSTRAINT invitations_role_scope_check CHECK (
 (organization_id IS NULL AND role_key='support' AND building_id IS NULL AND unit_id IS NULL)
 OR (organization_id IS NOT NULL AND role_key NOT IN ('platform_admin','support'))
);

ALTER TABLE invitation_email_attempts ALTER COLUMN organization_id DROP NOT NULL;

CREATE OR REPLACE VIEW invitation_delivery_outcomes AS
 SELECT i.id AS invitation_id,
 COALESCE(e.outcome,r.outcome,CASE WHEN a.id IS NOT NULL THEN 'unknown'
  WHEN i.email_delivery_status='sent' THEN 'accepted' ELSE i.email_delivery_status END) AS outcome,
 COALESCE(e.occurred_at,r.created_at,i.email_delivery_at) AS outcome_at,
 a.provider,a.delivery_evidence
 FROM invitations i
 LEFT JOIN invitation_email_attempts a ON a.id=i.current_email_attempt_id
  AND a.invitation_id=i.id AND a.organization_id IS NOT DISTINCT FROM i.organization_id
  AND a.token_hash=i.token_hash
 LEFT JOIN invitation_email_receipts r ON r.attempt_id=a.id
  AND r.provider=a.provider AND r.provider_scope=a.provider_scope
 LEFT JOIN LATERAL (
  SELECT ev.outcome,ev.occurred_at FROM email_delivery_events ev
  WHERE a.delivery_evidence AND r.outcome='accepted'
   AND ev.provider=r.provider AND ev.provider_scope=r.provider_scope
   AND ev.message_id=r.message_id
  ORDER BY CASE ev.outcome WHEN 'complained' THEN 70 WHEN 'bounced' THEN 60 WHEN 'failed' THEN 50
   WHEN 'delivered' THEN 40 WHEN 'delayed' THEN 30 WHEN 'sent' THEN 20 ELSE 0 END DESC,
   ev.occurred_at DESC,ev.id DESC LIMIT 1
 ) e ON TRUE;
