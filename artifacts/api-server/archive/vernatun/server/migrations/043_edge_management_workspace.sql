-- Additive management metadata; existing v1/v2 identities and history are retained.
ALTER TABLE edge_nodes DROP CONSTRAINT edge_nodes_registration_state_check;
ALTER TABLE edge_nodes ADD CONSTRAINT edge_nodes_registration_state_check
 CHECK (registration_state IN ('REGISTERED','REVOKED','PENDING_REGISTRATION'));
ALTER TABLE edge_nodes ADD COLUMN description text NOT NULL DEFAULT '';
ALTER TABLE edge_nodes ADD COLUMN project_name text NOT NULL DEFAULT '';
ALTER TABLE edge_nodes ADD COLUMN environment text NOT NULL DEFAULT 'unknown'
 CHECK(environment IN ('unknown','test','staging','production'));
ALTER TABLE edge_nodes ADD COLUMN management_config jsonb NOT NULL DEFAULT
 '{"heartbeatSeconds":30,"inventorySeconds":300,"telemetrySeconds":30,"enabledModules":[]}'::jsonb;
ALTER TABLE edge_nodes ADD COLUMN last_inventory_at timestamptz;
ALTER TABLE edge_nodes ADD COLUMN last_telemetry_at timestamptz;
ALTER TABLE edge_nodes ADD COLUMN last_event_at timestamptz;
ALTER TABLE edge_nodes ADD COLUMN last_alarm_at timestamptz;
ALTER TABLE edge_nodes ADD COLUMN last_heartbeat_at timestamptz;

-- Empty packets are still evidence of synchronization; zero alarms is not failure.
CREATE FUNCTION edge_note_sync() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='edge_device_inventory' THEN
  UPDATE edge_nodes SET last_inventory_at=now() WHERE id=NEW.edge_node_id;
 ELSIF TG_TABLE_NAME='edge_events' THEN
  UPDATE edge_nodes SET last_event_at=now() WHERE id=NEW.edge_node_id;
 ELSIF TG_TABLE_NAME='edge_alarms' THEN
  UPDATE edge_nodes SET last_alarm_at=now() WHERE id=NEW.edge_node_id;
 ELSIF TG_TABLE_NAME='edge_telemetry_current' THEN
  UPDATE edge_nodes SET last_telemetry_at=now()
   WHERE id=(SELECT edge_node_id FROM edge_device_inventory WHERE id=NEW.device_inventory_id);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER edge_inventory_sync AFTER INSERT OR UPDATE ON edge_device_inventory
 FOR EACH ROW EXECUTE FUNCTION edge_note_sync();
CREATE TRIGGER edge_events_sync AFTER INSERT ON edge_events
 FOR EACH ROW EXECUTE FUNCTION edge_note_sync();
CREATE TRIGGER edge_alarms_sync AFTER INSERT OR UPDATE ON edge_alarms
 FOR EACH ROW EXECUTE FUNCTION edge_note_sync();
CREATE TRIGGER edge_telemetry_sync AFTER INSERT OR UPDATE ON edge_telemetry_current
 FOR EACH ROW EXECUTE FUNCTION edge_note_sync();

INSERT INTO role_permissions(role_key,permission_key)
 SELECT 'platform_admin',key FROM permissions WHERE key IN
 ('edge.health.read','edge.inventory.read','edge.events.read','edge.alarms.read','edge.config.manage')
 ON CONFLICT DO NOTHING;
-- Credential rotation is a platform security operation, not an organization setting.
DELETE FROM role_permissions WHERE role_key='org_admin'
 AND permission_key IN ('edge.credentials.rotate','edge.credentials.revoke');
