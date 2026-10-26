-- Inventory discovery is not evidence that an individual device is online.
-- Allow the device last-seen marker to remain unset until telemetry or an
-- event/alarm is actually received.
ALTER TABLE edge_device_inventory
  ALTER COLUMN last_seen_at DROP NOT NULL;
