CREATE TABLE resident_listing_photos (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 listing_id uuid NOT NULL REFERENCES resident_product_records(id),
 storage_key text NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX resident_listing_photos_listing_idx ON resident_listing_photos(listing_id,created_at,id);
