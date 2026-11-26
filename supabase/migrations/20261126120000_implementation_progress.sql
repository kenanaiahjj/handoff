-- Implementation progress: developers' AI tools mark each design change in a handoff version as
-- to do, in progress, done or skipped (with the file they changed), so the task list they read back
-- through MCP shows what is left, and the team can see what has been built.
CREATE TABLE implementation_progress (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  handoff_id text NOT NULL,
  version_id text NOT NULL REFERENCES handoff_version (id) ON DELETE CASCADE,
  task_id text NOT NULL CHECK (length(task_id) BETWEEN 1 AND 600),
  frame_id text NOT NULL CHECK (length(frame_id) BETWEEN 1 AND 256),
  node_id text,
  status text NOT NULL CHECK (status IN ('todo', 'in_progress', 'done', 'skipped')),
  code_path text CHECK (code_path IS NULL OR length(code_path) <= 500),
  note text CHECK (note IS NULL OR length(note) <= 2000),
  updated_by_user_id text REFERENCES "user" (id) ON DELETE SET NULL,
  updated_at text NOT NULL,
  UNIQUE (workspace_id, version_id, task_id)
);
CREATE INDEX implementation_progress_version_idx ON implementation_progress (workspace_id, version_id);
ALTER TABLE implementation_progress ENABLE ROW LEVEL SECURITY;
