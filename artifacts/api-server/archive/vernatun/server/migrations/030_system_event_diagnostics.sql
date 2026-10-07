-- Never backfill historical events with the current build/environment.
ALTER TABLE system_log_events
 ADD COLUMN application_version text,
 ADD COLUMN environment text,
 ADD COLUMN safe_stack text;
