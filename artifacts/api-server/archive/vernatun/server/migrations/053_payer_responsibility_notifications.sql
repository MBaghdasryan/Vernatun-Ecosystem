INSERT INTO notification_catalog(code,category,critical) VALUES
 ('payer_responsibility_pending','finance',false),
 ('payer_responsibility_accepted','finance',false),
 ('payer_responsibility_declined','finance',false),
 ('payer_responsibility_revoked','finance',false)
ON CONFLICT(code) DO NOTHING;
