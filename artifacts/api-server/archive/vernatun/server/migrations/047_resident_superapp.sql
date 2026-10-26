-- Additive resident-product data only. Existing finance/IAM/workflow/Edge remain authoritative.
CREATE TABLE resident_profiles (
 user_id uuid PRIMARY KEY REFERENCES users(id),
 phone text NOT NULL DEFAULT '', theme text NOT NULL DEFAULT 'system' CHECK(theme IN('system','light','dark')),
 preferred_channel text NOT NULL DEFAULT 'email' CHECK(preferred_channel IN('email','phone')),
 show_name boolean NOT NULL DEFAULT false, show_unit boolean NOT NULL DEFAULT false,
 show_phone boolean NOT NULL DEFAULT false, allow_messages boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE resident_building_settings (
 building_id uuid PRIMARY KEY, organization_id uuid NOT NULL,
 directory boolean NOT NULL DEFAULT false, discussions boolean NOT NULL DEFAULT false,
 chat boolean NOT NULL DEFAULT false, marketplace boolean NOT NULL DEFAULT false,
 services boolean NOT NULL DEFAULT false,
 updated_by uuid NOT NULL REFERENCES users(id), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(building_id,organization_id) REFERENCES buildings(id,organization_id)
);
-- Explicitly discriminated record payloads are validated by resident-record-policy.
-- Immutable organization/building/owner/kind values never come from client payload.
CREATE TABLE resident_product_records (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL, building_id uuid NOT NULL, unit_id uuid,
 kind text NOT NULL CHECK(kind IN('vehicles','mobile-devices','agreements','contacts','services','subscriptions','conversations','discussions','listings','help','feedback')),
 owner_user_id uuid NOT NULL REFERENCES users(id), title text NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
 body text NOT NULL DEFAULT '' CHECK(length(body)<=5000),
 data jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(data)='object'),
 status text NOT NULL, version integer NOT NULL DEFAULT 1 CHECK(version>0),
 parent_id uuid, linked_request_id uuid REFERENCES resident_requests(id),
 session_ref text, deleted_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(building_id,organization_id) REFERENCES buildings(id,organization_id),
 FOREIGN KEY(unit_id,building_id,organization_id) REFERENCES units(id,building_id,organization_id),
 UNIQUE(id,building_id,organization_id),
 FOREIGN KEY(parent_id,building_id,organization_id) REFERENCES resident_product_records(id,building_id,organization_id)
);
CREATE INDEX resident_records_scope ON resident_product_records(organization_id,building_id,kind,created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX resident_records_owner ON resident_product_records(owner_user_id,kind);
CREATE UNIQUE INDEX resident_installation ON resident_product_records(owner_user_id,(data->>'installationId'))
 WHERE kind='mobile-devices' AND deleted_at IS NULL AND status='active';
CREATE TABLE resident_record_marks (
 record_id uuid NOT NULL REFERENCES resident_product_records(id), user_id uuid NOT NULL REFERENCES users(id),
 mark text NOT NULL CHECK(mark IN('accepted','withdrawn','saved','supported','read','reported')),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(record_id,user_id,mark)
);
CREATE TABLE resident_product_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), record_id uuid NOT NULL REFERENCES resident_product_records(id),
 sender_id uuid NOT NULL REFERENCES users(id), body text NOT NULL CHECK(length(body) BETWEEN 1 AND 5000),
 client_id uuid NOT NULL, reply_to uuid REFERENCES resident_product_messages(id),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(sender_id,client_id)
);
CREATE INDEX resident_messages_thread ON resident_product_messages(record_id,created_at DESC);
