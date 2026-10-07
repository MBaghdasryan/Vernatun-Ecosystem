CREATE TABLE system_log_retention(
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 enabled boolean NOT NULL DEFAULT false,
 days integer NOT NULL DEFAULT 30 CHECK(days BETWEEN 7 AND 3650),
 revision integer NOT NULL DEFAULT 0,
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid REFERENCES users(id)
);
INSERT INTO system_log_retention(id) VALUES(true);
