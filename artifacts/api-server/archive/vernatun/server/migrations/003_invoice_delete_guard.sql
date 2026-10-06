CREATE OR REPLACE FUNCTION immutable_published_invoice() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status='published' THEN RAISE EXCEPTION 'Published invoices are immutable'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
