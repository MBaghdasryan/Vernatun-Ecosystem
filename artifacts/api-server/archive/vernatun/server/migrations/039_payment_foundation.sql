-- Additive only. Existing property accounting remains the source of truth.
INSERT INTO permissions(key) VALUES('platform_billing.pay') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_key,permission_key) VALUES('org_admin','platform_billing.pay') ON CONFLICT DO NOTHING;
CREATE TABLE payment_provider_instances(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 provider_code text NOT NULL CHECK(provider_code IN ('ameriabank','arca','telcell')),
 provider_type text NOT NULL CHECK(provider_type IN ('PLATFORM_PAYMENT','PROPERTY_PAYMENT','UTILITY_AGGREGATOR')),
 payment_domain text NOT NULL CHECK(payment_domain IN ('platform','property','utility')),
 scope_type text NOT NULL CHECK(scope_type IN ('platform','organization')),
 organization_id uuid REFERENCES organizations(id),
 environment text NOT NULL CHECK(environment IN ('sandbox','production')),
 enabled boolean NOT NULL DEFAULT false,
 configuration_json jsonb NOT NULL DEFAULT '{}',
 encrypted_credentials jsonb,
 status text NOT NULL DEFAULT 'contract_required' CHECK(status IN ('contract_required','credentials_required','sandbox','active','degraded','disabled')),
 last_health_check timestamptz,last_success_at timestamptz,last_error text,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((scope_type='platform' AND organization_id IS NULL) OR (scope_type='organization' AND organization_id IS NOT NULL)),
 CHECK((provider_code='ameriabank' AND payment_domain='platform' AND provider_type='PLATFORM_PAYMENT' AND scope_type='platform')
    OR (provider_code='arca' AND payment_domain='property' AND provider_type='PROPERTY_PAYMENT' AND scope_type='organization')
    OR (provider_code='telcell' AND payment_domain='utility' AND provider_type='UTILITY_AGGREGATOR')),
 UNIQUE(id,payment_domain)
);
CREATE UNIQUE INDEX payment_provider_instance_scope ON payment_provider_instances(provider_code,environment,COALESCE(organization_id,'00000000-0000-0000-0000-000000000000'::uuid));
CREATE TABLE platform_invoices(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES organizations(id),
 subscription_id uuid NOT NULL REFERENCES subscriptions(id),billing_period date NOT NULL CHECK(extract(day FROM billing_period)=1),
 amount_minor bigint NOT NULL CHECK(amount_minor BETWEEN 1 AND 99999999999999),
 currency text NOT NULL CHECK(currency IN ('AMD','RUB','USD')),
 status text NOT NULL DEFAULT 'issued' CHECK(status IN ('draft','issued','partially_paid','paid','overdue','cancelled')),
 issued_at timestamptz NOT NULL DEFAULT now(),due_at timestamptz NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),
 UNIQUE(subscription_id,billing_period),UNIQUE(id,organization_id)
);
CREATE TABLE utility_service_catalog(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),aggregator_provider text NOT NULL,
 external_service_id text NOT NULL,name text NOT NULL,
 utility_type text NOT NULL CHECK(utility_type IN ('electricity','gas','water','heating','waste','telecom','internet','other')),
 required_subscriber_fields jsonb NOT NULL,active boolean NOT NULL DEFAULT false,last_synced_at timestamptz,
 UNIQUE(aggregator_provider,external_service_id)
);
CREATE TABLE utility_accounts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES organizations(id),
 unit_id uuid NOT NULL,service_id uuid NOT NULL REFERENCES utility_service_catalog(id),
 encrypted_subscriber jsonb NOT NULL,subscriber_number_masked text NOT NULL,
 display_name text NOT NULL,status text NOT NULL CHECK(status IN ('unverified','active','disabled')),
 verified_at timestamptz,last_synced_at timestamptz,created_by uuid NOT NULL REFERENCES users(id),
 FOREIGN KEY(unit_id,organization_id) REFERENCES units(id,organization_id),
 UNIQUE(id,organization_id)
);
CREATE SEQUENCE payment_order_numbers MINVALUE 1 MAXVALUE 2147483647 NO CYCLE;
CREATE TABLE payment_intents(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),public_reference uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
 payment_domain text NOT NULL CHECK(payment_domain IN ('platform','property','utility')),
 organization_id uuid NOT NULL REFERENCES organizations(id),unit_id uuid,
 platform_invoice_id uuid,utility_account_id uuid,payer_user_id uuid NOT NULL REFERENCES users(id),
 provider_instance_id uuid NOT NULL,provider_order_id bigint NOT NULL DEFAULT nextval('payment_order_numbers') UNIQUE,
 provider_payment_id text,amount_minor bigint NOT NULL CHECK(amount_minor BETWEEN 1 AND 99999999999999),
 currency text NOT NULL CHECK(currency IN ('AMD','RUB','USD')),
 allocation_strategy text NOT NULL DEFAULT 'oldest_first' CHECK(allocation_strategy IN ('oldest_first','selected_invoices','current_period_first')),
 description text NOT NULL,status text NOT NULL DEFAULT 'created' CHECK(status IN ('created','pending','requires_action','processing','succeeded','failed','cancelled','expired')),
 redirect_url text,expires_at timestamptz NOT NULL DEFAULT now()+interval '30 minutes',
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(provider_instance_id,payment_domain) REFERENCES payment_provider_instances(id,payment_domain),
 FOREIGN KEY(platform_invoice_id,organization_id) REFERENCES platform_invoices(id,organization_id),
 FOREIGN KEY(utility_account_id,organization_id) REFERENCES utility_accounts(id,organization_id),
 FOREIGN KEY(unit_id,organization_id) REFERENCES units(id,organization_id),
 CHECK((payment_domain='platform' AND platform_invoice_id IS NOT NULL AND unit_id IS NULL AND utility_account_id IS NULL)
    OR (payment_domain='property' AND platform_invoice_id IS NULL AND unit_id IS NOT NULL AND utility_account_id IS NULL)
    OR (payment_domain='utility' AND platform_invoice_id IS NULL AND unit_id IS NOT NULL AND utility_account_id IS NOT NULL)),
 UNIQUE(id,provider_instance_id),UNIQUE(id,organization_id)
);
CREATE TABLE payment_intent_invoices(
 payment_intent_id uuid NOT NULL,organization_id uuid NOT NULL,invoice_id uuid NOT NULL,
 amount_minor bigint NOT NULL CHECK(amount_minor>0),
 PRIMARY KEY(payment_intent_id,invoice_id),
 FOREIGN KEY(payment_intent_id,organization_id) REFERENCES payment_intents(id,organization_id),
 FOREIGN KEY(invoice_id,organization_id) REFERENCES invoices(id,organization_id)
);
ALTER TABLE payments DROP CONSTRAINT payments_source_check;
ALTER TABLE payments ADD CONSTRAINT payments_source_check CHECK(source IN ('manual_bank','sandbox','bank_import','provider'));
CREATE TABLE payment_transactions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),payment_intent_id uuid NOT NULL,provider_instance_id uuid NOT NULL,
 external_transaction_id text NOT NULL,transaction_type text NOT NULL CHECK(transaction_type IN ('payment','refund','reversal','correction')),
 amount_minor bigint NOT NULL CHECK(amount_minor>0),gross_amount_minor bigint NOT NULL CHECK(gross_amount_minor>0),
 provider_fee_minor bigint CHECK(provider_fee_minor>=0),net_amount_minor bigint,
 currency text NOT NULL CHECK(currency IN ('AMD','RUB','USD')),status text NOT NULL CHECK(status IN ('succeeded','failed')),
 provider_status text NOT NULL,provider_response_safe_json jsonb NOT NULL DEFAULT '{}',
 property_payment_id uuid UNIQUE REFERENCES payments(id),
 initiated_at timestamptz NOT NULL DEFAULT now(),confirmed_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(payment_intent_id,provider_instance_id) REFERENCES payment_intents(id,provider_instance_id),
 UNIQUE(provider_instance_id,external_transaction_id,transaction_type)
);
CREATE UNIQUE INDEX payment_intent_one_success ON payment_transactions(payment_intent_id) WHERE transaction_type='payment' AND status='succeeded';
CREATE TABLE platform_payment_allocations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),payment_transaction_id uuid NOT NULL UNIQUE REFERENCES payment_transactions(id),
 platform_invoice_id uuid NOT NULL REFERENCES platform_invoices(id),amount_minor bigint NOT NULL CHECK(amount_minor>0),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION guard_payment_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p payment_provider_instances%ROWTYPE;
BEGIN
 SELECT * INTO p FROM payment_provider_instances WHERE id=NEW.provider_instance_id;
 IF p.id IS NULL OR p.payment_domain<>NEW.payment_domain
 OR (NEW.payment_domain='property' AND (p.scope_type<>'organization' OR p.organization_id IS DISTINCT FROM NEW.organization_id))
 OR (NEW.payment_domain='platform' AND (p.scope_type<>'platform' OR p.organization_id IS NOT NULL))
 OR (NEW.payment_domain='utility' AND p.scope_type='organization' AND p.organization_id IS DISTINCT FROM NEW.organization_id)
 THEN RAISE EXCEPTION 'Payment merchant scope mismatch' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND
 (to_jsonb(NEW)-ARRAY['status','provider_payment_id','redirect_url','updated_at']) IS DISTINCT FROM
 (to_jsonb(OLD)-ARRAY['status','provider_payment_id','redirect_url','updated_at'])
 THEN RAISE EXCEPTION 'Payment obligation is immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND OLD.status IN ('succeeded','failed','cancelled') AND NEW.status<>OLD.status
 THEN RAISE EXCEPTION 'Terminal payment state is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER payment_identity BEFORE INSERT OR UPDATE ON payment_intents FOR EACH ROW EXECUTE FUNCTION guard_payment_identity();
CREATE FUNCTION guard_payment_provider_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.id,NEW.provider_code,NEW.provider_type,NEW.payment_domain,NEW.scope_type,NEW.organization_id,NEW.environment)
 IS DISTINCT FROM
 (OLD.id,OLD.provider_code,OLD.provider_type,OLD.payment_domain,OLD.scope_type,OLD.organization_id,OLD.environment)
 THEN RAISE EXCEPTION 'Merchant identity is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER payment_provider_identity BEFORE UPDATE ON payment_provider_instances FOR EACH ROW EXECUTE FUNCTION guard_payment_provider_identity();
CREATE FUNCTION guard_platform_invoice_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM subscriptions WHERE id=NEW.subscription_id AND organization_id=NEW.organization_id)
 THEN RAISE EXCEPTION 'Subscription organization mismatch' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status')
 THEN RAISE EXCEPTION 'Issued platform invoice is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER platform_invoice_identity BEFORE INSERT OR UPDATE ON platform_invoices FOR EACH ROW EXECUTE FUNCTION guard_platform_invoice_identity();
CREATE FUNCTION guard_payment_transaction() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n payment_intents%ROWTYPE;p payments%ROWTYPE;
BEGIN
 SELECT * INTO n FROM payment_intents WHERE id=NEW.payment_intent_id FOR UPDATE;
 IF n.id IS NULL OR NEW.provider_instance_id<>n.provider_instance_id OR NEW.currency<>n.currency
 OR (NEW.transaction_type='payment' AND NEW.amount_minor<>n.amount_minor)
 THEN RAISE EXCEPTION 'Provider transaction identity mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.property_payment_id IS NOT NULL THEN
  SELECT * INTO p FROM payments WHERE id=NEW.property_payment_id;
  IF n.payment_domain<>'property' OR p.organization_id<>n.organization_id OR p.payer_user_id<>n.payer_user_id
  OR p.currency<>n.currency OR p.amount_minor<>NEW.amount_minor OR p.source<>'provider'
  THEN RAISE EXCEPTION 'Property posting mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.transaction_type='payment' AND NEW.status='succeeded' AND n.payment_domain='property' AND NEW.property_payment_id IS NULL
 THEN RAISE EXCEPTION 'Property posting required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER payment_transaction_identity BEFORE INSERT ON payment_transactions FOR EACH ROW EXECUTE FUNCTION guard_payment_transaction();
CREATE FUNCTION guard_payment_invoice_link() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM payment_intents n JOIN invoices i ON i.id=NEW.invoice_id
  WHERE n.id=NEW.payment_intent_id AND n.payment_domain='property' AND i.organization_id=n.organization_id
  AND i.unit_id=n.unit_id AND i.payer_user_id=n.payer_user_id AND i.currency=n.currency AND i.status='published')
 THEN RAISE EXCEPTION 'Payment invoice scope mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER payment_invoice_link_identity BEFORE INSERT ON payment_intent_invoices FOR EACH ROW EXECUTE FUNCTION guard_payment_invoice_link();
CREATE FUNCTION guard_platform_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE i platform_invoices%ROWTYPE;t payment_transactions%ROWTYPE;n payment_intents%ROWTYPE;used bigint;
BEGIN
 SELECT * INTO t FROM payment_transactions WHERE id=NEW.payment_transaction_id;
 SELECT * INTO n FROM payment_intents WHERE id=t.payment_intent_id;
 SELECT * INTO i FROM platform_invoices WHERE id=NEW.platform_invoice_id FOR UPDATE;
 SELECT COALESCE(sum(amount_minor),0) INTO used FROM platform_payment_allocations WHERE platform_invoice_id=i.id;
 IF i.id IS NULL OR n.payment_domain<>'platform' OR n.platform_invoice_id<>i.id
 OR t.status<>'succeeded' OR t.transaction_type<>'payment' OR t.currency<>i.currency
 OR NEW.amount_minor>t.amount_minor OR used+NEW.amount_minor>i.amount_minor OR i.status IN ('draft','cancelled')
 THEN RAISE EXCEPTION 'Platform allocation mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER platform_allocation_balance BEFORE INSERT ON platform_payment_allocations FOR EACH ROW EXECUTE FUNCTION guard_platform_allocation();
CREATE TRIGGER payment_transaction_immutable BEFORE UPDATE OR DELETE ON payment_transactions FOR EACH ROW EXECUTE FUNCTION immutable_ledger();
CREATE TRIGGER payment_transaction_no_truncate BEFORE TRUNCATE ON payment_transactions FOR EACH STATEMENT EXECUTE FUNCTION immutable_ledger();
CREATE TRIGGER platform_allocation_immutable BEFORE UPDATE OR DELETE ON platform_payment_allocations FOR EACH ROW EXECUTE FUNCTION immutable_ledger();
CREATE TRIGGER platform_allocation_no_truncate BEFORE TRUNCATE ON platform_payment_allocations FOR EACH STATEMENT EXECUTE FUNCTION immutable_ledger();
CREATE TRIGGER intent_invoice_immutable BEFORE UPDATE OR DELETE ON payment_intent_invoices FOR EACH ROW EXECUTE FUNCTION immutable_ledger();
CREATE TRIGGER intent_invoice_no_truncate BEFORE TRUNCATE ON payment_intent_invoices FOR EACH STATEMENT EXECUTE FUNCTION immutable_ledger();
CREATE TRIGGER payment_intent_no_delete BEFORE DELETE ON payment_intents FOR EACH ROW EXECUTE FUNCTION immutable_ledger();
CREATE TRIGGER payment_intent_no_truncate BEFORE TRUNCATE ON payment_intents FOR EACH STATEMENT EXECUTE FUNCTION immutable_ledger();
CREATE TRIGGER platform_invoice_no_delete BEFORE DELETE ON platform_invoices FOR EACH ROW EXECUTE FUNCTION immutable_ledger();
-- Broaden the existing credit mechanism, not a new credit ledger.
CREATE OR REPLACE FUNCTION enforce_allocation_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p payments%ROWTYPE;i invoices%ROWTYPE;paid bigint;adjusted bigint;used bigint;a payment_accounts%ROWTYPE;
BEGIN
 SELECT * INTO p FROM payments WHERE id=NEW.payment_id AND organization_id=NEW.organization_id FOR UPDATE;
 SELECT * INTO i FROM invoices WHERE id=NEW.invoice_id AND organization_id=NEW.organization_id FOR UPDATE;
 IF p.id IS NULL OR i.id IS NULL OR i.status<>'published' OR p.currency<>i.currency OR p.payer_user_id<>i.payer_user_id
 THEN RAISE EXCEPTION 'Allocation identity mismatch'; END IF;
 SELECT * INTO a FROM payment_accounts WHERE payment_id=p.id;
 IF (NEW.allocation_kind='credit' AND (a.payment_id IS NULL OR p.source NOT IN ('bank_import','provider')))
 OR (a.payment_id IS NOT NULL AND a.unit_id<>i.unit_id)
 THEN RAISE EXCEPTION 'Allocation account mismatch'; END IF;
 SELECT COALESCE(sum(amount_minor),0) INTO used FROM payment_allocations WHERE payment_id=p.id;
 SELECT COALESCE(sum(amount_minor),0) INTO paid FROM payment_allocations WHERE invoice_id=i.id;
 SELECT COALESCE(sum(amount_minor),0) INTO adjusted FROM adjustments WHERE invoice_id=i.id;
 IF used+NEW.amount_minor>p.amount_minor OR paid+NEW.amount_minor>i.amount_minor+adjusted
 THEN RAISE EXCEPTION 'Allocation exceeds available balance'; END IF;
 RETURN NEW;
END $$;
