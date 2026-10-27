ALTER TABLE resident_product_records
 ADD COLUMN location_verification_status text NOT NULL DEFAULT 'pending'
  CHECK(location_verification_status IN ('pending','verified','rejected')),
 ADD COLUMN location_reviewed_at timestamptz,
 ADD COLUMN location_reviewed_by uuid REFERENCES users(id),
 ADD COLUMN location_review_note text NOT NULL DEFAULT '',
 ADD CONSTRAINT resident_listing_location_review_time
  CHECK((location_verification_status='pending')=(location_reviewed_at IS NULL)),
 ADD CONSTRAINT resident_listing_location_review_actor
  CHECK((location_verification_status='pending')=(location_reviewed_by IS NULL));
