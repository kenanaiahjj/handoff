CREATE TABLE layout_finding_comment (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  handoff_version_id TEXT NOT NULL,
  finding_key TEXT NOT NULL CHECK (length(trim(finding_key)) > 0),
  author_user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE RESTRICT,
  body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 4000),
  created_at TEXT NOT NULL,
  FOREIGN KEY (handoff_version_id, workspace_id)
    REFERENCES handoff_version (id, workspace_id) ON DELETE CASCADE
);

CREATE INDEX layout_finding_comment_version_key_created_idx
  ON layout_finding_comment (workspace_id, handoff_version_id, finding_key, created_at, id);
