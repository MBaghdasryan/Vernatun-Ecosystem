-- Edge v2 adds block-scoped agents while preserving each existing v1 agent's
-- single-building scope. A block can contain many buildings and can have
-- multiple independently credentialed Edge nodes.
CREATE TABLE edge_blocks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id),
 code text NOT NULL CHECK(code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'),
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 2 AND 120),
 created_by_user_id uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,organization_id),
 UNIQUE(organization_id,code)
);
CREATE TABLE edge_block_buildings (
 block_id uuid NOT NULL,
 organization_id uuid NOT NULL,
 building_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(block_id,organization_id,building_id),
 UNIQUE(organization_id,building_id),
 FOREIGN KEY(block_id,organization_id) REFERENCES edge_blocks(id,organization_id) ON DELETE CASCADE,
 FOREIGN KEY(building_id,organization_id) REFERENCES buildings(id,organization_id) ON DELETE RESTRICT
);
CREATE INDEX edge_block_buildings_building ON edge_block_buildings(organization_id,building_id);

ALTER TABLE edge_nodes ADD COLUMN protocol_version smallint NOT NULL DEFAULT 1;
ALTER TABLE edge_nodes ADD COLUMN block_id uuid;
ALTER TABLE edge_nodes ALTER COLUMN building_id DROP NOT NULL;
ALTER TABLE edge_nodes DROP CONSTRAINT IF EXISTS edge_nodes_building_id_key;
ALTER TABLE edge_nodes ADD CONSTRAINT edge_nodes_block_fk
 FOREIGN KEY(block_id,organization_id) REFERENCES edge_blocks(id,organization_id);
ALTER TABLE edge_nodes ADD CONSTRAINT edge_nodes_protocol_scope_check CHECK(
 (protocol_version=1 AND building_id IS NOT NULL AND block_id IS NULL) OR
 (protocol_version=2 AND building_id IS NULL AND block_id IS NOT NULL)
);
ALTER TABLE edge_nodes ADD CONSTRAINT edge_nodes_id_organization_unique UNIQUE(id,organization_id);

ALTER TABLE edge_bootstrap_tokens ADD COLUMN protocol_version smallint NOT NULL DEFAULT 1;
ALTER TABLE edge_bootstrap_tokens ADD COLUMN block_id uuid;
ALTER TABLE edge_bootstrap_tokens ALTER COLUMN building_id DROP NOT NULL;
ALTER TABLE edge_bootstrap_tokens ADD CONSTRAINT edge_bootstrap_tokens_block_fk
 FOREIGN KEY(block_id,organization_id) REFERENCES edge_blocks(id,organization_id);
ALTER TABLE edge_bootstrap_tokens ADD CONSTRAINT edge_bootstrap_tokens_protocol_scope_check CHECK(
 (protocol_version=1 AND building_id IS NOT NULL AND block_id IS NULL) OR
 (protocol_version=2 AND building_id IS NULL AND block_id IS NOT NULL)
);

CREATE TABLE edge_node_buildings (
 edge_node_id uuid NOT NULL,
 organization_id uuid NOT NULL,
 building_id uuid NOT NULL,
 block_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(edge_node_id,organization_id,building_id),
 FOREIGN KEY(edge_node_id,organization_id) REFERENCES edge_nodes(id,organization_id) ON DELETE CASCADE,
 FOREIGN KEY(building_id,organization_id) REFERENCES buildings(id,organization_id),
 FOREIGN KEY(block_id,organization_id,building_id)
  REFERENCES edge_block_buildings(block_id,organization_id,building_id)
);
CREATE INDEX edge_node_buildings_building ON edge_node_buildings(organization_id,building_id);
INSERT INTO edge_node_buildings(edge_node_id,organization_id,building_id)
 SELECT id,organization_id,building_id FROM edge_nodes WHERE protocol_version=1;

CREATE FUNCTION enforce_edge_node_building_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE node edge_nodes%ROWTYPE;
BEGIN
 SELECT * INTO node FROM edge_nodes WHERE id=NEW.edge_node_id;
 IF NOT FOUND OR node.organization_id<>NEW.organization_id THEN
  RAISE EXCEPTION 'edge node building organization mismatch' USING ERRCODE='23514';
 END IF;
 IF node.protocol_version=1 THEN
  IF NEW.block_id IS NOT NULL OR node.building_id<>NEW.building_id THEN
   RAISE EXCEPTION 'v1 edge node is bound to one building' USING ERRCODE='23514';
  END IF;
 ELSIF node.protocol_version=2 THEN
  IF NEW.block_id IS NULL OR node.block_id<>NEW.block_id THEN
   RAISE EXCEPTION 'v2 edge node block mismatch' USING ERRCODE='23514';
  END IF;
 ELSE
  RAISE EXCEPTION 'unsupported edge protocol version' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER edge_node_buildings_scope_guard BEFORE INSERT OR UPDATE ON edge_node_buildings
 FOR EACH ROW EXECUTE FUNCTION enforce_edge_node_building_scope();

-- All device and event rows must be tied to a building explicitly granted to
-- the authenticated Edge node, regardless of protocol version.
DO $$
DECLARE item record;
BEGIN
 FOR item IN
  SELECT conrelid::regclass AS relation,conname
  FROM pg_constraint
  WHERE contype='f' AND confrelid='edge_nodes'::regclass
   AND conrelid IN ('edge_device_inventory'::regclass,'edge_commands'::regclass,
                    'edge_events'::regclass,'edge_alarms'::regclass)
 LOOP
  EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',item.relation,item.conname);
 END LOOP;
END $$;
ALTER TABLE edge_device_inventory ADD CONSTRAINT edge_device_inventory_node_building_fk
 FOREIGN KEY(edge_node_id,organization_id,building_id)
 REFERENCES edge_node_buildings(edge_node_id,organization_id,building_id);
ALTER TABLE edge_commands ADD CONSTRAINT edge_commands_node_building_fk
 FOREIGN KEY(edge_node_id,organization_id,building_id)
 REFERENCES edge_node_buildings(edge_node_id,organization_id,building_id);
ALTER TABLE edge_events ADD CONSTRAINT edge_events_node_building_fk
 FOREIGN KEY(edge_node_id,organization_id,building_id)
 REFERENCES edge_node_buildings(edge_node_id,organization_id,building_id);
ALTER TABLE edge_alarms ADD CONSTRAINT edge_alarms_node_building_fk
 FOREIGN KEY(edge_node_id,organization_id,building_id)
 REFERENCES edge_node_buildings(edge_node_id,organization_id,building_id);

ALTER TABLE edge_device_inventory
 DROP CONSTRAINT IF EXISTS edge_device_inventory_edge_node_id_edge_device_id_key;
ALTER TABLE edge_device_inventory ADD CONSTRAINT edge_device_inventory_node_building_device_unique
 UNIQUE(edge_node_id,building_id,edge_device_id);

DROP INDEX IF EXISTS edge_events_external_unique;
CREATE UNIQUE INDEX edge_events_external_unique
 ON edge_events(edge_node_id,building_id,external_event_id) WHERE external_event_id IS NOT NULL;
ALTER TABLE edge_alarms
 DROP CONSTRAINT IF EXISTS edge_alarms_edge_node_id_external_alarm_id_key;
ALTER TABLE edge_alarms ADD CONSTRAINT edge_alarms_node_building_alarm_unique
 UNIQUE(edge_node_id,building_id,external_alarm_id);
