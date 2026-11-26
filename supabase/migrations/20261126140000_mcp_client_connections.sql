-- Connected AI clients: each AI tool someone signed in to the MCP server with (Claude Code, Codex,
-- Cursor…), the workspace it reads, and when it was last used. Revoking one sets revoked_at: access
-- tokens issued before then stop working at once, and its refresh token and consent are deleted so
-- the tool has to sign in and be allowed again.
CREATE TABLE mcp_client_connection (
  user_id text NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  client_id text NOT NULL,
  workspace_id text NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  first_used_at text NOT NULL,
  last_used_at text NOT NULL,
  revoked_at text,
  revoked_by_user_id text REFERENCES "user" (id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, client_id, workspace_id)
);
CREATE INDEX mcp_client_connection_workspace_idx ON mcp_client_connection (workspace_id, last_used_at DESC);
ALTER TABLE mcp_client_connection ENABLE ROW LEVEL SECURITY;

-- When a script or CI token was last used, so a forgotten or leaked one is easy to spot.
ALTER TABLE workspace_mcp_token ADD COLUMN last_used_at text;
