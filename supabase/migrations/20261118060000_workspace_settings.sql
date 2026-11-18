-- Owner-editable workspace settings. NULL domains means "use ASBIR_ALLOWED_EMAIL_DOMAINS".
ALTER TABLE workspace ADD COLUMN allowed_email_domains text;
CREATE TABLE workspace_logo (
  workspace_id text PRIMARY KEY REFERENCES workspace (id) ON DELETE CASCADE,
  content_type text NOT NULL,
  bytes bytea NOT NULL,
  sha256 text NOT NULL,
  updated_by_user_id text REFERENCES "user" (id) ON DELETE SET NULL,
  updated_at text NOT NULL
);
ALTER TABLE workspace_logo ENABLE ROW LEVEL SECURITY;
