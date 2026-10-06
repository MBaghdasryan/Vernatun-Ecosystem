ALTER TABLE organizations ADD COLUMN legal_name text NOT NULL DEFAULT '';
ALTER TABLE organizations ADD COLUMN tax_id text NOT NULL DEFAULT '';
ALTER TABLE organizations ADD COLUMN address text NOT NULL DEFAULT '';
ALTER TABLE organizations ADD COLUMN default_language text NOT NULL DEFAULT 'hy' CHECK(default_language IN ('hy','ru','en'));
ALTER TABLE organizations ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended','archived'));
ALTER TABLE organizations ADD COLUMN version integer NOT NULL DEFAULT 1;
INSERT INTO permissions(key) VALUES('support.assign'),('imports.finance') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_key,permission_key) VALUES('platform_admin','support.assign'),('accountant','imports.finance') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_key,permission_key) VALUES('platform_admin','support.cases') ON CONFLICT DO NOTHING;
ALTER TABLE support_cases ADD COLUMN priority text NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent'));
ALTER TABLE support_cases ADD COLUMN category text NOT NULL DEFAULT 'general';
ALTER TABLE support_cases ADD COLUMN sla_due_at timestamptz;
ALTER TABLE support_cases ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE support_cases ADD COLUMN resolved_at timestamptz;
ALTER TABLE support_cases ADD COLUMN version integer NOT NULL DEFAULT 1;
UPDATE support_cases SET sla_due_at=created_at+interval '48 hours';
CREATE TABLE support_messages(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),case_id uuid NOT NULL REFERENCES support_cases(id),
 author_id uuid REFERENCES users(id),body text NOT NULL,
 internal boolean NOT NULL DEFAULT false,attachment_ids uuid[] NOT NULL DEFAULT '{}',
 created_at timestamptz DEFAULT now(),legacy_source text CHECK(legacy_source IN ('legacy_body','legacy_reply')),
 CHECK(legacy_source IS NOT NULL OR (author_id IS NOT NULL AND created_at IS NOT NULL))
);
-- Preserve legacy reply/body columns byte-for-byte; conversations begin with
-- provenance-marked snapshots, rather than rewriting the old single reply.
INSERT INTO support_messages(case_id,author_id,body,created_at,legacy_source)
 SELECT id,created_by,body,created_at,'legacy_body' FROM support_cases;
INSERT INTO support_messages(case_id,author_id,body,created_at,legacy_source)
 SELECT id,NULL,reply,NULL,'legacy_reply' FROM support_cases WHERE reply<>'';
CREATE TRIGGER support_message_immutable BEFORE UPDATE OR DELETE ON support_messages FOR EACH ROW EXECUTE FUNCTION immutable_ledger();
ALTER TABLE onboarding_steps ADD COLUMN category text NOT NULL DEFAULT 'general';
ALTER TABLE onboarding_steps ADD COLUMN sort_order integer NOT NULL DEFAULT 0 CHECK(sort_order>=0);
ALTER TABLE onboarding_steps ADD COLUMN status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_progress','completed'));
ALTER TABLE onboarding_steps ADD COLUMN notes text NOT NULL DEFAULT '';
ALTER TABLE onboarding_steps ADD COLUMN version integer NOT NULL DEFAULT 1;
UPDATE onboarding_steps SET status='completed' WHERE completed_at IS NOT NULL;
CREATE TABLE onboarding_dependencies(
 step_id uuid NOT NULL REFERENCES onboarding_steps(id),dependency_id uuid NOT NULL REFERENCES onboarding_steps(id),
 PRIMARY KEY(step_id,dependency_id),CHECK(step_id<>dependency_id)
);
CREATE TABLE onboarding_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),step_id uuid NOT NULL REFERENCES onboarding_steps(id),
 actor_id uuid NOT NULL REFERENCES users(id),action text NOT NULL,details jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO onboarding_events(step_id,actor_id,action,details)
 SELECT id,assigned_to,'legacy_snapshot',jsonb_build_object('completedAt',completed_at,'title',title,'dueOn',due_on) FROM onboarding_steps;
CREATE TRIGGER onboarding_event_immutable BEFORE UPDATE OR DELETE ON onboarding_events FOR EACH ROW EXECUTE FUNCTION immutable_ledger();
CREATE TABLE typed_import_jobs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES organizations(id),
 building_id uuid NOT NULL REFERENCES buildings(id),created_by uuid NOT NULL REFERENCES users(id),
 entity_type text NOT NULL CHECK(entity_type IN ('units','owners','residents','meters','opening_balances')),
 status text NOT NULL CHECK(status IN ('preview','invalid','committed')),
 version integer NOT NULL DEFAULT 1,preview jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),committed_at timestamptz
);
CREATE TABLE import_entity_refs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES organizations(id),
 job_id uuid NOT NULL REFERENCES typed_import_jobs(id),entity_type text NOT NULL,reference text NOT NULL,
 entity_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(organization_id,entity_type,reference)
);
CREATE TRIGGER import_reference_immutable BEFORE UPDATE OR DELETE ON import_entity_refs FOR EACH ROW EXECUTE FUNCTION immutable_ledger();
ALTER TABLE payments DROP CONSTRAINT payments_source_check;
ALTER TABLE payments ADD CONSTRAINT payments_source_check CHECK(source IN ('manual_bank','sandbox','bank_import','opening_balance'));
-- Opening credit uses the same immutable account binding and allocation limits
-- as reconciled deposits; only the allowed provenance expands.
CREATE OR REPLACE FUNCTION enforce_allocation_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p payments%ROWTYPE;i invoices%ROWTYPE;a payment_accounts%ROWTYPE;used numeric;paid numeric;adjusted numeric;
BEGIN
 SELECT * INTO p FROM payments WHERE id=NEW.payment_id FOR UPDATE;
 SELECT * INTO i FROM invoices WHERE id=NEW.invoice_id FOR UPDATE;
 IF p.id IS NULL OR i.id IS NULL OR p.organization_id<>NEW.organization_id OR i.organization_id<>NEW.organization_id
 OR p.payer_user_id<>i.payer_user_id OR p.currency<>i.currency OR i.status<>'published'
 THEN RAISE EXCEPTION 'Allocation identity mismatch';END IF;
 SELECT * INTO a FROM payment_accounts WHERE payment_id=p.id;
 IF NEW.allocation_kind='credit' AND (a.payment_id IS NULL OR p.source NOT IN ('bank_import','opening_balance'))
 THEN RAISE EXCEPTION 'Credit requires account provenance';END IF;
 IF a.payment_id IS NOT NULL AND (a.unit_id<>i.unit_id OR a.payer_user_id<>i.payer_user_id)
 THEN RAISE EXCEPTION 'Allocation account mismatch';END IF;
 SELECT COALESCE(sum(amount_minor),0) INTO used FROM payment_allocations WHERE payment_id=p.id;
 SELECT COALESCE(sum(amount_minor),0) INTO paid FROM payment_allocations WHERE invoice_id=i.id;
 SELECT COALESCE(sum(amount_minor),0) INTO adjusted FROM adjustments WHERE invoice_id=i.id;
 IF used+NEW.amount_minor>p.amount_minor OR paid+NEW.amount_minor>i.amount_minor+adjusted
 THEN RAISE EXCEPTION 'Allocation exceeds available balance';END IF;
 RETURN NEW;
END $$;
CREATE INDEX support_queue_idx ON support_cases(assigned_to,status,sla_due_at);
CREATE INDEX onboarding_org_order_idx ON onboarding_steps(organization_id,sort_order,id);
