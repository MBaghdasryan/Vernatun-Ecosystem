CREATE TABLE resident_avatars(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES users(id),
 storage_key text NOT NULL UNIQUE,active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX resident_avatar_active ON resident_avatars(user_id) WHERE active;
