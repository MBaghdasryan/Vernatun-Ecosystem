CREATE FUNCTION protect_request_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Request history is append-only' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER request_history_append_only BEFORE UPDATE OR DELETE ON request_history
FOR EACH ROW EXECUTE FUNCTION protect_request_history();
