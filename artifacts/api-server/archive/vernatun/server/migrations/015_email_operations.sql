-- Extend the existing append-only evidence store; do not duplicate webhook events.
ALTER TABLE email_delivery_events DROP CONSTRAINT email_delivery_events_outcome_check;
ALTER TABLE email_delivery_events ADD CHECK(outcome IN ('sent','delayed','delivered','bounced','complained','failed'));
ALTER TABLE email_delivery_events ADD COLUMN safe_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Token-free general send ledger. Invitation attempts/receipts remain authoritative
-- for invitation lifecycle, token rotation and current-attempt isolation.
CREATE TABLE email_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 provider text NOT NULL,
 provider_scope text NOT NULL,
 delivery_evidence boolean NOT NULL,
 business_type text NOT NULL CHECK(business_type IN ('invitation','password_reset','delegation','notification','platform_invoice','support','other')),
 business_id uuid,
 organization_id uuid REFERENCES organizations(id),
 recipient text NOT NULL,
 sender text,
 provider_message_id text,
 transport_status text NOT NULL DEFAULT 'unknown' CHECK(transport_status IN ('unknown','accepted','local')),
 accepted_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(provider,provider_scope,provider_message_id)
);
CREATE INDEX email_messages_date_idx ON email_messages(created_at DESC,id DESC);
CREATE INDEX email_messages_recipient_idx ON email_messages(lower(recipient));

CREATE TABLE email_webhook_health (
 provider text NOT NULL,
 provider_scope text NOT NULL,
 last_received_at timestamptz,
 last_valid_at timestamptz,
 last_invalid_signature_at timestamptz,
 last_failure_at timestamptz,
 failures bigint NOT NULL DEFAULT 0,
 PRIMARY KEY(provider,provider_scope)
);
CREATE TABLE email_webhook_daily (
 provider_scope text NOT NULL,
 day date NOT NULL,
 failures bigint NOT NULL DEFAULT 0,
 PRIMARY KEY(provider_scope,day)
);

CREATE OR REPLACE VIEW invitation_delivery_outcomes AS
 SELECT i.id AS invitation_id,
 COALESCE(e.outcome,r.outcome,CASE WHEN a.id IS NOT NULL THEN 'unknown'
  WHEN i.email_delivery_status='sent' THEN 'accepted' ELSE i.email_delivery_status END) AS outcome,
 COALESCE(e.occurred_at,r.created_at,i.email_delivery_at) AS outcome_at,
 a.provider,a.delivery_evidence
 FROM invitations i
 LEFT JOIN invitation_email_attempts a ON a.id=i.current_email_attempt_id
  AND a.invitation_id=i.id AND a.organization_id=i.organization_id AND a.token_hash=i.token_hash
 LEFT JOIN invitation_email_receipts r ON r.attempt_id=a.id AND r.provider=a.provider AND r.provider_scope=a.provider_scope
 LEFT JOIN LATERAL (
  SELECT ev.outcome,ev.occurred_at FROM email_delivery_events ev
  WHERE a.delivery_evidence AND r.outcome='accepted'
   AND ev.provider=r.provider AND ev.provider_scope=r.provider_scope AND ev.message_id=r.message_id
  ORDER BY CASE ev.outcome WHEN 'complained' THEN 70 WHEN 'bounced' THEN 60 WHEN 'failed' THEN 50
   WHEN 'delivered' THEN 40 WHEN 'delayed' THEN 30 WHEN 'sent' THEN 20 ELSE 0 END DESC,
   ev.occurred_at DESC,ev.id DESC LIMIT 1
 ) e ON TRUE;

-- Aggregate is computed from retained evidence, not the most recently received
-- request. Late/early events reconcile automatically, without mutable events.
CREATE VIEW email_message_outcomes AS
 SELECT m.*,
 COALESCE(e.outcome,m.transport_status) AS status,
 COALESCE(e.occurred_at,m.accepted_at,m.created_at) AS status_at,
 last_event.last_event_at
 FROM email_messages m
 LEFT JOIN LATERAL (
  SELECT ev.outcome,ev.occurred_at FROM email_delivery_events ev
  WHERE m.delivery_evidence AND m.transport_status='accepted'
   AND ev.provider=m.provider AND ev.provider_scope=m.provider_scope AND ev.message_id=m.provider_message_id
  ORDER BY CASE ev.outcome WHEN 'complained' THEN 70 WHEN 'bounced' THEN 60 WHEN 'failed' THEN 50
   WHEN 'delivered' THEN 40 WHEN 'delayed' THEN 30 WHEN 'sent' THEN 20 ELSE 0 END DESC,
   ev.occurred_at DESC,ev.id DESC LIMIT 1
 ) e ON TRUE
 LEFT JOIN LATERAL (
  SELECT max(ev.occurred_at) AS last_event_at FROM email_delivery_events ev
  WHERE m.delivery_evidence AND ev.provider=m.provider AND ev.provider_scope=m.provider_scope
   AND ev.message_id=m.provider_message_id
 ) last_event ON TRUE;
