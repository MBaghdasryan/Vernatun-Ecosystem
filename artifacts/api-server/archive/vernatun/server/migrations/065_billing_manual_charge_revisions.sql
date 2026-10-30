-- Manual one-off charges need an append-only revision history separate from
-- published invoices. Editing an active charge supersedes a revision; it does
-- not rewrite the calculation snapshot already published on an invoice.
CREATE TABLE billing_manual_charges(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL,
 unit_id uuid NOT NULL,
 service_id uuid NOT NULL,
 period date NOT NULL CHECK(date_trunc('month',period)::date=period),
 amount_minor bigint NOT NULL CHECK(amount_minor>0),
 currency text NOT NULL CHECK(currency IN('AMD','RUB','USD')),
 reason text NOT NULL CHECK(length(reason) BETWEEN 5 AND 1000),
 revision integer NOT NULL CHECK(revision>0),
 status text NOT NULL DEFAULT 'active' CHECK(status IN('active','superseded')),
 supersedes_id uuid REFERENCES billing_manual_charges(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(unit_id,organization_id) REFERENCES units(id,organization_id),
 FOREIGN KEY(service_id,organization_id) REFERENCES services(id,organization_id),
 UNIQUE(organization_id,unit_id,service_id,period,revision)
);
CREATE INDEX billing_manual_charges_period ON billing_manual_charges(organization_id,period,status,unit_id,service_id);
