ALTER TABLE organizations
 ADD COLUMN company_type text NOT NULL DEFAULT 'management_company'
 CHECK(company_type IN ('developer','management_company'));

CREATE INDEX organizations_created_at_desc ON organizations(created_at DESC,id DESC);
