-- Live camera media is a separate, on-demand plane from Edge telemetry.
-- Edge must explicitly advertise this protocol; existing telemetry alone does
-- not make a camera stream-capable.
ALTER TABLE edge_nodes
 ADD COLUMN media_protocol_version smallint NOT NULL DEFAULT 0
   CHECK(media_protocol_version>=0),
 ADD COLUMN media_capabilities jsonb NOT NULL DEFAULT '{}'::jsonb
   CHECK(jsonb_typeof(media_capabilities)='object'),
 ADD COLUMN media_capabilities_at timestamptz;

CREATE TABLE edge_camera_media_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL,
 building_id uuid NOT NULL,
 edge_node_id uuid NOT NULL,
 camera_id uuid NOT NULL,
 room_name text NOT NULL UNIQUE,
 edge_participant_identity text NOT NULL UNIQUE,
 state text NOT NULL DEFAULT 'STARTING'
   CHECK(state IN ('STARTING','ACTIVE','FAILED','STOPPING','ENDED')),
 started_by_user_id uuid NOT NULL REFERENCES users(id),
 failure_code text,
 created_at timestamptz NOT NULL DEFAULT now(),
 started_at timestamptz,
 last_activity_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 ended_at timestamptz,
 UNIQUE(id,organization_id,building_id),
 FOREIGN KEY(edge_node_id,organization_id,building_id)
   REFERENCES edge_nodes(id,organization_id,building_id) ON DELETE CASCADE,
 FOREIGN KEY(camera_id,edge_node_id,organization_id,building_id)
   REFERENCES edge_device_inventory(id,edge_node_id,organization_id,building_id) ON DELETE CASCADE,
 CHECK(expires_at<=created_at+interval '4 hours')
);
CREATE UNIQUE INDEX edge_camera_media_one_active_per_camera
 ON edge_camera_media_sessions(camera_id)
 WHERE state IN ('STARTING','ACTIVE','STOPPING');
CREATE INDEX edge_camera_media_expiry
 ON edge_camera_media_sessions(expires_at)
 WHERE state IN ('STARTING','ACTIVE','STOPPING');

CREATE TABLE edge_camera_media_viewers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 session_id uuid NOT NULL,
 organization_id uuid NOT NULL,
 building_id uuid NOT NULL,
 user_id uuid NOT NULL REFERENCES users(id),
 participant_identity text NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(),
 last_activity_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 ended_at timestamptz,
 FOREIGN KEY(session_id,organization_id,building_id)
   REFERENCES edge_camera_media_sessions(id,organization_id,building_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX edge_camera_media_one_viewer_per_user
 ON edge_camera_media_viewers(session_id,user_id) WHERE ended_at IS NULL;
CREATE INDEX edge_camera_media_viewers_expiry
 ON edge_camera_media_viewers(expires_at) WHERE ended_at IS NULL;

INSERT INTO permissions(key)
 VALUES('device.camera.live_view')
 ON CONFLICT DO NOTHING;
-- Residents, contractors, and platform-only roles receive no default camera
-- access. A separately reviewed per-user grant can opt in with normal scope
-- checks; company staff roles below receive the normal building-scoped access.
INSERT INTO role_permissions(role_key,permission_key)
 VALUES
   ('org_admin','device.camera.live_view'),
   ('manager','device.camera.live_view'),
   ('security','device.camera.live_view')
 ON CONFLICT DO NOTHING;
