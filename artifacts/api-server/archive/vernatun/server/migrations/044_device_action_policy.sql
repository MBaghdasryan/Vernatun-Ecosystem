ALTER TABLE edge_device_inventory
 ADD COLUMN IF NOT EXISTS enabled_capabilities text[] NOT NULL DEFAULT ARRAY[]::text[];

-- Only the already verified Barrier adapter is enabled by default. Future
-- profiles remain disabled until their Edge adapter has been tested.
UPDATE edge_device_inventory
 SET enabled_capabilities=ARRAY['BARRIER.OPEN','BARRIER.CLOSE']::text[]
 WHERE profile='Vernatun Barrier'
   AND capabilities @> '["BARRIER.OPEN","BARRIER.CLOSE"]'::jsonb
   AND cardinality(enabled_capabilities)=0;

INSERT INTO permissions(key) VALUES
 ('edge.commands.execute')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions(role_key,permission_key)
SELECT r.role_key,r.permission_key
FROM (VALUES
 ('platform_admin','edge.config.manage'),
 ('org_admin','edge.commands.execute'),('org_admin','device.read'),
 ('org_admin','device.barrier.open.building'),('org_admin','device.barrier.close.building'),
 ('manager','edge.commands.execute'),('manager','device.barrier.open.building'),('manager','device.barrier.close.building'),
 ('dispatcher','edge.commands.execute'),('dispatcher','device.barrier.open.building'),('dispatcher','device.barrier.close.building'),
 ('security','edge.commands.execute'),('security','device.barrier.open.building'),('security','device.barrier.close.building')
) AS r(role_key,permission_key)
JOIN roles ON roles.key=r.role_key
JOIN permissions p ON p.key=r.permission_key
ON CONFLICT DO NOTHING;
