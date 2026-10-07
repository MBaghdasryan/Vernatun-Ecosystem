CREATE TABLE operations_backup_policies(
 kind text PRIMARY KEY CHECK(kind IN('database','files','full_data','configuration','platform_snapshot')),
 enabled boolean NOT NULL DEFAULT false,
 frequency text NOT NULL DEFAULT 'daily' CHECK(frequency IN('daily','weekly','monthly')),
 provider text NOT NULL DEFAULT 'app_storage' CHECK(provider IN('app_storage','local','s3')),
 retention_days integer NOT NULL DEFAULT 30 CHECK(retention_days BETWEEN 30 AND 3650),
 keep_last integer NOT NULL DEFAULT 7 CHECK(keep_last BETWEEN 1 AND 100),
 auto_delete boolean NOT NULL DEFAULT false,
 revision integer NOT NULL DEFAULT 1,
 next_run_at timestamptz,
 last_queued_at timestamptz,
 updated_by uuid REFERENCES users(id),
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO operations_backup_policies(kind,frequency,keep_last)
 VALUES('database','daily',7),('files','weekly',4),('full_data','weekly',4),
 ('configuration','daily',7),('platform_snapshot','monthly',6);
ALTER TABLE operations_backups ADD COLUMN policy_kind text REFERENCES operations_backup_policies(kind);
CREATE INDEX operations_backups_policy ON operations_backups(policy_kind,created_at DESC);
