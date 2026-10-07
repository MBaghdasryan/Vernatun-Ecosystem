-- Additive only. No existing record/file/history backfill or migration.
CREATE TABLE notification_catalog(code text PRIMARY KEY,category text NOT NULL,critical boolean NOT NULL DEFAULT false);
INSERT INTO notification_catalog(code,category,critical) VALUES
('request_created','requests',false),('request_assigned','requests',false),
('visit_proposed','requests',false),('visit_changed','requests',false),
('technician_started','requests',false),('technician_completed','requests',false),
('manager_verified','requests',false),('resident_action_required','requests',false),
('new_charge','finance',false),('payment_received','finance',false),('payment_unmatched','finance',false),
('meeting_created','community',false),('voting_started','community',false),('voting_ending','community',false),
('announcement_published','community',false),('pass_expiring','access',false),('lease_expiring','leases',false),
('support_case_updated','support',false),('onboarding_task_due','onboarding',false),
('SLA_warning','requests',false),('SLA_breached','requests',false),
('account_security','system',true),('legacy_request_event','requests',false);
CREATE TABLE notification_preferences(
 user_id uuid PRIMARY KEY REFERENCES users(id),email_enabled boolean NOT NULL DEFAULT true,
 in_app_enabled boolean NOT NULL DEFAULT true,categories jsonb NOT NULL DEFAULT '{}',
 version integer NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(jsonb_typeof(categories)='object')
);
ALTER TABLE notifications ADD COLUMN event_code text REFERENCES notification_catalog(code);
ALTER TABLE notifications ADD COLUMN entity_type text NOT NULL DEFAULT 'request';
ALTER TABLE notifications ADD COLUMN dedupe_key text;
ALTER TABLE notifications ADD COLUMN in_app_enabled boolean NOT NULL DEFAULT true;
CREATE UNIQUE INDEX notification_dedupe ON notifications(user_id,dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE TABLE notification_email_outbox(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),notification_id uuid NOT NULL UNIQUE REFERENCES notifications(id),
 state text NOT NULL DEFAULT 'pending_domain' CHECK(state IN('pending_domain','cancelled','queued','sent','failed')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION notification_event_alias(k text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE k
 WHEN 'request.created' THEN 'request_created' WHEN 'request.assigned' THEN 'request_assigned'
 WHEN 'request.visit_proposed' THEN 'visit_proposed' WHEN 'request.visit_changed' THEN 'visit_changed'
 WHEN 'request.visit_confirmed' THEN 'visit_changed' WHEN 'request.visit_cancelled' THEN 'visit_changed'
 WHEN 'request.started' THEN 'technician_started' WHEN 'request.completed' THEN 'technician_completed'
 WHEN 'request.verified' THEN 'manager_verified' WHEN 'request.needs_info' THEN 'resident_action_required'
 WHEN 'request.sla_warning' THEN 'SLA_warning' WHEN 'request.sla_breached' THEN 'SLA_breached'
 ELSE CASE WHEN k LIKE 'sla.%.approaching' THEN 'SLA_warning' WHEN k LIKE 'sla.%.breached' THEN 'SLA_breached' ELSE 'legacy_request_event' END END
$$;
CREATE FUNCTION notification_channel_policy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cat text; forced boolean; pref notification_preferences%ROWTYPE;
BEGIN
 IF NEW.event_code IS NULL THEN
  SELECT code INTO NEW.event_code FROM notification_catalog WHERE code=NEW.kind;
  NEW.event_code:=COALESCE(NEW.event_code,notification_event_alias(NEW.kind));
 END IF;
 SELECT category,critical INTO cat,forced FROM notification_catalog WHERE code=NEW.event_code;
 SELECT * INTO pref FROM notification_preferences WHERE user_id=NEW.user_id;
 NEW.in_app_enabled:=forced OR (COALESCE(pref.in_app_enabled,true) AND COALESCE((pref.categories->cat->>'in_app')::boolean,true));
 RETURN NEW;
END $$;
CREATE TRIGGER notification_policy BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION notification_channel_policy();
CREATE FUNCTION notification_email_intent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cat text; forced boolean; pref notification_preferences%ROWTYPE;
BEGIN
 SELECT category,critical INTO cat,forced FROM notification_catalog WHERE code=NEW.event_code;
 SELECT * INTO pref FROM notification_preferences WHERE user_id=NEW.user_id;
 IF forced OR (COALESCE(pref.email_enabled,true) AND COALESCE((pref.categories->cat->>'email')::boolean,true)) THEN
  INSERT INTO notification_email_outbox(notification_id) VALUES(NEW.id);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER notification_email_intent AFTER INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION notification_email_intent();
CREATE FUNCTION emit_notification(uid uuid,org uuid,code text,etype text,eid uuid,key text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF uid IS NULL OR org IS NULL THEN RETURN; END IF;
 INSERT INTO notifications(user_id,organization_id,kind,event_code,entity_type,entity_id,dedupe_key)
 VALUES(uid,org,code,code,etype,eid,key) ON CONFLICT(user_id,dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
END $$;
CREATE FUNCTION notify_audience(org uuid,bld uuid,unt uuid,code text,etype text,eid uuid,key text,perms text[]) RETURNS void LANGUAGE plpgsql AS $$
DECLARE uid uuid;
BEGIN
 FOR uid IN SELECT DISTINCT a.user_id FROM role_assignments a JOIN memberships m ON m.user_id=a.user_id AND m.organization_id=a.organization_id
 WHERE a.organization_id=org AND a.active AND m.active AND a.starts_at<=now() AND (a.expires_at IS NULL OR a.expires_at>now())
 AND (bld IS NULL OR a.building_id IS NULL OR a.building_id=bld) AND (unt IS NULL OR a.unit_id IS NULL OR a.unit_id=unt)
 AND EXISTS(SELECT 1 FROM role_permissions p WHERE p.role_key=a.role_key AND p.permission_key=ANY(perms))
 LOOP PERFORM emit_notification(uid,org,code,etype,eid,key); END LOOP;
END $$;
CREATE FUNCTION phase7_business_notice() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n jsonb:=to_jsonb(NEW); o jsonb:='{}'; org uuid; bld uuid; unt uuid; eid uuid; uid uuid; code text; r jsonb;
BEGIN
 IF TG_OP='UPDATE' THEN o:=to_jsonb(OLD); END IF;
 org:=(n->>'organization_id')::uuid; bld:=(n->>'building_id')::uuid; unt:=(n->>'unit_id')::uuid; eid:=(n->>'id')::uuid;
 CASE TG_TABLE_NAME
 WHEN 'invoices' THEN
  IF n->>'status'='published' AND o->>'status' IS DISTINCT FROM 'published' THEN
   PERFORM emit_notification((n->>'payer_user_id')::uuid,org,'new_charge','invoice',eid,'invoice:'||eid);
  END IF;
 WHEN 'payments' THEN
  PERFORM emit_notification((n->>'payer_user_id')::uuid,org,'payment_received','payment',eid,'payment:'||eid);
 WHEN 'announcements' THEN
  PERFORM notify_audience(org,bld,NULL,'announcement_published','announcement',eid,'announcement:'||eid,ARRAY['announcements.read']);
 WHEN 'meetings' THEN
  code:=CASE WHEN TG_OP='INSERT' THEN 'meeting_created' WHEN n->>'status'='published' AND o->>'status' IS DISTINCT FROM 'published' THEN 'voting_started' END;
  IF code IS NOT NULL THEN PERFORM notify_audience(org,bld,NULL,code,'meeting',eid,code||':'||eid,ARRAY['meetings.read']); END IF;
 WHEN 'request_visits' THEN
  SELECT to_jsonb(q) INTO r FROM resident_requests q WHERE q.id=(n->>'request_id')::uuid;
  code:=CASE WHEN TG_OP='INSERT' OR n->>'status'='proposed' AND o->>'status' IS DISTINCT FROM 'proposed' THEN 'visit_proposed' ELSE 'visit_changed' END;
  PERFORM emit_notification(COALESCE((r->>'reported_for_user_id')::uuid,(r->>'author_user_id')::uuid),(r->>'organization_id')::uuid,code,'request',(r->>'id')::uuid,'visit:'||eid||':'||md5(n::text));
 WHEN 'support_cases' THEN
  IF TG_OP='INSERT' OR n->>'status' IS DISTINCT FROM o->>'status' OR n->>'assigned_to' IS DISTINCT FROM o->>'assigned_to' THEN
   PERFORM emit_notification((n->>'created_by')::uuid,org,'support_case_updated','support',eid,'case:'||eid||':'||md5(n::text));
   PERFORM emit_notification((n->>'assigned_to')::uuid,org,'support_case_updated','support',eid,'case:'||eid||':'||md5(n::text));
  END IF;
 WHEN 'support_messages' THEN
  IF COALESCE((n->>'internal')::boolean,false) THEN RETURN NEW; END IF;
  SELECT to_jsonb(q) INTO r FROM support_cases q WHERE q.id=(n->>'case_id')::uuid;
  org:=(r->>'organization_id')::uuid;
  PERFORM emit_notification((r->>'created_by')::uuid,org,'support_case_updated','support',(r->>'id')::uuid,'support-message:'||eid);
  PERFORM emit_notification((r->>'assigned_to')::uuid,org,'support_case_updated','support',(r->>'id')::uuid,'support-message:'||eid);
 WHEN 'bank_transactions' THEN
  IF n->>'payment_id' IS NULL AND NOT COALESCE((n->>'ignored')::boolean,false) AND TG_OP='INSERT' THEN
   PERFORM notify_audience(org,NULL,NULL,'payment_unmatched','bank_transaction',eid,'unmatched:'||eid,ARRAY['billing.write']);
  END IF;
 WHEN 'request_history' THEN
  SELECT to_jsonb(q) INTO r FROM resident_requests q WHERE q.id=(n->>'request_id')::uuid;
  bld:=(r->>'building_id')::uuid;
  IF bld IS NULL THEN SELECT building_id INTO bld FROM units WHERE id=(r->>'unit_id')::uuid; END IF;
  code:=notification_event_alias('request.'||(n->>'action'));
  IF code<>'legacy_request_event' THEN
   PERFORM notify_audience((r->>'organization_id')::uuid,bld,(r->>'unit_id')::uuid,code,'request',(r->>'id')::uuid,'history:'||eid,ARRAY['requests.read']);
   SELECT technician_id INTO uid FROM work_orders WHERE request_id=(r->>'id')::uuid;
   PERFORM emit_notification(uid,(r->>'organization_id')::uuid,code,'request',(r->>'id')::uuid,'history:'||eid);
  END IF;
 ELSE NULL;
 END CASE;
 RETURN NEW;
END $$;
CREATE TRIGGER phase7_invoices AFTER INSERT OR UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION phase7_business_notice();
CREATE TRIGGER phase7_payments AFTER INSERT ON payments FOR EACH ROW EXECUTE FUNCTION phase7_business_notice();
CREATE TRIGGER phase7_announcements AFTER INSERT ON announcements FOR EACH ROW EXECUTE FUNCTION phase7_business_notice();
CREATE TRIGGER phase7_meetings AFTER INSERT OR UPDATE ON meetings FOR EACH ROW EXECUTE FUNCTION phase7_business_notice();
CREATE TRIGGER phase7_visits AFTER INSERT OR UPDATE ON request_visits FOR EACH ROW EXECUTE FUNCTION phase7_business_notice();
CREATE TRIGGER phase7_support AFTER INSERT OR UPDATE ON support_cases FOR EACH ROW EXECUTE FUNCTION phase7_business_notice();
CREATE TRIGGER phase7_requests AFTER INSERT ON request_history FOR EACH ROW EXECUTE FUNCTION phase7_business_notice();
CREATE TRIGGER phase7_support_message_notice AFTER INSERT ON support_messages FOR EACH ROW EXECUTE FUNCTION phase7_business_notice();
CREATE TRIGGER phase7_bank_notice AFTER INSERT ON bank_transactions FOR EACH ROW EXECUTE FUNCTION phase7_business_notice();

ALTER TABLE organizations ADD COLUMN web_branding jsonb NOT NULL DEFAULT '{}';
ALTER TABLE organizations ADD COLUMN branding_version integer NOT NULL DEFAULT 0;
CREATE TABLE portfolio_objects(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES organizations(id),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120),kind text NOT NULL CHECK(kind IN('residential','commercial','mixed','other')),
 address text NOT NULL DEFAULT '',version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,organization_id)
);
ALTER TABLE buildings ADD COLUMN portfolio_object_id uuid;
ALTER TABLE buildings ADD CONSTRAINT building_portfolio_org FOREIGN KEY(portfolio_object_id,organization_id) REFERENCES portfolio_objects(id,organization_id);
CREATE INDEX building_portfolio_lookup ON buildings(organization_id,portfolio_object_id);
