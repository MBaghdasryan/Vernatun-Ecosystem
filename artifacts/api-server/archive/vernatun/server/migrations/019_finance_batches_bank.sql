CREATE TABLE billing_batches(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES organizations(id),
 building_id uuid NOT NULL,tariff_id uuid NOT NULL,period date NOT NULL CHECK(extract(day FROM period)=1),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','cancelled')),
 snapshot jsonb NOT NULL,fingerprint text NOT NULL,version integer NOT NULL DEFAULT 1,
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
 published_by uuid REFERENCES users(id),published_at timestamptz,
 FOREIGN KEY(building_id,organization_id) REFERENCES buildings(id,organization_id),
 FOREIGN KEY(tariff_id,organization_id) REFERENCES tariffs(id,organization_id),
 UNIQUE(id,organization_id)
);
CREATE TABLE billing_batch_invoices(
 batch_id uuid NOT NULL,organization_id uuid NOT NULL,invoice_id uuid NOT NULL UNIQUE,
 PRIMARY KEY(batch_id,invoice_id),
 FOREIGN KEY(batch_id,organization_id) REFERENCES billing_batches(id,organization_id),
 FOREIGN KEY(invoice_id,organization_id) REFERENCES invoices(id,organization_id)
);
CREATE TABLE bank_import_batches(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES organizations(id),
 account text NOT NULL,imported_count integer NOT NULL,duplicate_count integer NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,organization_id)
);
ALTER TABLE payments DROP CONSTRAINT payments_source_check;
ALTER TABLE payments ADD CONSTRAINT payments_source_check CHECK(source IN ('manual_bank','sandbox','bank_import'));
ALTER TABLE payments ADD CONSTRAINT payments_id_org_payer_unique UNIQUE(id,organization_id,payer_user_id);
CREATE TABLE payment_accounts(
 payment_id uuid PRIMARY KEY,organization_id uuid NOT NULL,unit_id uuid NOT NULL,payer_user_id uuid NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(payment_id,organization_id,payer_user_id) REFERENCES payments(id,organization_id,payer_user_id),
 FOREIGN KEY(unit_id,organization_id) REFERENCES units(id,organization_id)
);
CREATE TRIGGER payment_account_immutable BEFORE UPDATE OR DELETE ON payment_accounts FOR EACH ROW EXECUTE FUNCTION immutable_ledger();
CREATE TABLE bank_transactions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL,import_batch_id uuid NOT NULL,
 account text NOT NULL,external_id text NOT NULL,transaction_date date NOT NULL,amount_minor bigint NOT NULL CHECK(amount_minor<>0),
 currency text NOT NULL CHECK(currency IN ('AMD','RUB','USD')),payer_text text NOT NULL,purpose text NOT NULL,
 raw_payload jsonb NOT NULL DEFAULT '{}',fingerprint text NOT NULL,
 payment_id uuid,ignored boolean NOT NULL DEFAULT false,ignore_reason text,version integer NOT NULL DEFAULT 1,
 confirmed_by uuid REFERENCES users(id),confirmed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(NOT ignored OR payment_id IS NULL),
 FOREIGN KEY(import_batch_id,organization_id) REFERENCES bank_import_batches(id,organization_id),
 FOREIGN KEY(payment_id,organization_id) REFERENCES payments(id,organization_id),
 UNIQUE(organization_id,account,external_id),UNIQUE(payment_id),UNIQUE(id,organization_id)
);
CREATE INDEX bank_transaction_queue ON bank_transactions(organization_id,created_at DESC);
CREATE FUNCTION protect_bank_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR
 (to_jsonb(NEW)-ARRAY['payment_id','ignored','ignore_reason','version','confirmed_by','confirmed_at']) IS DISTINCT FROM
 (to_jsonb(OLD)-ARRAY['payment_id','ignored','ignore_reason','version','confirmed_by','confirmed_at']) OR
 (OLD.payment_id IS NOT NULL AND NEW.payment_id IS DISTINCT FROM OLD.payment_id)
 THEN RAISE EXCEPTION 'Imported bank evidence is immutable'; END IF;
 IF NEW.payment_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM payments p JOIN payment_accounts a ON a.payment_id=p.id
  WHERE p.id=NEW.payment_id AND p.organization_id=NEW.organization_id AND p.source='bank_import'
  AND p.amount_minor=NEW.amount_minor AND p.currency=NEW.currency
 ) THEN RAISE EXCEPTION 'Bank payment does not match evidence'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER bank_identity_guard BEFORE UPDATE OR DELETE ON bank_transactions FOR EACH ROW EXECUTE FUNCTION protect_bank_identity();
-- Keep initial-allocation uniqueness for all legacy callers. Only the new,
-- append-only credit path may add further allocations to the same invoice.
ALTER TABLE payment_allocations ADD COLUMN allocation_kind text NOT NULL DEFAULT 'initial' CHECK(allocation_kind IN ('initial','credit'));
ALTER TABLE payment_allocations DROP CONSTRAINT payment_allocations_payment_id_invoice_id_key;
CREATE UNIQUE INDEX allocation_initial_unique ON payment_allocations(payment_id,invoice_id) WHERE allocation_kind='initial';
CREATE FUNCTION enforce_allocation_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p payments%ROWTYPE;i invoices%ROWTYPE;paid bigint;adjusted bigint;used bigint;a payment_accounts%ROWTYPE;
BEGIN
 SELECT * INTO p FROM payments WHERE id=NEW.payment_id AND organization_id=NEW.organization_id FOR UPDATE;
 SELECT * INTO i FROM invoices WHERE id=NEW.invoice_id AND organization_id=NEW.organization_id FOR UPDATE;
 IF p.id IS NULL OR i.id IS NULL OR i.status<>'published' OR p.currency<>i.currency OR p.payer_user_id<>i.payer_user_id
 THEN RAISE EXCEPTION 'Allocation identity mismatch'; END IF;
 SELECT * INTO a FROM payment_accounts WHERE payment_id=p.id;
 IF (NEW.allocation_kind='credit' AND (a.payment_id IS NULL OR p.source<>'bank_import'))
 OR (a.payment_id IS NOT NULL AND a.unit_id<>i.unit_id)
 THEN RAISE EXCEPTION 'Allocation account mismatch'; END IF;
 SELECT COALESCE(sum(amount_minor),0) INTO used FROM payment_allocations WHERE payment_id=p.id;
 SELECT COALESCE(sum(amount_minor),0) INTO paid FROM payment_allocations WHERE invoice_id=i.id;
 SELECT COALESCE(sum(amount_minor),0) INTO adjusted FROM adjustments WHERE invoice_id=i.id;
 IF used+NEW.amount_minor>p.amount_minor OR paid+NEW.amount_minor>i.amount_minor+adjusted
 THEN RAISE EXCEPTION 'Allocation exceeds available balance'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER allocation_balance_guard BEFORE INSERT ON payment_allocations FOR EACH ROW EXECUTE FUNCTION enforce_allocation_balance();
CREATE TRIGGER bank_import_immutable BEFORE UPDATE OR DELETE ON bank_import_batches FOR EACH ROW EXECUTE FUNCTION immutable_ledger();
CREATE TRIGGER batch_invoice_immutable BEFORE UPDATE OR DELETE ON billing_batch_invoices FOR EACH ROW EXECUTE FUNCTION immutable_ledger();
CREATE FUNCTION protect_billing_batch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.status<>'draft' OR
 (to_jsonb(NEW)-ARRAY['status','version','published_by','published_at']) IS DISTINCT FROM
 (to_jsonb(OLD)-ARRAY['status','version','published_by','published_at'])
 THEN RAISE EXCEPTION 'Billing preview and published batches are immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER billing_batch_guard BEFORE UPDATE OR DELETE ON billing_batches FOR EACH ROW EXECUTE FUNCTION protect_billing_batch();
CREATE FUNCTION enforce_adjustment_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE i invoices%ROWTYPE;paid bigint;adjusted bigint;
BEGIN
 SELECT * INTO i FROM invoices WHERE id=NEW.invoice_id AND organization_id=NEW.organization_id FOR UPDATE;
 SELECT COALESCE(sum(amount_minor),0) INTO paid FROM payment_allocations WHERE invoice_id=i.id;
 SELECT COALESCE(sum(amount_minor),0) INTO adjusted FROM adjustments WHERE invoice_id=i.id;
 IF i.id IS NULL OR i.status<>'published' OR i.amount_minor+adjusted+NEW.amount_minor<paid
 THEN RAISE EXCEPTION 'Adjustment exceeds available invoice balance'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER adjustment_balance_guard BEFORE INSERT ON adjustments FOR EACH ROW EXECUTE FUNCTION enforce_adjustment_balance();
