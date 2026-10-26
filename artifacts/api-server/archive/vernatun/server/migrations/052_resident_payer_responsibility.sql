CREATE TABLE resident_payer_policy(
 building_id uuid NOT NULL REFERENCES buildings(id),service_id uuid NOT NULL REFERENCES services(id),
 organization_id uuid NOT NULL REFERENCES organizations(id),enabled boolean NOT NULL DEFAULT false,
 version integer NOT NULL DEFAULT 0 CHECK(version>=0),PRIMARY KEY(building_id,service_id)
);
CREATE TABLE resident_payer_delegations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES organizations(id),
 unit_id uuid NOT NULL REFERENCES units(id),payer_assignment_id uuid NOT NULL REFERENCES payer_assignments(id),
 owner_assignment_id uuid NOT NULL REFERENCES role_assignments(id),owner_user_id uuid NOT NULL REFERENCES users(id),
 recipient_id uuid NOT NULL REFERENCES users(id),starts_on date NOT NULL,ends_on date,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','accepted','declined','revoked')),
 version integer NOT NULL DEFAULT 1,client_id uuid NOT NULL,request jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),accepted_at timestamptz,closed_at timestamptz,
 CHECK(owner_user_id<>recipient_id),CHECK(extract(day FROM starts_on)=1),
 CHECK(ends_on IS NULL OR (extract(day FROM ends_on)=1 AND ends_on>=starts_on)),
 UNIQUE(owner_user_id,client_id)
);
CREATE INDEX resident_payer_delegations_rule ON resident_payer_delegations(payer_assignment_id,status,starts_on);
ALTER TABLE charges ADD COLUMN payer_delegation_id uuid REFERENCES resident_payer_delegations(id);

-- Membership, occupancy, delegation and lease are live proofs, not a snapshot
-- supplied by the browser. Legacy renters retain the existing lease policy.
CREATE FUNCTION resident_payer_recipient_valid(org uuid,unit uuid,person uuid,period date)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(
 SELECT 1 FROM role_assignments a JOIN users u ON u.id=a.user_id
 JOIN memberships m ON m.user_id=a.user_id AND m.organization_id=a.organization_id
 JOIN organizations o ON o.id=a.organization_id
 WHERE a.organization_id=org AND a.unit_id=unit AND a.user_id=person
 AND a.role_key IN('renter','family') AND a.active AND m.active AND NOT u.blocked
 AND a.starts_at<=now() AND (a.starts_at AT TIME ZONE o.timezone)::date<=period
 AND (a.expires_at IS NULL OR(a.expires_at>now() AND (a.expires_at AT TIME ZONE o.timezone)::date>period))
 AND (a.role_key<>'renter' OR NOT EXISTS(SELECT 1 FROM leases l WHERE l.organization_id=org AND l.unit_id=unit AND l.renter_id=person)
 OR (
 EXISTS(SELECT 1 FROM leases l WHERE l.organization_id=org AND l.unit_id=unit AND l.renter_id=person AND l.cancelled_at IS NULL
 AND l.starts_on<=(now() AT TIME ZONE o.timezone)::date AND l.ends_on>=(now() AT TIME ZONE o.timezone)::date)
 AND EXISTS(SELECT 1 FROM leases l WHERE l.organization_id=org AND l.unit_id=unit AND l.renter_id=person AND l.cancelled_at IS NULL
 AND l.starts_on<=period AND l.ends_on>=period)))
 AND NOT EXISTS(
 SELECT 1 FROM resident_delegations d LEFT JOIN role_assignments parent ON parent.id=d.owner_assignment_id
 LEFT JOIN users pu ON pu.id=parent.user_id
 LEFT JOIN memberships pm ON pm.user_id=parent.user_id AND pm.organization_id=org
 WHERE d.assignment_id=a.id AND(
 d.revoked_at IS NOT NULL OR d.expires_at<=now() OR (d.expires_at AT TIME ZONE o.timezone)::date<=period
 OR NOT ('properties.own'=ANY(d.permission_keys))
 OR parent.id IS NULL OR NOT parent.active OR parent.role_key<>'unit_owner'
 OR parent.organization_id<>org OR parent.unit_id<>unit OR parent.starts_at>now()
 OR(parent.expires_at IS NOT NULL AND(parent.expires_at<=now() OR(parent.expires_at AT TIME ZONE o.timezone)::date<=period))
 OR COALESCE(pu.blocked,true) OR NOT COALESCE(pm.active,false)))
 );
$$;
CREATE FUNCTION resident_effective_delegation(assignment uuid,period date)
RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT d.id FROM payer_assignments p JOIN units un ON un.id=p.unit_id
 JOIN resident_payer_delegations d ON d.payer_assignment_id=p.id
 JOIN resident_payer_policy pol ON pol.building_id=un.building_id AND pol.service_id=p.service_id AND pol.organization_id=p.organization_id AND pol.enabled
 JOIN role_assignments a ON a.id=d.owner_assignment_id
 JOIN users u ON u.id=a.user_id JOIN memberships m ON m.user_id=u.id AND m.organization_id=p.organization_id
 JOIN organizations o ON o.id=p.organization_id
 WHERE p.id=assignment AND d.status='accepted' AND d.organization_id=p.organization_id AND d.unit_id=p.unit_id
 AND p.payer_user_id=d.owner_user_id AND a.user_id=d.owner_user_id AND a.unit_id=p.unit_id
 AND a.organization_id=p.organization_id AND a.role_key='unit_owner' AND a.active AND m.active AND NOT u.blocked
 AND a.starts_at<=now() AND(a.starts_at AT TIME ZONE o.timezone)::date<=period
 AND(a.expires_at IS NULL OR(a.expires_at>now() AND(a.expires_at AT TIME ZONE o.timezone)::date>period))
 AND d.starts_on<=period AND(d.ends_on IS NULL OR d.ends_on>=period)
 AND resident_payer_recipient_valid(p.organization_id,p.unit_id,d.recipient_id,period)
 ORDER BY d.created_at,d.id LIMIT 1;
$$;
CREATE FUNCTION resident_effective_payer(assignment uuid,period date)
RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT COALESCE(d.recipient_id,p.payer_user_id) FROM payer_assignments p
 LEFT JOIN resident_payer_delegations d ON d.id=resident_effective_delegation(p.id,period) WHERE p.id=assignment;
$$;
