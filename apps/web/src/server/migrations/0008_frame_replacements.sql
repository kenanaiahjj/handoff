CREATE TABLE handoff_frame_replacement (
  handoff_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  baseline_version_id TEXT NOT NULL,
  new_version_id TEXT NOT NULL,
  before_frame_id TEXT NOT NULL,
  after_frame_id TEXT NOT NULL,
  confirmed_by_user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (new_version_id, before_frame_id),
  UNIQUE (new_version_id, after_frame_id),
  FOREIGN KEY (handoff_id, workspace_id)
    REFERENCES handoff (id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (baseline_version_id, workspace_id)
    REFERENCES handoff_version (id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (new_version_id, workspace_id)
    REFERENCES handoff_version (id, workspace_id) ON DELETE CASCADE
);

CREATE INDEX handoff_frame_replacement_pair_idx
  ON handoff_frame_replacement (baseline_version_id, new_version_id);
