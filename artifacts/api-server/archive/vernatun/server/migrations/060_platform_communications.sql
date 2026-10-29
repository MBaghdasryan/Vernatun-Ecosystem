INSERT INTO permissions(key) VALUES('platform.communications.manage') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_key,permission_key)
VALUES('platform_admin','platform.communications.manage') ON CONFLICT DO NOTHING;

CREATE TABLE platform_notification_batches(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 idempotency_key uuid NOT NULL UNIQUE,
 target_type text NOT NULL CHECK(target_type IN('user','organization','building','all')),
 target_id uuid,
 organization_id uuid REFERENCES organizations(id),
 building_id uuid,
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 140),
 body text NOT NULL CHECK(length(body) BETWEEN 1 AND 5000),
 recipient_count integer NOT NULL CHECK(recipient_count>0),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((target_type IN('all','user') AND target_id IS NULL) OR
       (target_type IN('organization','building') AND target_id IS NOT NULL))
);

ALTER TABLE notifications
 ADD COLUMN manual_batch_id uuid REFERENCES platform_notification_batches(id),
 ADD COLUMN custom_title text,
 ADD COLUMN custom_body text;
CREATE INDEX notifications_manual_batch_idx ON notifications(manual_batch_id,created_at DESC)
 WHERE manual_batch_id IS NOT NULL;

CREATE OR REPLACE FUNCTION notification_email_intent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cat text; forced boolean; pref notification_preferences%ROWTYPE;
BEGIN
 IF NEW.manual_batch_id IS NOT NULL THEN RETURN NEW; END IF;
 SELECT category,critical INTO cat,forced FROM notification_catalog WHERE code=NEW.event_code;
 SELECT * INTO pref FROM notification_preferences WHERE user_id=NEW.user_id;
 IF forced OR (COALESCE(pref.email_enabled,true) AND COALESCE((pref.categories->cat->>'email')::boolean,true)) THEN
  INSERT INTO notification_email_outbox(notification_id) VALUES(NEW.id);
 END IF;
 RETURN NEW;
END $$;

CREATE TABLE platform_email_campaigns(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 idempotency_key uuid NOT NULL UNIQUE,
 target_type text NOT NULL CHECK(target_type IN('user','organization','building','all')),
 target_id uuid,
 organization_id uuid REFERENCES organizations(id),
 building_id uuid,
 subject text NOT NULL CHECK(length(subject) BETWEEN 1 AND 200),
 body_text text NOT NULL CHECK(length(body_text) BETWEEN 1 AND 10000),
 recipient_count integer NOT NULL CHECK(recipient_count>0),
 status text NOT NULL DEFAULT 'queued'
  CHECK(status IN('queued','sending','accepted','local','partial','failed','unknown')),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 CHECK((target_type IN('all','user') AND target_id IS NULL) OR
       (target_type IN('organization','building') AND target_id IS NOT NULL))
);
CREATE INDEX platform_email_campaigns_created_idx ON platform_email_campaigns(created_at DESC,id DESC);

CREATE TABLE platform_email_campaign_recipients(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 campaign_id uuid NOT NULL REFERENCES platform_email_campaigns(id),
 user_id uuid NOT NULL REFERENCES users(id),
 organization_id uuid NOT NULL REFERENCES organizations(id),
 email text NOT NULL,
 status text NOT NULL DEFAULT 'queued'
  CHECK(status IN('queued','sending','accepted','local','failed','unknown')),
 failure_code text,
 provider_message_id text,
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(campaign_id,email)
);
CREATE INDEX platform_email_campaign_recipients_queue
 ON platform_email_campaign_recipients(campaign_id,status,updated_at,id);
