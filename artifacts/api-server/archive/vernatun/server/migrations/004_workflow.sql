ALTER TABLE resident_requests ADD COLUMN description text NOT NULL DEFAULT '';
ALTER TABLE resident_requests ADD COLUMN version integer NOT NULL DEFAULT 1;
CREATE TABLE work_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL UNIQUE REFERENCES resident_requests(id),
 technician_id uuid NOT NULL REFERENCES users(id),
 assigned_by uuid NOT NULL REFERENCES users(id),
 status text NOT NULL CHECK(status IN ('assigned','in_progress','review','resident_review','closed')) DEFAULT 'assigned',
 checklist jsonb NOT NULL DEFAULT '[]',
 report text NOT NULL DEFAULT '',
 version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE request_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL REFERENCES resident_requests(id),
 actor_id uuid NOT NULL REFERENCES users(id),
 actor_role text NOT NULL,
 action text NOT NULL,
 from_status text,
 to_status text NOT NULL,
 note text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX request_history_request ON request_history(request_id,created_at);
CREATE TABLE request_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id uuid NOT NULL REFERENCES resident_requests(id),
 author_id uuid NOT NULL REFERENCES users(id), body text NOT NULL, internal boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE request_photos (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id uuid NOT NULL REFERENCES resident_requests(id),
 author_id uuid NOT NULL REFERENCES users(id), storage_key text NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now()
);
