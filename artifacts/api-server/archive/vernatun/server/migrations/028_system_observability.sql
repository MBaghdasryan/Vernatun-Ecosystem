INSERT INTO permissions(key)
SELECT p FROM unnest(ARRAY[
'system.read','system.health.read','backups.read','backups.create','backups.download','backups.restore',
'logs.read','logs.export','cache.read','cache.clear','api.read','api.keys.manage','api.clients.manage',
'integrations.read','integrations.manage','integrations.test','plugins.read','plugins.manage',
'updates.read','updates.upload','updates.install','updates.rollback','jobs.read','jobs.manage','environment.read'
]) AS p ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_key,permission_key)
SELECT 'platform_admin',key FROM permissions
WHERE key IN ('system.read','system.health.read','backups.read','backups.create','backups.download','backups.restore',
'logs.read','logs.export','cache.read','cache.clear','api.read','api.keys.manage','api.clients.manage',
'integrations.read','integrations.manage','integrations.test','plugins.read','plugins.manage',
'updates.read','updates.upload','updates.install','updates.rollback','jobs.read','jobs.manage','environment.read')
ON CONFLICT DO NOTHING;

CREATE TABLE system_log_events(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 created_at timestamptz NOT NULL DEFAULT now(),
 category text NOT NULL,
 level text NOT NULL,
 service text NOT NULL DEFAULT 'api',
 event text NOT NULL,
 request_id uuid,
 actor_user_id uuid,
 organization_id uuid,
 endpoint text,
 method text,
 http_status integer,
 latency_ms integer,
 error_code text,
 job text
);
CREATE INDEX system_logs_time ON system_log_events(created_at DESC,id DESC);
CREATE INDEX system_logs_actor ON system_log_events(actor_user_id,created_at DESC);
CREATE INDEX system_logs_request ON system_log_events(request_id);
CREATE TABLE system_job_runs(
 id uuid PRIMARY KEY,
 job text NOT NULL,
 started_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 status text NOT NULL CHECK(status IN('running','completed','failed','interrupted')),
 error_code text,
 heartbeat_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX system_jobs_time ON system_job_runs(started_at DESC);
