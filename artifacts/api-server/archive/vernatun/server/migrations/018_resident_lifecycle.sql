ALTER TABLE leases ADD COLUMN cancelled_at timestamptz;
ALTER TABLE leases ADD COLUMN cancelled_by uuid REFERENCES users(id);
ALTER TABLE leases ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE leases ADD COLUMN cancellation_reason text;
CREATE INDEX lease_access_lookup ON leases(organization_id,unit_id,renter_id,starts_on,ends_on);
ALTER TABLE resident_delegations ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE resident_delegations ADD COLUMN contact_phone text;
