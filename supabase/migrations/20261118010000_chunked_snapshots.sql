CREATE TABLE handoff_snapshot_frame_chunk (
  workspace_id text NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  content_hash text NOT NULL CHECK (length(content_hash) = 64),
  compressed bytea NOT NULL,
  raw_bytes bigint NOT NULL CHECK (raw_bytes >= 0),
  PRIMARY KEY (workspace_id, content_hash)
);

CREATE TABLE handoff_snapshot_manifest (
  version_id text PRIMARY KEY,
  workspace_id text NOT NULL,
  metadata_json text NOT NULL CHECK (metadata_json::jsonb IS NOT NULL),
  frame_count integer NOT NULL CHECK (frame_count >= 0),
  FOREIGN KEY (version_id, workspace_id) REFERENCES handoff_version (id, workspace_id) ON DELETE CASCADE,
  UNIQUE (version_id, workspace_id)
);

CREATE TABLE handoff_snapshot_frame_ref (
  version_id text NOT NULL,
  workspace_id text NOT NULL,
  frame_position integer NOT NULL CHECK (frame_position >= 0),
  frame_id text NOT NULL,
  content_hash text NOT NULL,
  PRIMARY KEY (version_id, frame_position),
  UNIQUE (version_id, frame_id),
  FOREIGN KEY (version_id, workspace_id) REFERENCES handoff_snapshot_manifest (version_id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, content_hash) REFERENCES handoff_snapshot_frame_chunk (workspace_id, content_hash)
);

ALTER TABLE handoff_snapshot_frame_chunk ENABLE ROW LEVEL SECURITY;
ALTER TABLE handoff_snapshot_manifest ENABLE ROW LEVEL SECURITY;
ALTER TABLE handoff_snapshot_frame_ref ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON handoff_snapshot_frame_chunk, handoff_snapshot_manifest, handoff_snapshot_frame_ref FROM anon, authenticated;
GRANT ALL ON handoff_snapshot_frame_chunk, handoff_snapshot_manifest, handoff_snapshot_frame_ref TO service_role;
