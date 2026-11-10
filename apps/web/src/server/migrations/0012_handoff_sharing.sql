ALTER TABLE handoff
  ADD COLUMN sharing_mode TEXT NOT NULL DEFAULT 'workspace'
  CHECK (sharing_mode IN ('workspace', 'invited', 'anyone'));

CREATE TABLE handoff_invite (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  handoff_id TEXT NOT NULL,
  email TEXT NOT NULL CHECK (length(trim(email)) > 3 AND email = lower(trim(email))),
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  expires_at TEXT,
  revoked_at TEXT,
  invited_by_user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (handoff_id, workspace_id)
    REFERENCES handoff (id, workspace_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX handoff_invite_active_email_unique
  ON handoff_invite (handoff_id, email)
  WHERE revoked_at IS NULL;

CREATE INDEX handoff_invite_token_idx
  ON handoff_invite (token_hash, handoff_id)
  WHERE revoked_at IS NULL;

CREATE INDEX handoff_invite_handoff_idx
  ON handoff_invite (workspace_id, handoff_id, created_at DESC);
