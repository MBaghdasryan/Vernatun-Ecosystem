ALTER TABLE platform_updates
 DROP CONSTRAINT platform_updates_status_check;

ALTER TABLE platform_updates
 ADD CONSTRAINT platform_updates_status_check CHECK(status IN(
  'uploading','validation_failed','needs_compatibility','validated','staged','dispatching','deploying',
  'deployment_unknown','deployed','deployment_rolled_back','deployment_failed','rollback_dispatch_unknown',
  'rollback_dispatching','rolling_back','rollback_completed','rollback_failed','storage_failed'
 )),
 ADD COLUMN staged_schema_version text,
 ADD COLUMN pipeline_baseline_version text,
 ADD COLUMN deployed_schema_version text,
 ADD COLUMN pipeline_action text CHECK(pipeline_action IN('deploy','rollback')),
 ADD COLUMN pipeline_job_id uuid,
 ADD COLUMN pipeline_token_hash text CHECK(pipeline_token_hash IS NULL OR pipeline_token_hash ~ '^[a-f0-9]{64}$'),
 ADD COLUMN pipeline_release_ref text,
 ADD COLUMN previous_release_ref text,
 ADD COLUMN deployment_id text,
 ADD COLUMN pipeline_callback_fingerprint text CHECK(pipeline_callback_fingerprint IS NULL OR pipeline_callback_fingerprint ~ '^[a-f0-9]{64}$');

CREATE INDEX platform_updates_release_state ON platform_updates(status,started_at DESC)
 WHERE status IN('dispatching','deploying','deployment_unknown','rollback_dispatch_unknown','rollback_dispatching','rolling_back');
