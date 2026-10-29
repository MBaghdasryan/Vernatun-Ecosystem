-- Extend the existing finance ledger. Historical invoices and applied
-- migrations remain untouched; new calculations carry their own snapshots.
ALTER TABLE services
 ADD COLUMN description text NOT NULL DEFAULT '',
 ADD COLUMN category text NOT NULL DEFAULT 'other'
  CHECK(category IN('maintenance','security','cleaning','waste','parking','intercom','utilities','optional','other')),
 ADD COLUMN billing_enabled boolean NOT NULL DEFAULT true,
 ADD COLUMN mandatory boolean NOT NULL DEFAULT true,
 ADD COLUMN active boolean NOT NULL DEFAULT true,
 ADD COLUMN default_calculation_method text NOT NULL DEFAULT 'FIXED_PER_UNIT'
  CHECK(default_calculation_method IN('FIXED_PER_UNIT','PER_SQUARE_METER','PER_RESIDENT','PER_PARKING_SPACE','PER_METER_CONSUMPTION','PER_QUANTITY','PER_DAY','MANUAL'));

ALTER TABLE tariffs
 ADD COLUMN name text NOT NULL DEFAULT '',
 ADD COLUMN calculation_method text NOT NULL DEFAULT 'FIXED_PER_UNIT'
  CHECK(calculation_method IN('FIXED_PER_UNIT','PER_SQUARE_METER','PER_RESIDENT','PER_PARKING_SPACE','PER_METER_CONSUMPTION','PER_QUANTITY','PER_DAY','MANUAL')),
 ADD COLUMN rate_unit text NOT NULL DEFAULT 'unit',
 ADD COLUMN valid_from date,
 ADD COLUMN valid_until date,
 ADD COLUMN status text NOT NULL DEFAULT 'active'
  CHECK(status IN('draft','active','superseded','archived')),
 ADD COLUMN created_by uuid REFERENCES users(id),
 ADD COLUMN replaced_by uuid;

UPDATE tariffs t SET
 name=s.name,
 calculation_method=CASE WHEN t.basis='area' THEN 'PER_SQUARE_METER' ELSE 'FIXED_PER_UNIT' END,
 rate_unit=CASE WHEN t.basis='area' THEN 'm2' ELSE 'unit' END,
 valid_from=t.created_at::date
FROM services s WHERE s.id=t.service_id AND s.organization_id=t.organization_id;
UPDATE tariffs SET valid_from=created_at::date WHERE valid_from IS NULL;
ALTER TABLE tariffs ALTER COLUMN valid_from SET NOT NULL;
ALTER TABLE tariffs ADD CONSTRAINT tariffs_valid_range CHECK(valid_until IS NULL OR valid_until>=valid_from);
ALTER TABLE tariffs ADD CONSTRAINT tariffs_replaced_by_fk FOREIGN KEY(replaced_by) REFERENCES tariffs(id);
ALTER TABLE tariffs ADD CONSTRAINT tariffs_id_service_org_unique UNIQUE(id,service_id,organization_id);

CREATE TABLE billing_rules(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id),
 service_id uuid NOT NULL,
 tariff_id uuid NOT NULL,
 scope_kind text NOT NULL CHECK(scope_kind IN('organization','building','unit')),
 building_id uuid,
 unit_id uuid,
 calculation_method text NOT NULL
  CHECK(calculation_method IN('FIXED_PER_UNIT','PER_SQUARE_METER','PER_RESIDENT','PER_PARKING_SPACE','PER_METER_CONSUMPTION','PER_QUANTITY','PER_DAY','MANUAL')),
 occupancy_count_mode text CHECK(occupancy_count_mode IS NULL OR occupancy_count_mode IN('AUTO_ACTIVE_RESIDENTS','REGISTRY_COUNT','MANUAL_COUNT')),
 zero_policy text NOT NULL DEFAULT 'MANUAL_REVIEW' CHECK(zero_policy IN('ALLOW_ZERO','MINIMUM_ONE','MANUAL_REVIEW')),
 rounding_mode text NOT NULL DEFAULT 'NEAREST_AMD' CHECK(rounding_mode IN('NEAREST_AMD','ROUND_UP_AMD','ROUND_DOWN_AMD')),
 proration_mode text NOT NULL DEFAULT 'DISABLED' CHECK(proration_mode IN('DISABLED','DAILY')),
 minimum_amount bigint CHECK(minimum_amount IS NULL OR minimum_amount>=0),
 maximum_amount bigint CHECK(maximum_amount IS NULL OR maximum_amount>=0),
 valid_from date NOT NULL,
 valid_until date,
 active boolean NOT NULL DEFAULT false,
 priority integer NOT NULL DEFAULT 0,
 meter_kind text CHECK(meter_kind IS NULL OR meter_kind IN('water','electricity','gas')),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(valid_until IS NULL OR valid_until>=valid_from),
 CHECK(maximum_amount IS NULL OR minimum_amount IS NULL OR maximum_amount>=minimum_amount),
 CHECK((scope_kind='organization' AND building_id IS NULL AND unit_id IS NULL)
   OR (scope_kind='building' AND building_id IS NOT NULL AND unit_id IS NULL)
   OR (scope_kind='unit' AND building_id IS NOT NULL AND unit_id IS NOT NULL)),
 CHECK((calculation_method='PER_RESIDENT')=(occupancy_count_mode IS NOT NULL)),
 FOREIGN KEY(service_id,organization_id) REFERENCES services(id,organization_id),
 FOREIGN KEY(tariff_id,service_id,organization_id) REFERENCES tariffs(id,service_id,organization_id),
 FOREIGN KEY(building_id,organization_id) REFERENCES buildings(id,organization_id),
 FOREIGN KEY(unit_id,building_id,organization_id) REFERENCES units(id,building_id,organization_id),
 UNIQUE(id,organization_id)
);
CREATE INDEX billing_rules_scope_lookup ON billing_rules(organization_id,service_id,active,valid_from,valid_until);

CREATE TABLE unit_billing_parameters(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL,
 unit_id uuid NOT NULL,
 billing_area numeric(12,2) CHECK(billing_area IS NULL OR billing_area>0),
 resident_count_mode text NOT NULL CHECK(resident_count_mode IN('AUTO_ACTIVE_RESIDENTS','REGISTRY_COUNT','MANUAL_COUNT')),
 billing_resident_count integer CHECK(billing_resident_count IS NULL OR billing_resident_count>=0),
 occupancy_status text NOT NULL DEFAULT 'UNKNOWN' CHECK(occupancy_status IN('OCCUPIED','VACANT','UNKNOWN')),
 effective_from date NOT NULL,
 effective_until date,
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 1000),
 changed_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(effective_until IS NULL OR effective_until>=effective_from),
 CHECK((resident_count_mode='AUTO_ACTIVE_RESIDENTS' AND billing_resident_count IS NULL)
    OR (resident_count_mode IN('REGISTRY_COUNT','MANUAL_COUNT') AND billing_resident_count IS NOT NULL)),
 FOREIGN KEY(unit_id,organization_id) REFERENCES units(id,organization_id),
 UNIQUE(organization_id,unit_id,effective_from)
);
CREATE INDEX unit_billing_parameters_effective ON unit_billing_parameters(organization_id,unit_id,effective_from,effective_until);

CREATE TABLE unit_billing_resident_eligibility(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL,
 unit_id uuid NOT NULL,
 role_assignment_id uuid NOT NULL REFERENCES role_assignments(id),
 resides_here boolean NOT NULL,
 counts_for_billing boolean NOT NULL,
 effective_from date NOT NULL,
 effective_until date,
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 1000),
 changed_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(effective_until IS NULL OR effective_until>=effective_from),
 FOREIGN KEY(unit_id,organization_id) REFERENCES units(id,organization_id),
 UNIQUE(role_assignment_id,effective_from)
);
CREATE INDEX billing_resident_eligibility_period ON unit_billing_resident_eligibility(organization_id,unit_id,effective_from,effective_until);

CREATE TABLE unit_billing_service_quantities(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL,
 unit_id uuid NOT NULL,
 service_id uuid NOT NULL,
 quantity numeric(18,4) NOT NULL CHECK(quantity>=0),
 effective_from date NOT NULL,
 effective_until date,
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 1000),
 changed_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(effective_until IS NULL OR effective_until>=effective_from),
 FOREIGN KEY(unit_id,organization_id) REFERENCES units(id,organization_id),
 FOREIGN KEY(service_id,organization_id) REFERENCES services(id,organization_id),
 UNIQUE(organization_id,unit_id,service_id,effective_from)
);
CREATE INDEX unit_billing_quantities_period ON unit_billing_service_quantities(organization_id,unit_id,service_id,effective_from,effective_until);

CREATE TABLE unit_billing_service_applicability(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL,
 unit_id uuid NOT NULL,
 service_id uuid NOT NULL,
 enabled boolean NOT NULL,
 effective_from date NOT NULL,
 effective_until date,
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 1000),
 changed_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(effective_until IS NULL OR effective_until>=effective_from),
 FOREIGN KEY(unit_id,organization_id) REFERENCES units(id,organization_id),
 FOREIGN KEY(service_id,organization_id) REFERENCES services(id,organization_id),
 UNIQUE(organization_id,unit_id,service_id,effective_from)
);
CREATE INDEX unit_billing_applicability_period ON unit_billing_service_applicability(organization_id,unit_id,service_id,effective_from,effective_until);

CREATE TABLE billing_parameter_review_requests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL,
 unit_id uuid NOT NULL,
 requested_by uuid NOT NULL REFERENCES users(id),
 service_id uuid,
 parameter_key text NOT NULL CHECK(parameter_key IN('billing_area','resident_count','service_applicability','parking_count')),
 current_value jsonb NOT NULL DEFAULT 'null'::jsonb,
 proposed_value jsonb NOT NULL,
 effective_from date,
 reason text NOT NULL CHECK(length(reason) BETWEEN 5 AND 2000),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','approved','rejected','needs_information')),
 decision_note text,
 decided_by uuid REFERENCES users(id),
 decided_at timestamptz,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(unit_id,organization_id) REFERENCES units(id,organization_id),
 FOREIGN KEY(service_id,organization_id) REFERENCES services(id,organization_id),
 CHECK((status='pending' AND decided_at IS NULL AND decided_by IS NULL)
    OR (status<>'pending' AND decided_at IS NOT NULL AND decided_by IS NOT NULL))
);
CREATE INDEX billing_parameter_review_queue ON billing_parameter_review_requests(organization_id,status,created_at DESC);

CREATE TABLE billing_manual_charges(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL,
 unit_id uuid NOT NULL,
 service_id uuid NOT NULL,
 period date NOT NULL CHECK(date_trunc('month',period)::date=period),
 amount_minor bigint NOT NULL CHECK(amount_minor>0),
 currency text NOT NULL CHECK(currency IN('AMD','RUB','USD')),
 reason text NOT NULL CHECK(length(reason) BETWEEN 5 AND 1000),
 revision integer NOT NULL CHECK(revision>0),
 status text NOT NULL DEFAULT 'active' CHECK(status IN('active','superseded')),
 supersedes_id uuid REFERENCES billing_manual_charges(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(unit_id,organization_id) REFERENCES units(id,organization_id),
 FOREIGN KEY(service_id,organization_id) REFERENCES services(id,organization_id),
 UNIQUE(organization_id,unit_id,service_id,period,revision)
);
CREATE INDEX billing_manual_charges_period ON billing_manual_charges(organization_id,period,status,unit_id,service_id);

ALTER TABLE invoice_lines ADD COLUMN calculation_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE billing_batches ADD COLUMN snapshot_kind text NOT NULL DEFAULT 'legacy'
 CHECK(snapshot_kind IN('legacy','rule_engine'));
