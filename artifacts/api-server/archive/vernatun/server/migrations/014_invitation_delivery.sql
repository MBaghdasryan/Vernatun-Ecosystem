-- Acceptance and lifecycle are intentionally independent of delivery evidence.
ALTER TABLE invitations ADD CONSTRAINT invitations_email_scope_unique UNIQUE(id,organization_id);
CREATE TABLE invitation_email_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 invitation_id uuid NOT NULL REFERENCES invitations(id),
 organization_id uuid NOT NULL REFERENCES organizations(id),
 token_hash text NOT NULL CHECK(token_hash ~ '^[0-9a-f]{64}$'),
 provider text NOT NULL,
 provider_scope text NOT NULL,
 delivery_evidence boolean NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,invitation_id,organization_id),
 UNIQUE(id,provider,provider_scope),
 FOREIGN KEY(invitation_id,organization_id) REFERENCES invitations(id,organization_id)
);
ALTER TABLE invitations ADD COLUMN current_email_attempt_id uuid;
ALTER TABLE invitations ADD CONSTRAINT invitation_current_email_attempt_fk
 FOREIGN KEY(current_email_attempt_id,id,organization_id)
 REFERENCES invitation_email_attempts(id,invitation_id,organization_id);
CREATE TABLE invitation_email_receipts (
 attempt_id uuid PRIMARY KEY REFERENCES invitation_email_attempts(id),
 provider text NOT NULL,
 provider_scope text NOT NULL,
 message_id text,
 outcome text NOT NULL CHECK(outcome IN ('accepted','local','failed')),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(provider,provider_scope,message_id),
 FOREIGN KEY(attempt_id,provider,provider_scope) REFERENCES invitation_email_attempts(id,provider,provider_scope),
 CHECK(message_id IS NULL OR outcome='accepted')
);
CREATE TABLE email_delivery_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 provider text NOT NULL,
 provider_scope text NOT NULL,
 event_id text NOT NULL,
 message_id text NOT NULL,
 outcome text NOT NULL CHECK(outcome IN ('delivered','bounced','complained')),
 occurred_at timestamptz NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(provider,provider_scope,event_id)
);
CREATE INDEX email_delivery_message_idx ON email_delivery_events(provider,provider_scope,message_id);
CREATE FUNCTION email_delivery_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Email delivery history is append-only'; END;
$$;
CREATE TRIGGER immutable_email_attempt BEFORE UPDATE OR DELETE ON invitation_email_attempts
 FOR EACH ROW EXECUTE FUNCTION email_delivery_immutable();
CREATE TRIGGER immutable_email_receipt BEFORE UPDATE OR DELETE ON invitation_email_receipts
 FOR EACH ROW EXECUTE FUNCTION email_delivery_immutable();
CREATE TRIGGER immutable_email_event BEFORE UPDATE OR DELETE ON email_delivery_events
 FOR EACH ROW EXECUTE FUNCTION email_delivery_immutable();
CREATE TRIGGER no_truncate_email_attempt BEFORE TRUNCATE ON invitation_email_attempts
 FOR EACH STATEMENT EXECUTE FUNCTION email_delivery_immutable();
CREATE TRIGGER no_truncate_email_receipt BEFORE TRUNCATE ON invitation_email_receipts
 FOR EACH STATEMENT EXECUTE FUNCTION email_delivery_immutable();
CREATE TRIGGER no_truncate_email_event BEFORE TRUNCATE ON email_delivery_events
 FOR EACH STATEMENT EXECUTE FUNCTION email_delivery_immutable();

-- No backfill: legacy sent means accepted, never delivered.
-- Negative evidence takes precedence regardless of webhook arrival order.
CREATE VIEW invitation_delivery_outcomes AS
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
  ORDER BY CASE ev.outcome WHEN 'complained' THEN 3 WHEN 'bounced' THEN 2 ELSE 1 END DESC,
   ev.occurred_at DESC,ev.id DESC LIMIT 1
 ) e ON TRUE;
