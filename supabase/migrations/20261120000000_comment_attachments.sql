-- Images attached to comments and replies. Uploaded before the comment is posted (comment_id is
-- NULL until then) and kept in the database like avatars and project icons.
CREATE TABLE comment_attachment (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  handoff_version_id text NOT NULL,
  comment_id text REFERENCES handoff_comment (id) ON DELETE CASCADE,
  content_type text NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif')),
  bytes bytea NOT NULL,
  size_bytes integer NOT NULL CHECK (size_bytes > 0),
  width integer CHECK (width IS NULL OR width > 0),
  height integer CHECK (height IS NULL OR height > 0),
  created_by_user_id text REFERENCES "user" (id) ON DELETE SET NULL,
  created_at text NOT NULL,
  FOREIGN KEY (handoff_version_id, workspace_id) REFERENCES handoff_version (id, workspace_id) ON DELETE CASCADE
);
CREATE INDEX comment_attachment_comment_idx ON comment_attachment (comment_id, created_at);
CREATE INDEX comment_attachment_version_idx ON comment_attachment (handoff_version_id, workspace_id);
ALTER TABLE comment_attachment ENABLE ROW LEVEL SECURITY;
