-- "Changed since you last looked": the handoff version each person last opened, and the one they
-- had open before it. Opening a newer version moves last to baseline, so the canvas can highlight
-- everything that changed since that earlier visit (reloading the same version keeps the baseline).
CREATE TABLE handoff_seen_version (
  handoff_id text NOT NULL REFERENCES handoff (id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  last_version_id text NOT NULL,
  baseline_version_id text,
  updated_at text NOT NULL,
  PRIMARY KEY (handoff_id, user_id)
);
ALTER TABLE handoff_seen_version ENABLE ROW LEVEL SECURITY;

-- Live presence on the review canvas: who has a handoff open, on which version and screen, and
-- where their pointer is (Figma page units). Rows older than a few seconds count as gone.
CREATE TABLE canvas_presence (
  handoff_id text NOT NULL REFERENCES handoff (id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  version_id text NOT NULL,
  screen_id text,
  pointer_x double precision,
  pointer_y double precision,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (handoff_id, user_id)
);
CREATE INDEX canvas_presence_recent_idx ON canvas_presence (handoff_id, updated_at DESC);
ALTER TABLE canvas_presence ENABLE ROW LEVEL SECURITY;
