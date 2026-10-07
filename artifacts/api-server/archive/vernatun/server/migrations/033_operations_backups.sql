INSERT INTO permissions(key) VALUES('backups.delete'),('backups.policies.manage') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_key,permission_key)
 VALUES('platform_admin','backups.delete'),('platform_admin','backups.policies.manage') ON CONFLICT DO NOTHING;
CREATE TABLE operations_backups(
 id uuid PRIMARY KEY,
 kind text NOT NULL CHECK(kind IN('database','files','full_data','configuration','platform_snapshot')),
 status text NOT NULL CHECK(status IN('pending','running','completed','failed','expired','deleted')),
 created_at timestamptz NOT NULL DEFAULT now(),
 created_by uuid REFERENCES users(id),
 finished_at timestamptz,
 provider text NOT NULL,
 bytes bigint,
 checksum text,
 application_version text,
 migration_version text,
 verification text NOT NULL DEFAULT 'not_verified' CHECK(verification IN('not_verified','verified','verification_failed')),
 verified_at timestamptz,
 error_code text,
 notes text NOT NULL DEFAULT '',
 retain_until timestamptz NOT NULL DEFAULT now()+interval '30 days'
);
CREATE INDEX operations_backups_created ON operations_backups(created_at DESC,id);
