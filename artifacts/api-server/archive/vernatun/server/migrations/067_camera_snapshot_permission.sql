INSERT INTO permissions(key)
 VALUES('device.camera.snapshot')
 ON CONFLICT DO NOTHING;

-- Camera bytes are private, on-demand captures. Residents receive no default
-- snapshot access; platform admins can grant it through the normal scoped IAM.
INSERT INTO role_permissions(role_key,permission_key)
 VALUES
   ('org_admin','device.camera.snapshot'),
   ('manager','device.camera.snapshot'),
   ('security','device.camera.snapshot')
 ON CONFLICT DO NOTHING;
