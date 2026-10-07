CREATE TABLE leads (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK(length(name) BETWEEN 2 AND 120),
 contact text NOT NULL CHECK(length(contact)<=254),
 organization text,
 product_interest text NOT NULL,
 audience text NOT NULL,
 message text,
 consent boolean NOT NULL CHECK(consent),
 language text NOT NULL CHECK(language IN ('hy','ru','en')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX leads_created_idx ON leads(created_at DESC,id DESC);
INSERT INTO permissions(key) VALUES('leads.read') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_key,permission_key) VALUES('platform_admin','leads.read') ON CONFLICT DO NOTHING;
CREATE TABLE mfa_policies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid REFERENCES organizations(id),
 role_key text NOT NULL REFERENCES roles(key) CHECK(role_key IN ('platform_admin','org_admin')),
 required boolean NOT NULL DEFAULT false,
 enforce_after timestamptz,
 version integer NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(NOT required OR enforce_after IS NOT NULL),
 CHECK((role_key='platform_admin' AND organization_id IS NULL) OR (role_key='org_admin' AND organization_id IS NOT NULL))
);
CREATE UNIQUE INDEX mfa_policy_scope ON mfa_policies(role_key,COALESCE(organization_id,'00000000-0000-0000-0000-000000000000'::uuid));
