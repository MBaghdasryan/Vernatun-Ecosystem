-- Additive Phase 2 extensions; the existing request/work order workflow remains authoritative.
CREATE TABLE request_categories(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES organizations(id),
 key text NOT NULL CHECK(length(key) BETWEEN 1 AND 60),name text NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
 active boolean NOT NULL DEFAULT true,version integer NOT NULL DEFAULT 1,
 UNIQUE(organization_id,key),UNIQUE(id,organization_id)
);
CREATE TABLE sla_policies(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES organizations(id),
 category_id uuid,priority text NOT NULL CHECK(priority IN('low','normal','high','urgent','emergency')),
 response_minutes integer NOT NULL CHECK(response_minutes BETWEEN 1 AND 43200),
 assignment_minutes integer NOT NULL CHECK(assignment_minutes BETWEEN 1 AND 43200),
 arrival_minutes integer NOT NULL CHECK(arrival_minutes BETWEEN 1 AND 43200),
 resolution_minutes integer NOT NULL CHECK(resolution_minutes BETWEEN 1 AND 43200),
 pause_resolution boolean NOT NULL DEFAULT true,version integer NOT NULL DEFAULT 1,
 FOREIGN KEY(category_id,organization_id) REFERENCES request_categories(id,organization_id),
 UNIQUE NULLS NOT DISTINCT(organization_id,category_id,priority)
);
CREATE FUNCTION initialize_operations(org uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO request_categories(organization_id,key,name)
 SELECT org,k,k FROM unnest(ARRAY['plumbing','electrical','heating','elevator','cleaning','common_area','security','access','intercom','meter','internet','parking','landscaping','emergency','other']) k ON CONFLICT DO NOTHING;
 INSERT INTO sla_policies(organization_id,priority,response_minutes,assignment_minutes,arrival_minutes,resolution_minutes)
 SELECT org,p,r,a,v,x FROM (VALUES('low',240,480,1440,2880),('normal',120,240,480,1440),('high',30,60,120,480),('urgent',10,20,60,120),('emergency',5,10,20,60)) defaults(p,r,a,v,x)
 ON CONFLICT DO NOTHING;
END $$;
SELECT initialize_operations(id) FROM organizations;
CREATE FUNCTION initialize_new_organization_operations() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM initialize_operations(NEW.id);RETURN NEW;END $$;
CREATE TRIGGER organization_operations AFTER INSERT ON organizations FOR EACH ROW EXECUTE FUNCTION initialize_new_organization_operations();
ALTER TABLE resident_requests ADD COLUMN source text NOT NULL DEFAULT 'resident_app'
 CHECK(source IN('resident_app','dispatcher_phone','manager','system','import'));
ALTER TABLE resident_requests ADD COLUMN reported_for_user_id uuid REFERENCES users(id);
ALTER TABLE resident_requests ADD COLUMN category_id uuid;
ALTER TABLE resident_requests ADD COLUMN priority text NOT NULL DEFAULT 'normal'
 CHECK(priority IN('low','normal','high','urgent','emergency'));
ALTER TABLE resident_requests ADD COLUMN contact_method text NOT NULL DEFAULT 'app'
 CHECK(contact_method IN('app','phone','email','none'));
ALTER TABLE resident_requests ADD COLUMN preferred_visit_start timestamptz;
ALTER TABLE resident_requests ADD COLUMN preferred_visit_end timestamptz;
ALTER TABLE resident_requests ADD COLUMN asset_id uuid;
ALTER TABLE resident_requests ADD COLUMN sla_snapshot jsonb;
ALTER TABLE resident_requests ADD COLUMN escalation_level integer NOT NULL DEFAULT 0;
ALTER TABLE resident_requests ADD FOREIGN KEY(category_id,organization_id) REFERENCES request_categories(id,organization_id);
ALTER TABLE resident_requests ADD FOREIGN KEY(asset_id,organization_id) REFERENCES assets(id,organization_id);
ALTER TABLE resident_requests ADD CHECK(
 (preferred_visit_start IS NULL AND preferred_visit_end IS NULL)
 OR (preferred_visit_start IS NOT NULL AND preferred_visit_end IS NOT NULL AND preferred_visit_end>preferred_visit_start));
ALTER TABLE work_orders ADD COLUMN accepted_at timestamptz;
ALTER TABLE work_orders ADD COLUMN paused_at timestamptz;
ALTER TABLE work_orders ADD COLUMN blocked_reason text;
ALTER TABLE request_photos ADD COLUMN photo_type text NOT NULL DEFAULT 'evidence' CHECK(photo_type IN('before','during','after','evidence'));
CREATE TABLE request_sla_deadlines(
 request_id uuid NOT NULL REFERENCES resident_requests(id),kind text NOT NULL CHECK(kind IN('response','assignment','arrival','resolution')),
 due_at timestamptz NOT NULL,satisfied_at timestamptz,PRIMARY KEY(request_id,kind)
);
CREATE INDEX outstanding_sla ON request_sla_deadlines(due_at) WHERE satisfied_at IS NULL;
CREATE TABLE request_escalations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),request_id uuid NOT NULL REFERENCES resident_requests(id),
 kind text NOT NULL,level integer NOT NULL CHECK(level IN(1,2)),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(request_id,kind,level)
);
CREATE TABLE request_visits(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),request_id uuid NOT NULL REFERENCES resident_requests(id),
 starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL CHECK(ends_at>starts_at),
 status text NOT NULL DEFAULT 'proposed' CHECK(status IN('proposed','confirmed','cancelled','superseded')),
 resident_required boolean NOT NULL DEFAULT true,resident_confirmed_at timestamptz,technician_confirmed_at timestamptz,
 created_by uuid NOT NULL REFERENCES users(id),version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_active_visit ON request_visits(request_id) WHERE status IN('proposed','confirmed');
CREATE TABLE visit_history(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),visit_id uuid NOT NULL REFERENCES request_visits(id),
 actor_id uuid NOT NULL REFERENCES users(id),action text NOT NULL,snapshot jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE work_materials(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),request_id uuid NOT NULL REFERENCES resident_requests(id),
 actor_id uuid NOT NULL REFERENCES users(id),kind text NOT NULL CHECK(kind IN('material','service')),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 160),quantity numeric(12,3) NOT NULL CHECK(quantity>0),
 unit text NOT NULL CHECK(length(unit) BETWEEN 1 AND 30),unit_cost_minor bigint CHECK(unit_cost_minor>=0),
 comment text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE incidents ADD COLUMN severity text NOT NULL DEFAULT 'normal' CHECK(severity IN('low','normal','high','critical'));
ALTER TABLE incidents ADD COLUMN status text NOT NULL DEFAULT 'open' CHECK(status IN('open','investigating','resolved','closed'));
ALTER TABLE incidents ADD COLUMN version integer NOT NULL DEFAULT 1;
CREATE TABLE incident_history(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),incident_id uuid NOT NULL REFERENCES incidents(id),
 actor_id uuid NOT NULL REFERENCES users(id),action text NOT NULL,note text NOT NULL DEFAULT '',snapshot jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE incident_attachments(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),incident_id uuid NOT NULL REFERENCES incidents(id),
 author_id uuid NOT NULL REFERENCES users(id),storage_key text NOT NULL UNIQUE,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION immutable_operation_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Operation evidence is append-only';END $$;
CREATE TRIGGER visit_history_immutable BEFORE UPDATE OR DELETE ON visit_history FOR EACH ROW EXECUTE FUNCTION immutable_operation_evidence();
CREATE TRIGGER visit_history_no_truncate BEFORE TRUNCATE ON visit_history FOR EACH STATEMENT EXECUTE FUNCTION immutable_operation_evidence();
CREATE TRIGGER incident_history_immutable BEFORE UPDATE OR DELETE ON incident_history FOR EACH ROW EXECUTE FUNCTION immutable_operation_evidence();
CREATE TRIGGER incident_history_no_truncate BEFORE TRUNCATE ON incident_history FOR EACH STATEMENT EXECUTE FUNCTION immutable_operation_evidence();
CREATE TRIGGER escalations_immutable BEFORE UPDATE OR DELETE ON request_escalations FOR EACH ROW EXECUTE FUNCTION immutable_operation_evidence();
CREATE TRIGGER escalations_no_truncate BEFORE TRUNCATE ON request_escalations FOR EACH STATEMENT EXECUTE FUNCTION immutable_operation_evidence();
CREATE OR REPLACE FUNCTION notify_request_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO notifications(user_id,organization_id,kind,entity_id)
 SELECT COALESCE(r.reported_for_user_id,r.author_user_id),r.organization_id,'request.'||NEW.action,NEW.request_id
 FROM resident_requests r WHERE r.id=NEW.request_id AND COALESCE(r.reported_for_user_id,r.author_user_id)<>NEW.actor_id;
 RETURN NEW;
END $$;
INSERT INTO permissions(key) VALUES('requests.configure'),('incidents.read'),('incidents.manage') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_key,permission_key) VALUES
 ('manager','requests.configure'),('org_admin','requests.configure'),
 ('manager','incidents.read'),('dispatcher','incidents.read'),('security','incidents.read'),('org_admin','incidents.read'),
 ('manager','incidents.manage'),('dispatcher','incidents.manage'),('security','incidents.manage'),('org_admin','incidents.manage'),
 ('manager','incidents.create'),('dispatcher','incidents.create'),('org_admin','incidents.create'),
 ('technician','assets.read') ON CONFLICT DO NOTHING;
