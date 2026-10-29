CREATE TABLE platform_tasks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 title text NOT NULL CHECK(length(title) BETWEEN 2 AND 160),
 description text NOT NULL DEFAULT '' CHECK(length(description)<=4000),
 status text NOT NULL DEFAULT 'todo'
  CHECK(status IN ('todo','in_progress','blocked','done')),
 priority text NOT NULL DEFAULT 'normal'
  CHECK(priority IN ('low','normal','high','urgent')),
 organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
 assignee_id uuid REFERENCES users(id) ON DELETE SET NULL,
 due_on date,
 created_by uuid NOT NULL REFERENCES users(id),
 updated_by uuid NOT NULL REFERENCES users(id),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 archived_at timestamptz
);
CREATE INDEX platform_tasks_board_idx
 ON platform_tasks(archived_at,status,priority,due_on,updated_at DESC);
CREATE INDEX platform_tasks_organization_idx
 ON platform_tasks(organization_id) WHERE archived_at IS NULL;
CREATE INDEX platform_tasks_assignee_idx
 ON platform_tasks(assignee_id) WHERE archived_at IS NULL;
