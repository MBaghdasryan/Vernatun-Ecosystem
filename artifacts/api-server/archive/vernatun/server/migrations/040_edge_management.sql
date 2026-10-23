-- Vernatun Cloud Edge v1. Credentials are hash-only; tenant and building binding
-- is constrained by the existing composite organization/building relationship.
CREATE TABLE edge_nodes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 edge_id text NOT NULL UNIQUE CHECK(edge_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$'),
 organization_id uuid NOT NULL REFERENCES organizations(id),
 building_id uuid NOT NULL,
 name text NOT NULL,
 site_code text NOT NULL CHECK(length(site_code)<=100),
 status text NOT NULL DEFAULT 'UNKNOWN' CHECK(status IN ('ONLINE','DEGRADED','OFFLINE','UNKNOWN','DISABLED')),
 registration_state text NOT NULL DEFAULT 'REGISTERED' CHECK(registration_state IN ('REGISTERED','REVOKED')),
 agent_version text,
 platform text,
 connection_mode text NOT NULL DEFAULT 'OUTBOUND' CHECK(connection_mode='OUTBOUND'),
 transports text[] NOT NULL DEFAULT ARRAY['WEBSOCKET','HTTPS']::text[],
 capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
 local_authorization_status text NOT NULL DEFAULT 'UNKNOWN',
 queue_depth integer NOT NULL DEFAULT 0 CHECK(queue_depth>=0),
 registered_at timestamptz NOT NULL DEFAULT now(),
 last_seen_at timestamptz,
 last_connected_at timestamptz,
 last_disconnected_at timestamptz,
 credential_version integer NOT NULL DEFAULT 1,
 config_version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(building_id,organization_id) REFERENCES buildings(id,organization_id),
 UNIQUE(building_id),
 UNIQUE(id,organization_id,building_id)
);
CREATE INDEX edge_nodes_scope_status ON edge_nodes(organization_id,building_id,status);
CREATE TABLE edge_bootstrap_tokens (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 edge_id text NOT NULL,
 organization_id uuid NOT NULL REFERENCES organizations(id),
 building_id uuid NOT NULL,
 edge_name text NOT NULL,
 site_code text NOT NULL,
 token_hash text NOT NULL UNIQUE,
 expires_at timestamptz NOT NULL,
 used_at timestamptz,
 revoked_at timestamptz,
 created_by_user_id uuid NOT NULL REFERENCES users(id),
 used_by_edge_node_id uuid REFERENCES edge_nodes(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(building_id,organization_id) REFERENCES buildings(id,organization_id),
 CHECK(expires_at<=created_at+interval '2 hours')
);
CREATE UNIQUE INDEX edge_bootstrap_one_unused ON edge_bootstrap_tokens(edge_id)
 WHERE used_at IS NULL AND revoked_at IS NULL;
CREATE INDEX edge_bootstrap_scope ON edge_bootstrap_tokens(organization_id,building_id,created_at DESC);
CREATE TABLE edge_credentials (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 edge_node_id uuid NOT NULL REFERENCES edge_nodes(id),
 credential_type text NOT NULL DEFAULT 'bearer' CHECK(credential_type IN ('bearer','mtls')),
 credential_hash text NOT NULL UNIQUE,
 version integer NOT NULL,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','pending','revoked','expired')),
 issued_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz,
 rotated_at timestamptz,
 revoked_at timestamptz,
 created_by_user_id uuid REFERENCES users(id),
 UNIQUE(edge_node_id,version)
);
CREATE INDEX edge_credentials_active ON edge_credentials(edge_node_id,status);
CREATE TABLE edge_device_inventory (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 edge_node_id uuid NOT NULL,
 organization_id uuid NOT NULL,
 building_id uuid NOT NULL,
 edge_device_id text NOT NULL,
 thingsboard_id text,
 name text NOT NULL,
 profile text NOT NULL DEFAULT 'Unknown',
 device_type text NOT NULL DEFAULT 'unknown',
 label text,
 zone_id uuid,
 floor_id uuid,
 room_id uuid,
 unit_id uuid,
 capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
 reported_online boolean,
 last_seen_at timestamptz NOT NULL DEFAULT now(),
 last_telemetry_at timestamptz,
 metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(edge_node_id,organization_id,building_id) REFERENCES edge_nodes(id,organization_id,building_id),
 FOREIGN KEY(unit_id,building_id,organization_id) REFERENCES units(id,building_id,organization_id),
 UNIQUE(id,organization_id,building_id),
 UNIQUE(edge_node_id,edge_device_id),
 UNIQUE(id,edge_node_id,organization_id,building_id)
);
CREATE INDEX edge_device_scope ON edge_device_inventory(organization_id,building_id,device_type);
CREATE TABLE edge_device_access (
 device_id uuid NOT NULL,
 organization_id uuid NOT NULL,
 building_id uuid NOT NULL,
 unit_id uuid NOT NULL,
 allowed_capabilities text[] NOT NULL DEFAULT ARRAY['BARRIER.OPEN']::text[],
 created_by_user_id uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(device_id,organization_id,building_id) REFERENCES edge_device_inventory(id,organization_id,building_id) ON DELETE CASCADE,
 FOREIGN KEY(unit_id,building_id,organization_id) REFERENCES units(id,building_id,organization_id),
 PRIMARY KEY(device_id,unit_id)
);
CREATE TABLE edge_commands (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 command_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 idempotency_key text NOT NULL,
 request_hash text NOT NULL,
 edge_node_id uuid NOT NULL,
 device_inventory_id uuid NOT NULL,
 organization_id uuid NOT NULL,
 building_id uuid NOT NULL,
 edge_device_id text NOT NULL,
 capability text NOT NULL,
 requested_by_user_id uuid REFERENCES users(id),
 requested_role_assignment_id uuid,
 requested_role text,
 source_product text NOT NULL,
 reason text NOT NULL,
 status text NOT NULL CHECK(status IN ('REQUESTED','AUTHORIZED','DENIED','QUEUED','DELIVERED','ACKNOWLEDGED','SUCCESS','FAILED','TIMEOUT','CANCELLED')),
 authorization_decision text NOT NULL CHECK(authorization_decision IN ('ALLOW','DENY')),
 authorization_reason text NOT NULL,
 actor_claim jsonb NOT NULL DEFAULT '{}'::jsonb,
 source_context jsonb NOT NULL DEFAULT '{}'::jsonb,
 requested_at timestamptz NOT NULL DEFAULT now(),
 queued_at timestamptz,
 delivered_at timestamptz,
 acknowledged_at timestamptz,
 completed_at timestamptz,
 failed_at timestamptz,
 expires_at timestamptz NOT NULL,
 result_json jsonb,
 error_code text,
 error_message text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(edge_node_id,organization_id,building_id) REFERENCES edge_nodes(id,organization_id,building_id),
 FOREIGN KEY(device_inventory_id,edge_node_id,organization_id,building_id) REFERENCES edge_device_inventory(id,edge_node_id,organization_id,building_id),
 UNIQUE(requested_by_user_id,idempotency_key)
);
CREATE INDEX edge_commands_scope_recent ON edge_commands(organization_id,building_id,requested_at DESC);
CREATE INDEX edge_commands_edge_pending ON edge_commands(edge_node_id,status,expires_at);
CREATE TABLE edge_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 edge_node_id uuid NOT NULL,
 device_inventory_id uuid,
 organization_id uuid NOT NULL,
 building_id uuid NOT NULL,
 external_event_id text,
 event_type text NOT NULL,
 severity text NOT NULL DEFAULT 'info',
 source_timestamp timestamptz,
 received_at timestamptz NOT NULL DEFAULT now(),
 payload jsonb NOT NULL DEFAULT '{}'::jsonb,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '90 days',
 FOREIGN KEY(edge_node_id,organization_id,building_id) REFERENCES edge_nodes(id,organization_id,building_id),
 FOREIGN KEY(device_inventory_id,edge_node_id,organization_id,building_id) REFERENCES edge_device_inventory(id,edge_node_id,organization_id,building_id)
);
CREATE UNIQUE INDEX edge_events_external_unique ON edge_events(edge_node_id,external_event_id) WHERE external_event_id IS NOT NULL;
CREATE INDEX edge_events_scope_recent ON edge_events(organization_id,building_id,received_at DESC);
CREATE TABLE edge_alarms (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 edge_node_id uuid NOT NULL,
 device_inventory_id uuid,
 organization_id uuid NOT NULL,
 building_id uuid NOT NULL,
 external_alarm_id text NOT NULL,
 alarm_type text NOT NULL,
 severity text NOT NULL CHECK(severity IN ('info','warning','critical','emergency')),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','acknowledged','resolved')),
 source_timestamp timestamptz,
 received_at timestamptz NOT NULL DEFAULT now(),
 acknowledged_at timestamptz,
 resolved_at timestamptz,
 payload jsonb NOT NULL DEFAULT '{}'::jsonb,
 FOREIGN KEY(edge_node_id,organization_id,building_id) REFERENCES edge_nodes(id,organization_id,building_id),
 FOREIGN KEY(device_inventory_id,edge_node_id,organization_id,building_id) REFERENCES edge_device_inventory(id,edge_node_id,organization_id,building_id),
 UNIQUE(edge_node_id,external_alarm_id)
);
CREATE INDEX edge_alarms_scope_status ON edge_alarms(organization_id,building_id,status,severity,received_at DESC);
-- Keep only the latest telemetry value per device/key; high-frequency raw points
-- are not accumulated in PostgreSQL.
CREATE TABLE edge_telemetry_current (
 device_inventory_id uuid NOT NULL REFERENCES edge_device_inventory(id) ON DELETE CASCADE,
 telemetry_key text NOT NULL,
 value jsonb NOT NULL,
 source_timestamp timestamptz,
 received_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(device_inventory_id,telemetry_key)
);

INSERT INTO permissions(key) VALUES
 ('edge.fleet.read'),('edge.read'),('edge.health.read'),('edge.inventory.read'),('edge.manage'),('edge.bootstrap.create'),
 ('edge.credentials.rotate'),('edge.credentials.revoke'),('edge.config.manage'),('edge.events.read'),('edge.alarms.read'),
  ('edge.commands.read'),('edge.commands.audit'),('device.read'),('device.read.own'),('device.health.read'),('device.barrier.open.own'),
 ('device.barrier.open.building'),('device.barrier.close.building')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_key,permission_key)
SELECT r.role_key,r.permission_key FROM (VALUES
 ('platform_admin','edge.fleet.read'),('platform_admin','edge.read'),('platform_admin','edge.manage'),('platform_admin','edge.bootstrap.create'),
 ('platform_admin','edge.credentials.rotate'),('platform_admin','edge.credentials.revoke'),('platform_admin','edge.commands.read'),('platform_admin','edge.commands.audit'),
  ('support','edge.read'),('support','edge.alarms.read'),('support','edge.events.read'),
 ('org_admin','edge.read'),('org_admin','edge.manage'),('org_admin','edge.bootstrap.create'),('org_admin','edge.credentials.rotate'),('org_admin','edge.credentials.revoke'),('org_admin','edge.config.manage'),('org_admin','edge.commands.read'),('org_admin','edge.commands.audit'),('org_admin','edge.alarms.read'),('org_admin','edge.events.read'),('org_admin','edge.inventory.read'),
  ('portfolio_owner','edge.read'),('portfolio_owner','edge.inventory.read'),('portfolio_owner','edge.alarms.read'),('portfolio_owner','edge.events.read'),
  ('developer','edge.read'),('developer','edge.inventory.read'),('developer','edge.alarms.read'),('developer','edge.events.read'),('developer','device.read'),
 ('accountant','edge.inventory.read'),('accountant','device.read'),
  ('manager','edge.read'),('manager','edge.inventory.read'),('manager','edge.alarms.read'),('manager','edge.events.read'),('manager','edge.commands.read'),('manager','device.read'),('manager','device.barrier.close.building'),
  ('dispatcher','edge.read'),('dispatcher','edge.inventory.read'),('dispatcher','edge.alarms.read'),('dispatcher','edge.events.read'),('dispatcher','edge.commands.read'),('dispatcher','device.read'),
 ('technician','edge.health.read'),('technician','device.read'),('contractor','device.read'),
  ('security','edge.read'),('security','edge.inventory.read'),('security','edge.alarms.read'),('security','edge.events.read'),('security','edge.commands.read'),('security','device.read'),('security','device.barrier.close.building'),
  ('unit_owner','device.read'),('unit_owner','device.read.own'),('unit_owner','device.barrier.open.own'),
  ('renter','device.read'),('renter','device.read.own'),('renter','device.barrier.open.own'),
  ('family','device.read'),('family','device.read.own')
) AS r(role_key,permission_key)
JOIN roles ON roles.key=r.role_key JOIN permissions p ON p.key=r.permission_key
ON CONFLICT DO NOTHING;
INSERT INTO module_entitlements(organization_id,module,enabled)
SELECT id,'smart_building',false FROM organizations ON CONFLICT DO NOTHING;
CREATE FUNCTION initialize_smart_building_entitlement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO module_entitlements(organization_id,module,enabled) VALUES(NEW.id,'smart_building',false)
 ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
CREATE TRIGGER organizations_smart_building_entitlement AFTER INSERT ON organizations
 FOR EACH ROW EXECUTE FUNCTION initialize_smart_building_entitlement();
