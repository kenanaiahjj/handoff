-- Captures are stored Brotli-compressed (about 100x smaller), with a small index of their screens so
-- comparisons can still be computed inside SQLite. The original row keeps '{}' once its compressed
-- copy has been written and verified byte for byte.
CREATE TABLE IF NOT EXISTS handoff_version_snapshot (
  version_id TEXT PRIMARY KEY REFERENCES handoff_version (id) ON DELETE CASCADE,
  encoding TEXT NOT NULL CHECK (encoding IN ('br')),
  compressed BLOB NOT NULL,
  raw_bytes INTEGER NOT NULL CHECK (raw_bytes >= 0),
  frame_index TEXT NOT NULL CHECK (json_valid(frame_index))
);

-- Versions stay immutable. The single allowed change swaps the full snapshot text for '{}' when a
-- compressed copy exists, with every other column unchanged.
DROP TRIGGER IF EXISTS handoff_version_immutable_update;
CREATE TRIGGER handoff_version_immutable_update
BEFORE UPDATE ON handoff_version
WHEN NOT (
  NEW.snapshot_json = '{}'
  AND OLD.snapshot_json <> '{}'
  AND EXISTS (SELECT 1 FROM handoff_version_snapshot WHERE version_id = OLD.id)
  AND NEW.id = OLD.id
  AND NEW.workspace_id = OLD.workspace_id
  AND NEW.handoff_id = OLD.handoff_id
  AND NEW.version_label = OLD.version_label
  AND NEW.release_note IS OLD.release_note
  AND NEW.source = OLD.source
  AND NEW.source_file_id = OLD.source_file_id
  AND NEW.source_revision_id IS OLD.source_revision_id
  AND NEW.captured_at = OLD.captured_at
  AND NEW.content_hash = OLD.content_hash
  AND NEW.visual_only = OLD.visual_only
  AND NEW.created_by_user_id = OLD.created_by_user_id
  AND NEW.created_at = OLD.created_at
)
BEGIN
  SELECT RAISE(ABORT, 'Handoff versions are immutable');
END;
