-- Additive platform completion foundation. Existing users, bytes and records are retained.
ALTER TABLE organizations ADD COLUMN subscription_enforced boolean NOT NULL DEFAULT false;
ALTER TABLE subscription_plans ADD COLUMN allowed_modules text[] NOT NULL
 DEFAULT ARRAY['requests','finance','handover','access','community','maintenance','meters','documents'];
ALTER TABLE subscription_plans ADD COLUMN grace_days integer NOT NULL DEFAULT 7 CHECK(grace_days BETWEEN 0 AND 90);
ALTER TABLE subscriptions ADD COLUMN grace_until timestamptz;
ALTER TABLE subscriptions ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE subscriptions ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE subscriptions DROP CONSTRAINT subscriptions_status_check;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_status_check
 CHECK(status IN ('trial','active','past_due','suspended','cancelled','expired','paused'));
-- "paused" remains readable for pre-existing subscriptions; new actions use suspended.
ALTER TABLE module_entitlements ADD COLUMN override_state text NOT NULL DEFAULT 'inherited'
 CHECK(override_state IN ('inherited','enabled','disabled'));
ALTER TABLE module_entitlements ADD COLUMN override_reason text NOT NULL DEFAULT '';
ALTER TABLE module_entitlements ADD COLUMN updated_by uuid REFERENCES users(id);
ALTER TABLE module_entitlements ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE invitations ADD COLUMN email_delivery_status text NOT NULL DEFAULT 'unknown'
 CHECK(email_delivery_status IN ('unknown','local','sent','failed'));
ALTER TABLE invitations ADD COLUMN email_delivery_at timestamptz;
ALTER TABLE support_access_grants ADD COLUMN expired_audited_at timestamptz;
CREATE INDEX subscriptions_policy_lookup ON subscriptions(organization_id,starts_on DESC,created_at DESC);
CREATE INDEX audit_organization_date ON audit_events(organization_id,created_at DESC,id DESC);
CREATE INDEX audit_date ON audit_events(created_at DESC,id DESC);
CREATE INDEX audit_actor_date ON audit_events(actor_user_id,created_at DESC);

CREATE FUNCTION protect_audit_events() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Audit events are append-only' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events
 FOR EACH ROW EXECUTE FUNCTION protect_audit_events();
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events
 FOR EACH STATEMENT EXECUTE FUNCTION protect_audit_events();

-- UPDATE and audit INSERT belong to the same statement/transaction.
-- A racing caller sees the updated marker and cannot emit a second event.
CREATE FUNCTION expire_support_grants(subject_user uuid DEFAULT NULL) RETURNS integer LANGUAGE sql AS $$
 WITH expired AS (
  UPDATE support_access_grants SET expired_audited_at=now()
  WHERE approved_at IS NOT NULL AND revoked_at IS NULL AND expires_at<=now()
   AND expired_audited_at IS NULL AND (subject_user IS NULL OR support_user_id=subject_user)
  RETURNING id,organization_id
 ), recorded AS (
  INSERT INTO audit_events(organization_id,action,entity_type,entity_id,details)
  SELECT organization_id,'support.expire','support_access_grant',id::text,
   '{"result":"success","reason":"grant_expired"}'::jsonb FROM expired RETURNING id
 ) SELECT count(*)::integer FROM recorded;
$$;
