CREATE TABLE package_import_upload (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  project_id text NOT NULL,
  handoff_id text,
  handoff_name text,
  version_label text NOT NULL CHECK (length(trim(version_label)) > 0 AND length(version_label) <= 80),
  release_note text,
  file_name text NOT NULL CHECK (length(trim(file_name)) > 0 AND length(file_name) <= 255),
  content_type text NOT NULL CHECK (content_type IN (
    'application/zip', 'image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'
  )),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 100000000),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  object_key text NOT NULL UNIQUE CHECK (object_key ~ '^[a-f0-9]{48}$'),
  created_by_user_id text NOT NULL REFERENCES "user" (id) ON DELETE RESTRICT,
  created_at text NOT NULL,
  expires_at text NOT NULL,
  finalized_at text,
  object_deleted_at text,
  result_handoff_id text,
  result_version_id text,
  CHECK (
    (handoff_id IS NOT NULL AND handoff_name IS NULL) OR
    (handoff_id IS NULL AND handoff_name IS NOT NULL)
  ),
  CHECK (
    (finalized_at IS NULL AND result_handoff_id IS NULL AND result_version_id IS NULL) OR
    (finalized_at IS NOT NULL AND result_handoff_id IS NOT NULL AND result_version_id IS NOT NULL)
  ),
  FOREIGN KEY (project_id, workspace_id) REFERENCES project (id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (handoff_id, workspace_id) REFERENCES handoff (id, workspace_id) ON DELETE CASCADE
);

CREATE INDEX package_import_upload_expiry_idx
  ON package_import_upload (expires_at)
  WHERE finalized_at IS NULL;
