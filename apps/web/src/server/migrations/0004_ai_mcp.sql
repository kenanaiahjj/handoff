CREATE TABLE changelog_draft (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  handoff_id TEXT NOT NULL,
  from_version_id TEXT NOT NULL,
  to_version_id TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  statements_json TEXT NOT NULL CHECK (json_valid(statements_json)),
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
  model_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved')),
  created_by_user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (handoff_id, workspace_id)
    REFERENCES handoff (id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (from_version_id, workspace_id)
    REFERENCES handoff_version (id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (to_version_id, workspace_id)
    REFERENCES handoff_version (id, workspace_id) ON DELETE CASCADE
);

CREATE INDEX changelog_draft_handoff_updated_idx
  ON changelog_draft (handoff_id, updated_at DESC);

CREATE TABLE workspace_mcp_token (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  created_by_user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  token_hash TEXT NOT NULL UNIQUE,
  scopes_json TEXT NOT NULL CHECK (json_valid(scopes_json)),
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX workspace_mcp_token_workspace_idx
  ON workspace_mcp_token (workspace_id, created_at DESC);

CREATE TABLE task_mcp_connection (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  endpoint_url TEXT NOT NULL,
  auth_type TEXT NOT NULL CHECK (auth_type IN ('none', 'bearer')),
  secret_ciphertext TEXT,
  secret_iv TEXT,
  secret_tag TEXT,
  allowed_actions_json TEXT NOT NULL CHECK (json_valid(allowed_actions_json)),
  tools_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tools_json)),
  selected_create_tool TEXT,
  created_by_user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, endpoint_url)
);

CREATE TABLE linked_task (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  handoff_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  connection_id TEXT NOT NULL REFERENCES task_mcp_connection (id) ON DELETE RESTRICT,
  external_task_id TEXT,
  external_url TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
  created_by_user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (handoff_id, workspace_id)
    REFERENCES handoff (id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (version_id, workspace_id)
    REFERENCES handoff_version (id, workspace_id) ON DELETE CASCADE
);
