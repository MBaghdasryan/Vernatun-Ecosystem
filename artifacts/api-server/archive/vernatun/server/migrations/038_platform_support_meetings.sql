CREATE TABLE platform_support_meetings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid REFERENCES organizations(id),
 title text NOT NULL CHECK (length(btrim(title)) BETWEEN 2 AND 200),
 starts_at timestamptz NOT NULL,
 ends_at timestamptz NOT NULL,
 timezone text NOT NULL CHECK (length(timezone) BETWEEN 1 AND 100),
 location text NOT NULL DEFAULT '' CHECK (length(location) <= 500),
 notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 8000),
 status text NOT NULL DEFAULT 'scheduled'
  CHECK (status IN ('scheduled','confirmed','completed','cancelled')),
 version integer NOT NULL DEFAULT 1 CHECK (version > 0),
 created_by uuid NOT NULL REFERENCES users(id),
 updated_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (ends_at > starts_at AND ends_at - starts_at <= interval '12 hours')
);
CREATE INDEX platform_support_meetings_calendar
 ON platform_support_meetings(starts_at,id) WHERE status IN ('scheduled','confirmed');
CREATE INDEX platform_support_meetings_org_calendar
 ON platform_support_meetings(organization_id,starts_at,id)
 WHERE organization_id IS NOT NULL;

CREATE TABLE platform_support_meeting_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 meeting_id uuid NOT NULL REFERENCES platform_support_meetings(id),
 actor_id uuid NOT NULL REFERENCES users(id),
 action text NOT NULL CHECK (action IN ('created','edited','confirmed','cancelled','completed')),
 details jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_support_meeting_events_history
 ON platform_support_meeting_events(meeting_id,created_at,id);
CREATE TRIGGER platform_support_meeting_event_immutable
 BEFORE UPDATE OR DELETE ON platform_support_meeting_events
 FOR EACH ROW EXECUTE FUNCTION immutable_ledger();
