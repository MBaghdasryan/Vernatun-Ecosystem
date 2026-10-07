CREATE TABLE api_clients (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid REFERENCES organizations(id),
 name text NOT NULL, description text NOT NULL DEFAULT '',
 client_type text NOT NULL CHECK(client_type IN('platform','organization','integration','machine_to_machine')),
 status text NOT NULL DEFAULT 'active' CHECK(status IN('active','disabled')),
 allowed_scopes text[] NOT NULL, allowed_ips text[] NOT NULL DEFAULT '{}',
 created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 last_used_at timestamptz
);
CREATE TABLE api_keys (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id uuid NOT NULL REFERENCES api_clients(id),
 name text NOT NULL, prefix text NOT NULL, key_hash text NOT NULL UNIQUE,
 scopes text[] NOT NULL, expires_at timestamptz NOT NULL,
 revoked_at timestamptz, last_used_at timestamptz,
 requests_per_minute integer NOT NULL CHECK(requests_per_minute BETWEEN 1 AND 300),
 created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX api_keys_client ON api_keys(client_id,created_at DESC);
