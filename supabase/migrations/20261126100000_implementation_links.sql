-- Implementation links: which code component or file builds a Figma component (all its instances)
-- or one specific layer. Developers' AI tools read and set these through MCP so they know what to
-- update when a design changes, and what still has no implementation.
CREATE TABLE implementation_link (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  target_kind text NOT NULL CHECK (target_kind IN ('component', 'element')),
  target_id text NOT NULL CHECK (length(target_id) BETWEEN 1 AND 256),
  target_name text,
  code_component text CHECK (code_component IS NULL OR length(code_component) <= 200),
  code_path text NOT NULL CHECK (length(code_path) BETWEEN 1 AND 500),
  notes text CHECK (notes IS NULL OR length(notes) <= 2000),
  created_by_user_id text REFERENCES "user" (id) ON DELETE SET NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL,
  UNIQUE (workspace_id, target_kind, target_id)
);
ALTER TABLE implementation_link ENABLE ROW LEVEL SECURITY;
