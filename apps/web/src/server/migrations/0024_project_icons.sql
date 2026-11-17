-- A small square logo or icon per project, so projects are easy to tell apart.
CREATE TABLE IF NOT EXISTS project_icon (
  project_id TEXT PRIMARY KEY REFERENCES project (id) ON DELETE CASCADE,
  content_type TEXT NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg', 'image/webp')),
  bytes BLOB NOT NULL,
  sha256 TEXT NOT NULL,
  updated_by_user_id TEXT,
  updated_at TEXT NOT NULL
);
