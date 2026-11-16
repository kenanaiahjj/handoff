-- People mentioned in comments ("@Ana"); open ones show in "Needs you" until replied to or done.
CREATE TABLE IF NOT EXISTS comment_mention (
  comment_id TEXT NOT NULL REFERENCES handoff_comment (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL,
  handoff_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  mentioned_by_user_id TEXT REFERENCES "user" (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  done_at TEXT,
  PRIMARY KEY (comment_id, user_id)
);

CREATE INDEX IF NOT EXISTS comment_mention_open_idx ON comment_mention (user_id, done_at, created_at DESC);
