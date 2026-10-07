INSERT INTO permissions(key) VALUES('logs.manage') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_key,permission_key)
VALUES('platform_admin','logs.manage') ON CONFLICT DO NOTHING;
CREATE TABLE system_error_states(
 fingerprint text PRIMARY KEY CHECK(fingerprint ~ '^[a-f0-9]{32}$'),
 status text NOT NULL CHECK(status IN ('open','resolved')),
 through_id bigint NOT NULL,
 through_count bigint NOT NULL,
 revision integer NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid NOT NULL REFERENCES users(id)
);
CREATE INDEX system_logs_errors ON system_log_events(id DESC) WHERE level IN ('error','fatal');
