-- Permit explicit single-user broadcasts while retaining strict target scope.
DO $$
DECLARE constraint_row record;
BEGIN
 FOR constraint_row IN
  SELECT conname FROM pg_constraint
  WHERE conrelid='platform_notification_batches'::regclass
   AND contype='c'
   AND pg_get_constraintdef(oid) ILIKE '%target_type%'
 LOOP
  EXECUTE format('ALTER TABLE platform_notification_batches DROP CONSTRAINT %I',constraint_row.conname);
 END LOOP;
END $$;

ALTER TABLE platform_notification_batches
 ADD CONSTRAINT platform_notification_batches_target_scope_check CHECK(
  target_type IN('user','organization','building','all')
  AND (
   (target_type='all' AND target_id IS NULL AND organization_id IS NULL AND building_id IS NULL)
   OR (target_type='user' AND target_id IS NOT NULL AND
       ((organization_id IS NULL AND building_id IS NULL) OR (organization_id IS NOT NULL AND building_id IS NOT NULL)))
   OR (target_type='organization' AND target_id=organization_id AND organization_id IS NOT NULL AND building_id IS NULL)
   OR (target_type='building' AND target_id=building_id AND organization_id IS NOT NULL AND building_id IS NOT NULL)
  )
 );

INSERT INTO notification_catalog(code,category,critical)
VALUES('broadcast_notice','community',false)
ON CONFLICT(code) DO NOTHING;
