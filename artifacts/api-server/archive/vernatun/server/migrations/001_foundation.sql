CREATE TABLE IF NOT EXISTS users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text UNIQUE NOT NULL,
 name text NOT NULL, password_hash text NOT NULL, blocked boolean NOT NULL DEFAULT false,
 locale text NOT NULL DEFAULT 'hy' CHECK(locale IN ('hy','ru','en')),
 currency text NOT NULL DEFAULT 'AMD' CHECK(currency IN ('AMD','RUB','USD')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE organizations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
 timezone text NOT NULL DEFAULT 'Asia/Yerevan', currency text NOT NULL DEFAULT 'AMD' CHECK(currency IN ('AMD','RUB','USD')),
 is_demo boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE memberships (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
 organization_id uuid NOT NULL REFERENCES organizations(id), active boolean NOT NULL DEFAULT true,
 UNIQUE(user_id,organization_id), UNIQUE(id,user_id,organization_id)
);
CREATE TABLE roles (key text PRIMARY KEY, shell text NOT NULL CHECK(shell IN ('platform','workspace','field','home')));
CREATE TABLE permissions (key text PRIMARY KEY);
CREATE TABLE role_permissions (role_key text REFERENCES roles(key), permission_key text REFERENCES permissions(key), PRIMARY KEY(role_key,permission_key));
CREATE TABLE buildings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
 name text NOT NULL, address text NOT NULL, is_demo boolean NOT NULL DEFAULT false,
 UNIQUE(id,organization_id)
);
CREATE TABLE units (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, building_id uuid NOT NULL,
 number text NOT NULL, area numeric(12,2) NOT NULL CHECK(area>0), is_demo boolean NOT NULL DEFAULT false,
 FOREIGN KEY(building_id,organization_id) REFERENCES buildings(id,organization_id),
 UNIQUE(id,organization_id), UNIQUE(id,building_id,organization_id), UNIQUE(building_id,number)
);
CREATE TABLE role_assignments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
 organization_id uuid REFERENCES organizations(id), role_key text NOT NULL REFERENCES roles(key),
 building_id uuid, unit_id uuid, active boolean NOT NULL DEFAULT true,
 starts_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz,
 FOREIGN KEY(user_id,organization_id) REFERENCES memberships(user_id,organization_id),
 FOREIGN KEY(building_id,organization_id) REFERENCES buildings(id,organization_id),
 FOREIGN KEY(unit_id,building_id,organization_id) REFERENCES units(id,building_id,organization_id),
 CHECK(unit_id IS NULL OR building_id IS NOT NULL),
 CHECK(organization_id IS NOT NULL OR (building_id IS NULL AND unit_id IS NULL AND role_key IN ('platform_admin','support'))),
 CHECK(organization_id IS NULL OR role_key NOT IN ('platform_admin','support')),
 CHECK(expires_at IS NULL OR expires_at>starts_at)
);
CREATE INDEX assignments_user_idx ON role_assignments(user_id);
CREATE TABLE module_entitlements (
 organization_id uuid REFERENCES organizations(id), module text NOT NULL,
 enabled boolean NOT NULL DEFAULT true, PRIMARY KEY(organization_id,module)
);
CREATE TABLE invoices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, unit_id uuid NOT NULL,
 payer_user_id uuid NOT NULL REFERENCES users(id), period date NOT NULL,
 amount_minor bigint NOT NULL CHECK(amount_minor>=0), currency text NOT NULL CHECK(currency IN ('AMD','RUB','USD')),
 status text NOT NULL CHECK(status IN ('draft','published')), is_demo boolean NOT NULL DEFAULT false,
 FOREIGN KEY(unit_id,organization_id) REFERENCES units(id,organization_id)
);
CREATE FUNCTION immutable_published_invoice() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF OLD.status='published' THEN RAISE EXCEPTION 'Published invoices are immutable'; END IF; RETURN NEW; END $$;
CREATE TRIGGER invoices_immutable BEFORE UPDATE OR DELETE ON invoices FOR EACH ROW EXECUTE FUNCTION immutable_published_invoice();
CREATE TABLE resident_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, unit_id uuid NOT NULL,
 author_user_id uuid NOT NULL REFERENCES users(id), subject text NOT NULL,
 status text NOT NULL DEFAULT 'new' CHECK(status IN ('new','assigned','in_progress','review','closed')),
 created_at timestamptz NOT NULL DEFAULT now(), is_demo boolean NOT NULL DEFAULT false,
 FOREIGN KEY(unit_id,organization_id) REFERENCES units(id,organization_id)
);
CREATE TABLE invitations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
 email text NOT NULL, role_key text NOT NULL REFERENCES roles(key), building_id uuid, unit_id uuid,
 token_hash text UNIQUE NOT NULL, invited_by uuid NOT NULL REFERENCES users(id),
 expires_at timestamptz NOT NULL, accepted_at timestamptz, revoked_at timestamptz,
 FOREIGN KEY(building_id,organization_id) REFERENCES buildings(id,organization_id),
 FOREIGN KEY(unit_id,building_id,organization_id) REFERENCES units(id,building_id,organization_id),
 CHECK(unit_id IS NULL OR building_id IS NOT NULL), CHECK(role_key NOT IN ('platform_admin','support'))
);
CREATE TABLE password_resets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
 token_hash text UNIQUE NOT NULL, expires_at timestamptz NOT NULL, used_at timestamptz
);
CREATE TABLE audit_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid REFERENCES organizations(id),
 actor_user_id uuid REFERENCES users(id), action text NOT NULL, entity_type text NOT NULL,
 entity_id text, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE session (
 sid varchar PRIMARY KEY, sess json NOT NULL, expire timestamp(6) NOT NULL
);
CREATE INDEX session_expire_idx ON session(expire);
CREATE INDEX audit_org_idx ON audit_events(organization_id,created_at DESC);
