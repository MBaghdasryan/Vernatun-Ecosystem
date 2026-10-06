CREATE TABLE auth_rate_limits(key text PRIMARY KEY,hits integer NOT NULL,reset_at timestamptz NOT NULL);
CREATE INDEX auth_rate_expiry ON auth_rate_limits(reset_at);
CREATE TABLE mfa_credentials(user_id uuid PRIMARY KEY REFERENCES users(id),secret_encrypted text,pending_secret text,pending_until timestamptz,enabled boolean NOT NULL DEFAULT false,last_counter bigint NOT NULL DEFAULT -1,recovery_hashes text[] NOT NULL DEFAULT '{}');
