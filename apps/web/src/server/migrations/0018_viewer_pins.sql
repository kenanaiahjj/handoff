-- Groups a person pinned to the top of their home: a whole workspace, or one project.
CREATE TABLE IF NOT EXISTS viewer_pin (
  user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('workspace', 'project')),
  target_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, kind, target_id)
);
