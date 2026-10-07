CREATE TABLE integration_instances (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), provider text NOT NULL,
 organization_id uuid REFERENCES organizations(id), display_name text NOT NULL,
 environment text NOT NULL CHECK(environment IN('sandbox','production')),
 config jsonb NOT NULL DEFAULT '{}', encrypted_credentials jsonb,
 enabled boolean NOT NULL DEFAULT false, status text NOT NULL DEFAULT 'not_configured',
 revision integer NOT NULL DEFAULT 1, last_check_at timestamptz, last_error text,
 checked_revision integer, created_by uuid REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE outgoing_webhooks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid REFERENCES organizations(id),
 name text NOT NULL, endpoint text NOT NULL, events text[] NOT NULL,
 encrypted_secret jsonb NOT NULL, enabled boolean NOT NULL DEFAULT false,
 created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE outgoing_webhook_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), webhook_id uuid NOT NULL REFERENCES outgoing_webhooks(id),
 event_id uuid NOT NULL REFERENCES audit_events(id), event_name text NOT NULL, payload jsonb NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','running','delivered','retry','dead_letter','cancelled')),
 attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(),
 last_status integer, last_error text, started_at timestamptz, finished_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(webhook_id,event_id)
);
CREATE INDEX outgoing_webhooks_due ON outgoing_webhook_deliveries(next_attempt_at) WHERE status IN('pending','retry');
CREATE FUNCTION queue_operational_webhook() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event_key text;
BEGIN
 event_key := CASE NEW.action WHEN 'pass.create' THEN 'pass.created'
 WHEN 'invoice.publish' THEN 'invoice.created' WHEN 'payment.confirm' THEN 'payment.received'
 WHEN 'meter.reading' THEN 'meter.submitted' WHEN 'request.create' THEN 'request.created'
 WHEN 'request.updated' THEN 'request.updated' END;
 IF event_key IS NOT NULL THEN
  INSERT INTO outgoing_webhook_deliveries(webhook_id,event_id,event_name,payload)
  SELECT w.id,NEW.id,event_key,jsonb_build_object('id',NEW.id,'event',event_key,
   'occurredAt',NEW.created_at,'organizationId',NEW.organization_id,'resourceType',NEW.entity_type,'resourceId',NEW.entity_id)
  FROM outgoing_webhooks w WHERE w.enabled AND event_key=ANY(w.events)
   AND (w.organization_id IS NULL OR w.organization_id=NEW.organization_id)
  ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER audit_outgoing_webhook AFTER INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION queue_operational_webhook();
