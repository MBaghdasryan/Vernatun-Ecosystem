-- Building/common-area maintenance must not be attributed to a fake apartment
-- or to an impersonated employee. Existing unit/user requests stay unchanged.
ALTER TABLE resident_requests ADD COLUMN building_id uuid;
UPDATE resident_requests r SET building_id=u.building_id FROM units u WHERE u.id=r.unit_id;
ALTER TABLE resident_requests ADD FOREIGN KEY(building_id,organization_id) REFERENCES buildings(id,organization_id);
ALTER TABLE resident_requests ALTER COLUMN unit_id DROP NOT NULL;
ALTER TABLE resident_requests ALTER COLUMN author_user_id DROP NOT NULL;
ALTER TABLE resident_requests ADD CHECK(unit_id IS NOT NULL OR (source='system' AND building_id IS NOT NULL AND asset_id IS NOT NULL));
ALTER TABLE resident_requests ADD CHECK(author_user_id IS NOT NULL OR source='system');
ALTER TABLE work_orders ALTER COLUMN technician_id DROP NOT NULL;
ALTER TABLE work_orders ALTER COLUMN assigned_by DROP NOT NULL;
ALTER TABLE work_orders DROP CONSTRAINT work_orders_status_check;
ALTER TABLE work_orders ADD CHECK(status IN('queued','assigned','in_progress','review','resident_review','closed'));
ALTER TABLE work_orders ADD CHECK(technician_id IS NOT NULL OR status='queued');
ALTER TABLE request_history ALTER COLUMN actor_id DROP NOT NULL;

ALTER TABLE maintenance_plans
 ADD COLUMN frequency text NOT NULL DEFAULT 'once' CHECK(frequency IN('once','daily','weekly','monthly','quarterly','semiannual','annual','custom')),
 ADD COLUMN interval_days integer CHECK(interval_days BETWEEN 1 AND 36600),
 ADD COLUMN anchor_on date,
 ADD COLUMN cycle_no integer NOT NULL DEFAULT 0 CHECK(cycle_no>=0),
 ADD COLUMN active boolean NOT NULL DEFAULT false,
 ADD COLUMN automatic boolean NOT NULL DEFAULT false,
 ADD COLUMN technician_id uuid REFERENCES users(id),
 ADD COLUMN unit_id uuid,
 ADD COLUMN category_id uuid,
 ADD COLUMN priority text NOT NULL DEFAULT 'normal' CHECK(priority IN('low','normal','high','urgent','emergency')),
 ADD COLUMN checklist jsonb NOT NULL DEFAULT '[]',
 ADD COLUMN instructions text NOT NULL DEFAULT '',
 ADD COLUMN version integer NOT NULL DEFAULT 1,
 ADD COLUMN last_error text,
 ADD COLUMN configured_by uuid REFERENCES users(id),
 ADD COLUMN last_completed_at timestamptz,
 ADD FOREIGN KEY(unit_id,organization_id) REFERENCES units(id,organization_id),
 ADD FOREIGN KEY(category_id,organization_id) REFERENCES request_categories(id,organization_id),
 ADD CHECK(frequency<>'custom' OR interval_days IS NOT NULL);
UPDATE maintenance_plans SET anchor_on=due_on,last_completed_at=completed_at;
-- Preserve legacy imports/fixtures that supply due_on but not the new anchor.
CREATE FUNCTION initialize_maintenance_anchor() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.anchor_on=COALESCE(NEW.anchor_on,NEW.due_on);RETURN NEW;END $$;
CREATE TRIGGER maintenance_anchor_default BEFORE INSERT ON maintenance_plans FOR EACH ROW EXECUTE FUNCTION initialize_maintenance_anchor();
ALTER TABLE maintenance_plans ALTER COLUMN anchor_on SET NOT NULL;
ALTER TABLE maintenance_plans ADD UNIQUE(id,organization_id);
ALTER TABLE resident_requests ADD UNIQUE(id,organization_id);
ALTER TABLE work_orders ADD UNIQUE(id,request_id);

CREATE TABLE maintenance_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id),
 plan_id uuid NOT NULL,
 cycle_no integer NOT NULL,
 due_on date NOT NULL,
 request_id uuid NOT NULL UNIQUE,
 work_order_id uuid NOT NULL UNIQUE,
 plan_snapshot jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz,
 UNIQUE(plan_id,cycle_no),
 FOREIGN KEY(plan_id,organization_id) REFERENCES maintenance_plans(id,organization_id),
 FOREIGN KEY(request_id,organization_id) REFERENCES resident_requests(id,organization_id),
 FOREIGN KEY(work_order_id,request_id) REFERENCES work_orders(id,request_id)
);
CREATE UNIQUE INDEX maintenance_one_open_event ON maintenance_events(plan_id) WHERE completed_at IS NULL;
ALTER TABLE maintenance_plans ADD COLUMN current_event_id uuid REFERENCES maintenance_events(id);
CREATE INDEX maintenance_generation_due ON maintenance_plans(due_on,id) WHERE active AND automatic;
