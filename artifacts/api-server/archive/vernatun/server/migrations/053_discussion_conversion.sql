-- Discussions keep their own provenance without inventing an apartment or resident.
ALTER TABLE resident_requests ADD COLUMN source_discussion_id uuid UNIQUE REFERENCES resident_product_records(id);
DO $$
DECLARE constraint_name text;
BEGIN
 SELECT conname INTO STRICT constraint_name FROM pg_constraint
 WHERE conrelid='resident_requests'::regclass AND contype='c'
 AND pg_get_constraintdef(oid) LIKE '%unit_id IS NOT NULL%asset_id IS NOT NULL%';
 EXECUTE format('ALTER TABLE resident_requests DROP CONSTRAINT %I',constraint_name);
END $$;
ALTER TABLE resident_requests ADD CONSTRAINT common_request_provenance CHECK(
 unit_id IS NOT NULL OR (source='system' AND building_id IS NOT NULL
 AND (asset_id IS NOT NULL OR source_discussion_id IS NOT NULL)));
ALTER TABLE agenda_items ADD COLUMN source_discussion_id uuid UNIQUE REFERENCES resident_product_records(id);
