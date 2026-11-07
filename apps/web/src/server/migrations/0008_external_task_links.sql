CREATE TABLE linked_external_task (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  handoff_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  source_system TEXT NOT NULL CHECK (length(trim(source_system)) > 0),
  external_task_id TEXT,
  external_url TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
  created_by_user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  agent_run_url TEXT,
  pull_request_url TEXT,
  CHECK (external_task_id IS NOT NULL OR external_url IS NOT NULL),
  FOREIGN KEY (handoff_id, workspace_id)
    REFERENCES handoff (id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (version_id, workspace_id)
    REFERENCES handoff_version (id, workspace_id) ON DELETE CASCADE
);

CREATE INDEX linked_external_task_handoff_created_idx
  ON linked_external_task (workspace_id, handoff_id, created_at DESC);

INSERT INTO linked_external_task (
  id, workspace_id, handoff_id, version_id, source_system,
  external_task_id, external_url, title, description, evidence_json,
  created_by_user_id, created_at, agent_run_url, pull_request_url
)
SELECT linked_task.id, linked_task.workspace_id, linked_task.handoff_id,
       linked_task.version_id, task_mcp_connection.name,
       linked_task.external_task_id, linked_task.external_url,
       linked_task.title, linked_task.description, linked_task.evidence_json,
       linked_task.created_by_user_id, linked_task.created_at,
       linked_task.agent_run_url, linked_task.pull_request_url
FROM linked_task
JOIN task_mcp_connection ON task_mcp_connection.id = linked_task.connection_id;
