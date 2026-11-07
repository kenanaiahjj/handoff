CREATE TABLE workspace_invite_next (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  invited_by_user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE RESTRICT,
  token_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'designer', 'reviewer', 'developer', 'qa')),
  expires_at TEXT,
  accepted_at TEXT,
  reusable INTEGER NOT NULL DEFAULT 0 CHECK (reusable IN (0, 1)),
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

INSERT INTO workspace_invite_next
  (id, workspace_id, invited_by_user_id, token_hash, role, expires_at, accepted_at, created_at)
SELECT id, workspace_id, invited_by_user_id, token_hash, role, expires_at, accepted_at, created_at
FROM workspace_invite;

DROP TABLE workspace_invite;
ALTER TABLE workspace_invite_next RENAME TO workspace_invite;

CREATE INDEX workspace_invite_workspace_idx
  ON workspace_invite (workspace_id, created_at DESC);
