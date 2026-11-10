CREATE TABLE handoff_asset_rebuilt (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  handoff_version_id TEXT NOT NULL,
  asset_key TEXT NOT NULL,
  object_key TEXT NOT NULL,
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

INSERT INTO handoff_asset_rebuilt (
  id, workspace_id, handoff_version_id, asset_key, object_key, file_name,
  content_type, size_bytes, sha256, width, height, created_at
)
SELECT
  id, workspace_id, handoff_version_id, asset_key, object_key, file_name,
  content_type, size_bytes, sha256, width, height, created_at
FROM handoff_asset;

DROP TABLE handoff_asset;
ALTER TABLE handoff_asset_rebuilt RENAME TO handoff_asset;

CREATE INDEX handoff_asset_version_idx
  ON handoff_asset (handoff_version_id, asset_key);
CREATE INDEX handoff_asset_object_key_idx
  ON handoff_asset (object_key);
