INSERT INTO permissions(key) VALUES('onboarding.manage'),('leases.own'),('organization.settings') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_key,permission_key) VALUES('support','onboarding.manage'),('platform_admin','onboarding.manage'),('unit_owner','leases.own'),('renter','leases.own'),('org_admin','organization.settings') ON CONFLICT DO NOTHING;
ALTER TABLE organizations ADD COLUMN contact_email text NOT NULL DEFAULT '';
ALTER TABLE organizations ADD COLUMN contact_phone text NOT NULL DEFAULT '';
ALTER TABLE organizations ADD COLUMN brand_color text NOT NULL DEFAULT '#FF6B0A';
CREATE TABLE entrances(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL,building_id uuid NOT NULL,name text NOT NULL,FOREIGN KEY(building_id,organization_id) REFERENCES buildings(id,organization_id),UNIQUE(id,building_id,organization_id));
CREATE TABLE floors(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL,building_id uuid NOT NULL,entrance_id uuid NOT NULL,number integer NOT NULL,FOREIGN KEY(entrance_id,building_id,organization_id) REFERENCES entrances(id,building_id,organization_id),UNIQUE(id,building_id,organization_id));
