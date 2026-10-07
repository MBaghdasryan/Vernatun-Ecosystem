-- Additive Phase 6: preserve legacy ownerships, polls, votes and file metadata.
ALTER TABLE ownerships ADD COLUMN basis text NOT NULL DEFAULT '';
ALTER TABLE ownerships ADD COLUMN basis_version_id uuid;
ALTER TABLE ownerships ADD COLUMN version integer NOT NULL DEFAULT 1;
CREATE TABLE ownership_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),ownership_id uuid NOT NULL REFERENCES ownerships(id),
 actor_id uuid REFERENCES users(id),action text NOT NULL,snapshot jsonb NOT NULL,
 reason text NOT NULL DEFAULT '',created_at timestamptz);
INSERT INTO ownership_events(ownership_id,action,snapshot) SELECT id,'legacy_snapshot',to_jsonb(o) FROM ownerships o;
CREATE TRIGGER ownership_event_immutable BEFORE UPDATE OR DELETE ON ownership_events FOR EACH ROW EXECUTE FUNCTION immutable_ledger();
CREATE FUNCTION check_ownership_total() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE excessive boolean;
BEGIN
 PERFORM id FROM units WHERE id=NEW.unit_id FOR UPDATE;
 SELECT EXISTS(
  SELECT 1 FROM (
   SELECT starts_on AS day FROM ownerships WHERE unit_id=NEW.unit_id
   UNION SELECT ends_on+1 FROM ownerships WHERE unit_id=NEW.unit_id AND ends_on IS NOT NULL
  ) d WHERE (SELECT COALESCE(sum(share_basis_points),0) FROM ownerships o
   WHERE o.unit_id=NEW.unit_id AND o.starts_on<=d.day AND (o.ends_on IS NULL OR o.ends_on>=d.day))>10000
 ) INTO excessive;
 IF excessive THEN RAISE EXCEPTION 'ownership_share_overflow' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ownership_total AFTER INSERT OR UPDATE ON ownerships FOR EACH ROW EXECUTE FUNCTION check_ownership_total();

ALTER TABLE documents ADD COLUMN category text NOT NULL DEFAULT 'general';
ALTER TABLE documents ADD COLUMN related_type text;
ALTER TABLE documents ADD COLUMN related_id uuid;
ALTER TABLE documents ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE documents ADD COLUMN latest_version_id uuid;
CREATE TABLE document_versions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),document_id uuid NOT NULL REFERENCES documents(id),
 version_number integer NOT NULL CHECK(version_number>0),previous_version_id uuid REFERENCES document_versions(id),
 storage_key text NOT NULL UNIQUE,media_type text NOT NULL,title text NOT NULL,
 category text NOT NULL,related_type text,related_id uuid,
 visibility text NOT NULL CHECK(visibility IN('staff','residents','unit_owner')),
 uploaded_by uuid NOT NULL REFERENCES users(id),uploaded_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(document_id,version_number),UNIQUE(id,document_id));
INSERT INTO document_versions(document_id,version_number,storage_key,media_type,title,category,visibility,uploaded_by,uploaded_at)
 SELECT id,1,storage_key,media_type,title,category,visibility,uploaded_by,created_at FROM documents;
UPDATE documents d SET latest_version_id=v.id FROM document_versions v WHERE v.document_id=d.id;
ALTER TABLE documents ADD FOREIGN KEY(latest_version_id,id) REFERENCES document_versions(id,document_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE ownerships ADD FOREIGN KEY(basis_version_id) REFERENCES document_versions(id);
CREATE FUNCTION initial_document_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE vid uuid;
BEGIN
 INSERT INTO document_versions(document_id,version_number,storage_key,media_type,title,category,related_type,related_id,visibility,uploaded_by,uploaded_at)
 VALUES(NEW.id,1,NEW.storage_key,NEW.media_type,NEW.title,NEW.category,NEW.related_type,NEW.related_id,NEW.visibility,NEW.uploaded_by,NEW.created_at)
 RETURNING id INTO vid;
 UPDATE documents SET latest_version_id=vid WHERE id=NEW.id;
 RETURN NEW;
END $$;
CREATE TRIGGER initial_document_version AFTER INSERT ON documents FOR EACH ROW EXECUTE FUNCTION initial_document_version();
CREATE TRIGGER document_version_immutable BEFORE UPDATE OR DELETE ON document_versions FOR EACH ROW EXECUTE FUNCTION immutable_ledger();
CREATE TABLE support_document_shares(
 message_id uuid NOT NULL REFERENCES support_messages(id),document_id uuid NOT NULL REFERENCES documents(id),
 version_id uuid NOT NULL,PRIMARY KEY(message_id,document_id),
 FOREIGN KEY(version_id,document_id) REFERENCES document_versions(id,document_id));
INSERT INTO support_document_shares(message_id,document_id,version_id)
 SELECT m.id,d.id,d.latest_version_id FROM support_messages m JOIN documents d ON d.id=ANY(m.attachment_ids);
CREATE TRIGGER support_document_share_immutable BEFORE UPDATE OR DELETE ON support_document_shares FOR EACH ROW EXECUTE FUNCTION immutable_ledger();
-- Pin every newly shared document inside the message transaction; parent locks
-- synchronize this with version uploads. Existing clients still share current.
CREATE FUNCTION pin_support_documents() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM id FROM documents WHERE id=ANY(NEW.attachment_ids) ORDER BY id FOR SHARE;
 INSERT INTO support_document_shares(message_id,document_id,version_id)
 SELECT NEW.id,id,latest_version_id FROM documents WHERE id=ANY(NEW.attachment_ids);
 RETURN NEW;
END $$;
CREATE TRIGGER pin_support_documents AFTER INSERT ON support_messages FOR EACH ROW EXECUTE FUNCTION pin_support_documents();

ALTER TABLE meetings ADD COLUMN mode text NOT NULL DEFAULT 'legacy' CHECK(mode IN('legacy','weighted'));
ALTER TABLE meetings ADD COLUMN description text NOT NULL DEFAULT '';
ALTER TABLE meetings ADD COLUMN quorum_basis_points integer NOT NULL DEFAULT 5000 CHECK(quorum_basis_points BETWEEN 1 AND 10000);
ALTER TABLE meetings ADD COLUMN status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','published','cancelled','finalized'));
ALTER TABLE meetings ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE meetings ADD COLUMN protocol_document_id uuid REFERENCES documents(id);
ALTER TABLE agenda_items ADD COLUMN voting_type text NOT NULL DEFAULT 'yes_no' CHECK(voting_type IN('yes_no','single_choice'));
ALTER TABLE agenda_items ADD COLUMN options jsonb NOT NULL DEFAULT '["yes","no","abstain"]';
ALTER TABLE agenda_items ADD COLUMN pass_basis_points integer NOT NULL DEFAULT 5001 CHECK(pass_basis_points BETWEEN 1 AND 10000);
ALTER TABLE agenda_items ADD COLUMN pass_option text NOT NULL DEFAULT 'yes';
CREATE TABLE meeting_documents(meeting_id uuid NOT NULL REFERENCES meetings(id),version_id uuid NOT NULL REFERENCES document_versions(id),PRIMARY KEY(meeting_id,version_id));
CREATE TABLE meeting_eligibility(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),meeting_id uuid NOT NULL REFERENCES meetings(id),
 ownership_id uuid NOT NULL REFERENCES ownerships(id),unit_id uuid NOT NULL REFERENCES units(id),
 owner_id uuid NOT NULL REFERENCES users(id),share_basis_points integer NOT NULL CHECK(share_basis_points BETWEEN 1 AND 10000),
 UNIQUE(meeting_id,ownership_id));
CREATE TABLE meeting_ballots(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),agenda_item_id uuid NOT NULL REFERENCES agenda_items(id),
 eligibility_id uuid NOT NULL REFERENCES meeting_eligibility(id),owner_id uuid NOT NULL REFERENCES users(id),
 selected_option text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(agenda_item_id,eligibility_id));
CREATE TRIGGER meeting_eligibility_immutable BEFORE UPDATE OR DELETE ON meeting_eligibility FOR EACH ROW EXECUTE FUNCTION immutable_ledger();
CREATE TRIGGER meeting_ballot_immutable BEFORE UPDATE OR DELETE ON meeting_ballots FOR EACH ROW EXECUTE FUNCTION immutable_ledger();
CREATE TRIGGER meeting_document_immutable BEFORE UPDATE OR DELETE ON meeting_documents FOR EACH ROW EXECUTE FUNCTION immutable_ledger();
CREATE TABLE meeting_results(meeting_id uuid PRIMARY KEY REFERENCES meetings(id),result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TRIGGER meeting_result_immutable BEFORE UPDATE OR DELETE ON meeting_results FOR EACH ROW EXECUTE FUNCTION immutable_ledger();
CREATE TABLE operating_budgets(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL,building_id uuid NOT NULL,
 period date NOT NULL CHECK(extract(day FROM period)=1),currency text NOT NULL CHECK(currency IN('AMD','RUB','USD')),
 amount_minor bigint NOT NULL CHECK(amount_minor>=0),version integer NOT NULL DEFAULT 1,
 FOREIGN KEY(building_id,organization_id) REFERENCES buildings(id,organization_id),
 UNIQUE(building_id,period,currency));
INSERT INTO permissions(key) VALUES('ownership.manage'),('ownership.read') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_key,permission_key) VALUES
 ('org_admin','ownership.manage'),('org_admin','ownership.read'),
 ('manager','ownership.manage'),('manager','ownership.read'),
 ('portfolio_owner','ownership.read'),('unit_owner','ownership.read') ON CONFLICT DO NOTHING;
