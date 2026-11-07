CREATE TABLE project (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  created_by_user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  UNIQUE (id, workspace_id),
  UNIQUE (workspace_id, name)
);

CREATE INDEX project_workspace_created_idx
  ON project (workspace_id, created_at DESC);

CREATE TABLE handoff (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  created_by_user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id, workspace_id)
    REFERENCES project (id, workspace_id) ON DELETE CASCADE,
  UNIQUE (id, workspace_id),
  UNIQUE (project_id, name)
);

CREATE INDEX handoff_project_created_idx
  ON handoff (project_id, created_at DESC);

CREATE TABLE handoff_version (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  handoff_id TEXT NOT NULL,
  version_label TEXT NOT NULL CHECK (length(trim(version_label)) > 0),
  release_note TEXT,
  source TEXT NOT NULL CHECK (source IN ('figma', 'paper', 'bundle')),
  source_file_id TEXT NOT NULL,
  source_revision_id TEXT,
  captured_at TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  visual_only INTEGER NOT NULL DEFAULT 0 CHECK (visual_only IN (0, 1)),
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  created_by_user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (handoff_id, workspace_id)
    REFERENCES handoff (id, workspace_id) ON DELETE CASCADE,
  UNIQUE (handoff_id, version_label),
  UNIQUE (id, workspace_id)
);

CREATE INDEX handoff_version_created_idx
  ON handoff_version (handoff_id, created_at DESC);

CREATE INDEX handoff_version_workspace_idx
  ON handoff_version (workspace_id, created_at DESC);

CREATE TABLE handoff_asset (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  handoff_version_id TEXT NOT NULL,
  asset_key TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  width INTEGER CHECK (width IS NULL OR width > 0),
  height INTEGER CHECK (height IS NULL OR height > 0),
  created_at TEXT NOT NULL,
  FOREIGN KEY (handoff_version_id, workspace_id)
    REFERENCES handoff_version (id, workspace_id) ON DELETE CASCADE,
  UNIQUE (handoff_version_id, asset_key)
);

CREATE INDEX handoff_asset_version_idx
  ON handoff_asset (handoff_version_id, asset_key);
