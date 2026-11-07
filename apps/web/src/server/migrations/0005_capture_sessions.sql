CREATE TABLE capture_session (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  handoff_id TEXT,
  handoff_name TEXT,
  version_label TEXT NOT NULL CHECK (length(trim(version_label)) > 0),
  release_note TEXT,
  created_by_user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE RESTRICT,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id, workspace_id)
    REFERENCES project (id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (handoff_id, workspace_id)
    REFERENCES handoff (id, workspace_id) ON DELETE CASCADE
);

CREATE INDEX capture_session_expiry_idx
  ON capture_session (expires_at, used_at);
