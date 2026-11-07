ALTER TABLE project
  ADD COLUMN rules_json TEXT NOT NULL DEFAULT '{"allowedSpacing":[],"requireTokenCategories":[],"frameBounds":null}';

CREATE TABLE handoff_comment (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  handoff_version_id TEXT NOT NULL,
  frame_id TEXT NOT NULL,
  source_node_id TEXT,
  x REAL,
  y REAL,
  parent_comment_id TEXT REFERENCES handoff_comment (id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(trim(body)) > 0 AND length(body) <= 4000),
  resolved_at TEXT,
  resolved_by_user_id TEXT REFERENCES "user" (id) ON DELETE SET NULL,
  created_by_user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (handoff_version_id, workspace_id)
    REFERENCES handoff_version (id, workspace_id) ON DELETE CASCADE,
  CHECK ((x IS NULL AND y IS NULL) OR (x IS NOT NULL AND y IS NOT NULL)),
  UNIQUE (id, handoff_version_id, workspace_id)
);

CREATE INDEX handoff_comment_version_created_idx
  ON handoff_comment (handoff_version_id, created_at);

CREATE INDEX handoff_comment_parent_idx
  ON handoff_comment (parent_comment_id, created_at);

CREATE TABLE layout_finding_state (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  handoff_version_id TEXT NOT NULL,
  finding_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  assignee_user_id TEXT REFERENCES "user" (id) ON DELETE SET NULL,
  note TEXT,
  updated_by_user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE RESTRICT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (handoff_version_id, workspace_id)
    REFERENCES handoff_version (id, workspace_id) ON DELETE CASCADE,
  UNIQUE (handoff_version_id, finding_key)
);
