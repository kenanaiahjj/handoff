-- A workspace's own copy of the Figma naming handbook. No row means the built-in guide
-- (docs/figma-naming.md) applies; owners and designers save a row when they edit it.
CREATE TABLE workspace_handbook (
  workspace_id text PRIMARY KEY REFERENCES workspace (id) ON DELETE CASCADE,
  markdown text NOT NULL,
  updated_by_user_id text REFERENCES "user" (id) ON DELETE SET NULL,
  updated_at text NOT NULL
);
ALTER TABLE workspace_handbook ENABLE ROW LEVEL SECURITY;
