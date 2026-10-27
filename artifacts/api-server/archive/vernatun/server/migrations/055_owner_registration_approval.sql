CREATE TABLE resident_owner_access_requests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id),
 organization_id uuid NOT NULL REFERENCES organizations(id),
 building_id uuid NOT NULL,
 unit_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'pending_email'
  CHECK(status IN ('pending_email','pending_approval','approved','rejected')),
 requested_at timestamptz NOT NULL DEFAULT now(),
 reviewed_at timestamptz,
 reviewed_by uuid REFERENCES users(id),
 review_note text NOT NULL DEFAULT '',
 FOREIGN KEY(building_id,organization_id) REFERENCES buildings(id,organization_id),
 FOREIGN KEY(unit_id,building_id,organization_id) REFERENCES units(id,building_id,organization_id),
 CHECK((status IN ('approved','rejected'))=(reviewed_at IS NOT NULL)),
 CHECK((status IN ('approved','rejected'))=(reviewed_by IS NOT NULL))
);
CREATE UNIQUE INDEX resident_owner_access_pending_unit
 ON resident_owner_access_requests(user_id,unit_id)
 WHERE status IN ('pending_email','pending_approval');
CREATE INDEX resident_owner_access_review_queue
 ON resident_owner_access_requests(organization_id,status,requested_at,id);
