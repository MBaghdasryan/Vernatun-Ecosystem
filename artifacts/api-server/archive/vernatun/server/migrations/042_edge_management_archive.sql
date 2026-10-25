ALTER TABLE edge_blocks
  ADD COLUMN archived_at timestamptz;

ALTER TABLE edge_nodes
  ADD COLUMN archived_at timestamptz;

CREATE INDEX edge_blocks_active_org_idx
  ON edge_blocks (organization_id, name)
  WHERE archived_at IS NULL;

CREATE INDEX edge_nodes_active_scope_idx
  ON edge_nodes (organization_id, block_id, last_seen_at DESC)
  WHERE archived_at IS NULL;
