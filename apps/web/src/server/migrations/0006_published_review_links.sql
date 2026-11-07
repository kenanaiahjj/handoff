ALTER TABLE handoff ADD COLUMN review_share_id TEXT;
ALTER TABLE handoff ADD COLUMN published_version_id TEXT REFERENCES handoff_version(id) ON DELETE SET NULL;
ALTER TABLE handoff ADD COLUMN published_at TEXT;
ALTER TABLE handoff ADD COLUMN published_by_user_id TEXT REFERENCES "user" (id) ON DELETE SET NULL;

CREATE UNIQUE INDEX handoff_review_share_id_unique
  ON handoff (review_share_id)
  WHERE review_share_id IS NOT NULL;

CREATE INDEX handoff_published_project_idx
  ON handoff (workspace_id, project_id, published_at DESC)
  WHERE published_version_id IS NOT NULL;
