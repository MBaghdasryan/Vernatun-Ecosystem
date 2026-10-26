CREATE TABLE resident_agenda_proposals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL,
 building_id uuid NOT NULL,
 submitted_by uuid NOT NULL REFERENCES users(id),
 title text NOT NULL CHECK(length(title) BETWEEN 3 AND 200),
 description text NOT NULL DEFAULT '' CHECK(length(description)<=4000),
 status text NOT NULL DEFAULT 'pending_review'
  CHECK(status IN ('pending_review','approved','rejected','included','decided')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 reviewed_by uuid REFERENCES users(id),
 reviewed_at timestamptz,
 review_reason text NOT NULL DEFAULT '',
 meeting_id uuid REFERENCES meetings(id),
 agenda_item_id uuid UNIQUE REFERENCES agenda_items(id),
 decision jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(building_id,organization_id) REFERENCES buildings(id,organization_id),
 CHECK((status IN ('included','decided'))=(meeting_id IS NOT NULL AND agenda_item_id IS NOT NULL))
);

CREATE TABLE resident_discussion_lineage (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL,
 building_id uuid NOT NULL,
 discussion_id uuid NOT NULL,
 source_message_id uuid REFERENCES resident_product_messages(id),
 source_text text NOT NULL CHECK(length(source_text) BETWEEN 1 AND 5000),
 link_type text NOT NULL CHECK(link_type IN ('request','agenda_proposal')),
 request_id uuid UNIQUE REFERENCES resident_requests(id),
 proposal_id uuid UNIQUE REFERENCES resident_agenda_proposals(id),
 meeting_id uuid REFERENCES meetings(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(discussion_id,building_id,organization_id)
  REFERENCES resident_product_records(id,building_id,organization_id),
 FOREIGN KEY(building_id,organization_id) REFERENCES buildings(id,organization_id),
 CHECK(
  (link_type='request' AND request_id IS NOT NULL AND proposal_id IS NULL AND meeting_id IS NULL)
  OR
  (link_type='agenda_proposal' AND request_id IS NULL AND proposal_id IS NOT NULL)
 )
);

CREATE INDEX resident_discussion_lineage_discussion
 ON resident_discussion_lineage(discussion_id,created_at);
CREATE INDEX resident_discussion_lineage_meeting
 ON resident_discussion_lineage(meeting_id) WHERE meeting_id IS NOT NULL;

CREATE TABLE resident_discussion_vote_links (
 lineage_id uuid NOT NULL REFERENCES resident_discussion_lineage(id),
 vote_id uuid NOT NULL REFERENCES meeting_ballots(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(lineage_id,vote_id)
);

CREATE INDEX resident_agenda_proposals_review
 ON resident_agenda_proposals(organization_id,building_id,status,created_at DESC);
