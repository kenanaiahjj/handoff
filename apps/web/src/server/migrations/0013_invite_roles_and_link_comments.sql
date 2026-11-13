ALTER TABLE handoff_invite
  ADD COLUMN role TEXT NOT NULL DEFAULT 'exec'
  CHECK (role IN ('pd', 'qa', 'dev', 'exec'));

ALTER TABLE handoff_comment RENAME TO handoff_comment_legacy;

CREATE TABLE handoff_comment (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  handoff_version_id TEXT NOT NULL,
  frame_id TEXT NOT NULL,
  source_node_id TEXT,
  x REAL,
  y REAL,
  parent_comment_id TEXT REFERENCES handoff_comment (id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  body TEXT NOT NULL CHECK (length(trim(body)) > 0 AND length(body) <= 4000),
  resolved_at TEXT,
  resolved_by_user_id TEXT REFERENCES "user" (id) ON DELETE SET NULL,
  created_by_user_id TEXT REFERENCES "user" (id) ON DELETE RESTRICT,
  created_by_invite_id TEXT REFERENCES handoff_invite (id) ON DELETE SET NULL,
  author_label TEXT,
  author_role TEXT CHECK (author_role IS NULL OR author_role IN ('pd', 'qa', 'dev', 'exec')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (handoff_version_id, workspace_id)
    REFERENCES handoff_version (id, workspace_id) ON DELETE CASCADE,
  CHECK ((x IS NULL AND y IS NULL) OR (x IS NOT NULL AND y IS NOT NULL)),
  CHECK (created_by_user_id IS NOT NULL OR (author_label IS NOT NULL AND author_role IS NOT NULL)),
  UNIQUE (id, handoff_version_id, workspace_id)
);

INSERT INTO handoff_comment (
  id, workspace_id, handoff_version_id, frame_id, source_node_id, x, y,
  parent_comment_id, body, resolved_at, resolved_by_user_id,
  created_by_user_id, created_by_invite_id, author_label, author_role, created_at
)
SELECT
  id, workspace_id, handoff_version_id, frame_id, source_node_id, x, y,
  parent_comment_id, body, resolved_at, resolved_by_user_id,
  created_by_user_id, NULL, NULL, NULL, created_at
FROM handoff_comment_legacy;

DROP TABLE handoff_comment_legacy;

CREATE INDEX handoff_comment_version_created_idx
  ON handoff_comment (handoff_version_id, created_at);

CREATE INDEX handoff_comment_parent_idx
  ON handoff_comment (parent_comment_id, created_at);
