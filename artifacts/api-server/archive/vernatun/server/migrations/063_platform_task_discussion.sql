CREATE TABLE platform_task_comments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 task_id uuid NOT NULL REFERENCES platform_tasks(id) ON DELETE CASCADE,
 author_user_id uuid NOT NULL REFERENCES users(id),
 content text NOT NULL CHECK(length(content) BETWEEN 1 AND 4000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX platform_task_comments_chronology_idx
 ON platform_task_comments(task_id,created_at,id);

CREATE TABLE platform_task_attachments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 task_id uuid NOT NULL REFERENCES platform_tasks(id) ON DELETE CASCADE,
 storage_key uuid NOT NULL UNIQUE,
 file_name text NOT NULL CHECK(length(file_name) BETWEEN 1 AND 180),
 media_type text NOT NULL CHECK(media_type IN ('application/pdf','image/jpeg')),
 byte_size bigint NOT NULL CHECK(byte_size BETWEEN 1 AND 6291456),
 uploaded_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX platform_task_attachments_chronology_idx
 ON platform_task_attachments(task_id,created_at,id);
