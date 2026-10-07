CREATE TABLE unit_plans (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 unit_id uuid NOT NULL REFERENCES units(id),
 document_version_id uuid NOT NULL REFERENCES document_versions(id),
 revision integer NOT NULL DEFAULT 1,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 retired_at timestamptz
);
CREATE UNIQUE INDEX unit_plans_current ON unit_plans(unit_id) WHERE retired_at IS NULL;
CREATE TABLE defect_plan_markers (
 plan_id uuid NOT NULL REFERENCES unit_plans(id),
 defect_id uuid NOT NULL REFERENCES defects(id),
 x double precision NOT NULL CHECK(x>=0 AND x<=1),
 y double precision NOT NULL CHECK(y>=0 AND y<=1),
 PRIMARY KEY(plan_id,defect_id)
);
