CREATE TABLE platform_updates(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 file_name text NOT NULL,
 version text,
 previous_version text,
 package_checksum text NOT NULL CHECK(package_checksum ~ '^[a-f0-9]{64}$'),
 size_bytes bigint NOT NULL CHECK(size_bytes BETWEEN 0 AND 33554432),
 manifest jsonb,
 validation jsonb NOT NULL DEFAULT '{}'::jsonb,
 status text NOT NULL CHECK(status IN('uploading','validation_failed','needs_compatibility','validated','staged','storage_failed')),
 uploaded_by uuid REFERENCES users(id),
 uploaded_at timestamptz NOT NULL DEFAULT now(),
 installed_by uuid REFERENCES users(id),
 started_at timestamptz,
 finished_at timestamptz,
 result text,
 backup_id uuid REFERENCES operations_backups(id),
 log jsonb NOT NULL DEFAULT '[]'::jsonb,
 error_code text,
 rollback_result text
);
CREATE INDEX platform_updates_history ON platform_updates(uploaded_at DESC,id DESC);
CREATE INDEX platform_updates_staged ON platform_updates(status,uploaded_at DESC) WHERE status='staged';
