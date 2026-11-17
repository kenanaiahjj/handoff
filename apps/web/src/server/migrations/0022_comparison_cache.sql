-- Saved version comparisons. Versions never change, so a comparison only goes stale when someone
-- confirms a screen or layer match; match_key fingerprints those, so a new match means a new row.
CREATE TABLE IF NOT EXISTS comparison_cache (
  handoff_id TEXT NOT NULL,
  from_version_id TEXT NOT NULL REFERENCES handoff_version (id) ON DELETE CASCADE,
  to_version_id TEXT NOT NULL REFERENCES handoff_version (id) ON DELETE CASCADE,
  match_key TEXT NOT NULL,
  encoding TEXT NOT NULL CHECK (encoding IN ('br')),
  compressed BLOB NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (from_version_id, to_version_id, match_key)
);

CREATE INDEX IF NOT EXISTS comparison_cache_created_idx ON comparison_cache (created_at);
