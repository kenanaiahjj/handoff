-- How each person wants Slack messages: every new version and mention, mentions only, or none.
CREATE TABLE IF NOT EXISTS notification_preference (
  user_id TEXT PRIMARY KEY REFERENCES "user" (id) ON DELETE CASCADE,
  slack TEXT NOT NULL DEFAULT 'all' CHECK (slack IN ('all', 'mentions', 'off')),
  updated_at TEXT NOT NULL
);
