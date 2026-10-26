INSERT INTO notification_catalog(code,category,critical) VALUES
 ('viewing_requested','community',false),
 ('viewing_confirmed','community',false),
 ('viewing_declined','community',false),
 ('viewing_cancelled','community',false)
ON CONFLICT(code) DO NOTHING;
