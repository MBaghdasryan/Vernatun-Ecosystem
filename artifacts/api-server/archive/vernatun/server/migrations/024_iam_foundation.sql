ALTER TABLE users ADD COLUMN account_status text NOT NULL DEFAULT 'active'
 CHECK(account_status IN ('active','locked','disabled'));
UPDATE users SET account_status='disabled' WHERE blocked;
ALTER TABLE role_assignments ADD COLUMN assignment_status text NOT NULL DEFAULT 'active'
 CHECK(assignment_status IN ('active','suspended','revoked'));
UPDATE role_assignments SET assignment_status='revoked' WHERE NOT active;

-- Legacy workflows continue to use blocked/active. Keep both representations
-- synchronized so no old authorization query accidentally ignores new status.
CREATE FUNCTION sync_iam_account_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.account_status<>'active' THEN NEW.blocked=true;
  ELSIF NEW.blocked THEN NEW.account_status='disabled'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.account_status IS DISTINCT FROM OLD.account_status THEN
  NEW.blocked=NEW.account_status<>'active';
 ELSIF NEW.blocked IS DISTINCT FROM OLD.blocked THEN
  NEW.account_status=CASE WHEN NEW.blocked THEN 'disabled' ELSE 'active' END;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER iam_account_status BEFORE INSERT OR UPDATE ON users
 FOR EACH ROW EXECUTE FUNCTION sync_iam_account_status();
CREATE FUNCTION sync_iam_assignment_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.assignment_status<>'active' THEN NEW.active=false;
  ELSIF NOT NEW.active THEN NEW.assignment_status='revoked'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.assignment_status IS DISTINCT FROM OLD.assignment_status THEN
  NEW.active=NEW.assignment_status='active';
 ELSIF NEW.active IS DISTINCT FROM OLD.active THEN
  NEW.assignment_status=CASE WHEN NEW.active THEN 'active' ELSE 'revoked' END;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER iam_assignment_status BEFORE INSERT OR UPDATE ON role_assignments
 FOR EACH ROW EXECUTE FUNCTION sync_iam_assignment_status();

CREATE TABLE iam_profiles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid REFERENCES organizations(id),
 name text NOT NULL CHECK(length(name) BETWEEN 2 AND 100),
 description text NOT NULL DEFAULT '',
 base_role text NOT NULL REFERENCES roles(key),
 permissions text[] NOT NULL DEFAULT '{}',
 tenant_allowed boolean NOT NULL DEFAULT false,
 active boolean NOT NULL DEFAULT true,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(base_role NOT IN ('platform_admin','support')),
 CHECK(organization_id IS NULL OR NOT tenant_allowed)
);
CREATE UNIQUE INDEX iam_profile_name ON iam_profiles(COALESCE(organization_id,'00000000-0000-0000-0000-000000000000'::uuid),lower(name));
ALTER TABLE role_assignments ADD COLUMN profile_id uuid REFERENCES iam_profiles(id);
CREATE TABLE iam_assignment_rules (
 assignment_id uuid NOT NULL REFERENCES role_assignments(id),
 permission_key text NOT NULL REFERENCES permissions(key),
 effect text NOT NULL CHECK(effect IN ('deny','grant')),
 reason text NOT NULL CHECK(length(reason) BETWEEN 5 AND 1000),
 expires_at timestamptz,
 created_by uuid NOT NULL REFERENCES users(id),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(assignment_id,permission_key,effect)
);
