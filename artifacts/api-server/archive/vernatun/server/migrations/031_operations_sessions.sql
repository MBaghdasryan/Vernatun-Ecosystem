INSERT INTO permissions(key) VALUES('sessions.read'),('sessions.revoke') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_key,permission_key)
 VALUES('platform_admin','sessions.read'),('platform_admin','sessions.revoke') ON CONFLICT DO NOTHING;
CREATE TABLE system_revoked_sessions(
 ref text PRIMARY KEY CHECK(ref ~ '^[a-f0-9]{64}$'),
 revoked_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL
);
