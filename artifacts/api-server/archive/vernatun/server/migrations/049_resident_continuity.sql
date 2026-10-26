ALTER TABLE resident_profiles ADD COLUMN verified_email text;
ALTER TABLE resident_profiles ADD COLUMN email_verified_at timestamptz;
ALTER TABLE resident_building_settings ADD COLUMN activation_required boolean NOT NULL DEFAULT false;
ALTER TABLE resident_building_settings ADD COLUMN finance_transparency boolean NOT NULL DEFAULT false;
CREATE TABLE resident_email_challenges(
 user_id uuid PRIMARY KEY REFERENCES users(id),email text NOT NULL,code_hash text NOT NULL,
 expires_at timestamptz NOT NULL,sent_at timestamptz NOT NULL DEFAULT now(),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),consumed_at timestamptz
);
ALTER TABLE notification_preferences ADD COLUMN quiet_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE notification_preferences ADD COLUMN quiet_start text NOT NULL DEFAULT '22:00' CHECK(quiet_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
ALTER TABLE notification_preferences ADD COLUMN quiet_end text NOT NULL DEFAULT '08:00' CHECK(quiet_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
ALTER TABLE notification_preferences ADD COLUMN timezone text NOT NULL DEFAULT 'Asia/Yerevan';
ALTER TABLE notifications ADD COLUMN visible_after timestamptz;
ALTER TABLE notification_email_outbox ADD COLUMN not_before timestamptz;
CREATE FUNCTION resident_quiet_until(uid uuid,at_time timestamptz) RETURNS timestamptz LANGUAGE plpgsql STABLE AS $$
DECLARE p notification_preferences%ROWTYPE; local_at timestamp; finish timestamp;
BEGIN
 SELECT * INTO p FROM notification_preferences WHERE user_id=uid;
 IF NOT FOUND OR NOT p.quiet_enabled OR p.quiet_start=p.quiet_end THEN RETURN NULL; END IF;
 local_at:=at_time AT TIME ZONE p.timezone;
 IF p.quiet_start<p.quiet_end THEN
  IF local_at::time<p.quiet_start::time OR local_at::time>=p.quiet_end::time THEN RETURN NULL; END IF;
  finish:=local_at::date+p.quiet_end::time;
 ELSE
  IF local_at::time<p.quiet_start::time AND local_at::time>=p.quiet_end::time THEN RETURN NULL; END IF;
  finish:=local_at::date+p.quiet_end::time;
  IF local_at::time>=p.quiet_start::time THEN finish:=finish+interval '1 day'; END IF;
 END IF;
 RETURN finish AT TIME ZONE p.timezone;
END $$;
CREATE FUNCTION resident_notification_quiet() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT COALESCE((SELECT critical FROM notification_catalog WHERE code=NEW.event_code),false) THEN
  NEW.visible_after:=resident_quiet_until(NEW.user_id,now());
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER notification_quiet BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION resident_notification_quiet();
CREATE FUNCTION resident_email_quiet() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 SELECT visible_after INTO NEW.not_before FROM notifications WHERE id=NEW.notification_id;
 RETURN NEW;
END $$;
CREATE TRIGGER notification_email_quiet BEFORE INSERT ON notification_email_outbox FOR EACH ROW EXECUTE FUNCTION resident_email_quiet();
CREATE TABLE resident_direct_threads(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES organizations(id),
 building_id uuid NOT NULL,left_user uuid NOT NULL REFERENCES users(id),right_user uuid NOT NULL REFERENCES users(id),
 blocked_by uuid[] NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),CHECK(left_user<right_user),
 UNIQUE(building_id,left_user,right_user),FOREIGN KEY(building_id,organization_id) REFERENCES buildings(id,organization_id)
);
CREATE TABLE resident_direct_messages(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),thread_id uuid NOT NULL REFERENCES resident_direct_threads(id),
 sender_id uuid NOT NULL REFERENCES users(id),client_id uuid NOT NULL,body text NOT NULL,
 version integer NOT NULL DEFAULT 1,deleted_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(thread_id,sender_id,client_id)
);
CREATE INDEX resident_direct_history ON resident_direct_messages(thread_id,created_at,id);
CREATE TABLE resident_direct_reads(
 thread_id uuid NOT NULL REFERENCES resident_direct_threads(id),user_id uuid NOT NULL REFERENCES users(id),
 read_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(thread_id,user_id)
);
CREATE TABLE resident_saved_searches(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES organizations(id),
 building_id uuid NOT NULL,user_id uuid NOT NULL REFERENCES users(id),name text NOT NULL,
 filters jsonb NOT NULL CHECK(jsonb_typeof(filters)='object'),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(building_id,organization_id) REFERENCES buildings(id,organization_id)
);
CREATE INDEX resident_saved_search_owner ON resident_saved_searches(user_id,building_id,created_at);
CREATE TABLE resident_ai_threads(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES organizations(id),
 building_id uuid NOT NULL,unit_id uuid NOT NULL,user_id uuid NOT NULL REFERENCES users(id),
 title text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(building_id,organization_id) REFERENCES buildings(id,organization_id),
 FOREIGN KEY(unit_id,organization_id) REFERENCES units(id,organization_id)
);
CREATE TABLE resident_ai_messages(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),thread_id uuid NOT NULL REFERENCES resident_ai_threads(id),
 client_id uuid NOT NULL,body text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(thread_id,client_id)
);
CREATE TABLE resident_service_bookings(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES organizations(id),
 building_id uuid NOT NULL,unit_id uuid NOT NULL,user_id uuid NOT NULL REFERENCES users(id),
 service_id uuid NOT NULL REFERENCES resident_product_records(id),title text NOT NULL,
 starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL,note text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'requested' CHECK(status IN('requested','confirming','confirmed','rejected','cancelled')),
 request_key uuid NOT NULL DEFAULT gen_random_uuid(),request_id uuid REFERENCES resident_requests(id),
 confirmed_category_id uuid REFERENCES request_categories(id),version integer NOT NULL DEFAULT 1,
 confirmed_by uuid REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),CHECK(ends_at>starts_at),
 FOREIGN KEY(building_id,organization_id) REFERENCES buildings(id,organization_id),
 FOREIGN KEY(unit_id,organization_id) REFERENCES units(id,organization_id)
);
