CREATE TABLE handoff_annotation (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  handoff_version_id TEXT NOT NULL,
  frame_id TEXT NOT NULL,
  source_node_id TEXT,
  x REAL NOT NULL,
  y REAL NOT NULL,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  body TEXT NOT NULL CHECK (length(trim(body)) > 0),
  created_by_user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (handoff_version_id, workspace_id)
    REFERENCES handoff_version (id, workspace_id) ON DELETE CASCADE
);

CREATE INDEX handoff_annotation_version_frame_idx
  ON handoff_annotation (handoff_version_id, frame_id, created_at);
