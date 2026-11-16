-- Remembers the newest version each person has opened, so reviewers can see when a
-- handoff they follow gets a new version.
CREATE TABLE IF NOT EXISTS handoff_view (
  user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL,
  handoff_id TEXT NOT NULL,
  last_seen_version_id TEXT NOT NULL,
  seen_at TEXT NOT NULL,
  PRIMARY KEY (user_id, handoff_id),
  FOREIGN KEY (handoff_id, workspace_id)
    REFERENCES handoff (id, workspace_id) ON DELETE CASCADE
);
