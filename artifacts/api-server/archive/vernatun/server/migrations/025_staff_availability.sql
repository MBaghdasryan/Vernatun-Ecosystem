-- Additive planning records. No existing business rows or files are modified.
CREATE TABLE staff_availability (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id),
 building_id uuid NOT NULL REFERENCES buildings(id),
 unit_id uuid REFERENCES units(id),
 technician_id uuid NOT NULL REFERENCES users(id),
 kind text NOT NULL CHECK (kind IN ('shift','absence')),
 starts_at timestamptz NOT NULL,
 ends_at timestamptz NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK (version>0),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 cancelled_at timestamptz,
 FOREIGN KEY(building_id,organization_id) REFERENCES buildings(id,organization_id),
 FOREIGN KEY(unit_id,building_id,organization_id) REFERENCES units(id,building_id,organization_id),
 FOREIGN KEY(technician_id,organization_id) REFERENCES memberships(user_id,organization_id),
 CHECK (ends_at>starts_at),
 CHECK (ends_at-starts_at<=interval '62 days'),
 CHECK (kind<>'shift' OR ends_at-starts_at<=interval '24 hours')
);
CREATE INDEX staff_availability_window ON staff_availability
 (organization_id,building_id,technician_id,starts_at,ends_at) WHERE cancelled_at IS NULL;
