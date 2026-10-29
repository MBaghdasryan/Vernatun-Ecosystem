-- Platform-wide notifications have no organization scope. Existing organization
-- notifications remain unchanged and continue to use the same preference policy.
ALTER TABLE notifications ALTER COLUMN organization_id DROP NOT NULL;

INSERT INTO notification_catalog(code,category,critical) VALUES
 ('platform_task_assigned','onboarding',false),
 ('platform_task_deadline_changed','onboarding',false);
