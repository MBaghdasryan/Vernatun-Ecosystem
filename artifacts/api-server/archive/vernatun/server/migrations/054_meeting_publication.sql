-- Cancellation does not prove that a draft was ever published.
ALTER TABLE meetings ADD COLUMN was_published boolean NOT NULL DEFAULT false;
-- Restore historical evidence without inventing a publication timestamp.
UPDATE meetings m SET was_published=(
 m.status IN('published','finalized') OR EXISTS(
  SELECT 1 FROM audit_events a WHERE a.entity_type='meeting'
  AND a.entity_id=m.id::text AND a.action='meeting.publish'
 ) OR EXISTS(SELECT 1 FROM meeting_eligibility e WHERE e.meeting_id=m.id)
) WHERE m.mode='weighted';
