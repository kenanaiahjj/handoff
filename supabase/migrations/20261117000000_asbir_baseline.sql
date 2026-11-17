-- Baseline translated from apps/web/src/server/migrations/*.sql.
-- Domain timestamp and JSON columns remain text to preserve current app contracts.

CREATE TABLE "user" (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  "emailVerified" boolean NOT NULL DEFAULT false,
  image text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE account (
  id text PRIMARY KEY,
  "accountId" text NOT NULL,
  "providerId" text NOT NULL,
  "userId" text NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  scope text,
  password text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE session (
  id text PRIMARY KEY,
  "expiresAt" timestamptz NOT NULL,
  token text NOT NULL UNIQUE,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "ipAddress" text,
  "userAgent" text,
  "userId" text NOT NULL REFERENCES "user" (id) ON DELETE CASCADE
);

CREATE TABLE verification (
  id text PRIMARY KEY,
  identifier text NOT NULL,
  value text NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workspace (
  id text PRIMARY KEY,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  created_by_user_id text NOT NULL REFERENCES "user" (id) ON DELETE RESTRICT,
  created_at text NOT NULL
);

CREATE TABLE workspace_membership (
  workspace_id text NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'designer', 'reviewer', 'developer', 'qa')),
  created_at text NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE workspace_invite (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  invited_by_user_id text NOT NULL REFERENCES "user" (id) ON DELETE RESTRICT,
  token_hash text NOT NULL UNIQUE,
  role text NOT NULL CHECK (role IN ('owner', 'designer', 'reviewer', 'developer', 'qa')),
  expires_at text,
  accepted_at text,
  reusable boolean NOT NULL DEFAULT false,
  revoked_at text,
  created_at text NOT NULL,
  job_role text CHECK (job_role IS NULL OR job_role IN ('designer', 'dev', 'qa', 'pm', 'marketing', 'exec'))
);

CREATE TABLE user_profile (
  user_id text PRIMARY KEY REFERENCES "user" (id) ON DELETE CASCADE,
  job_role text NOT NULL CHECK (job_role IN ('designer', 'dev', 'qa', 'pm', 'marketing', 'exec')),
  onboarded_at text NOT NULL,
  requested_role text CHECK (requested_role IS NULL OR requested_role IN ('designer'))
);

CREATE TABLE superadmin (
  email text PRIMARY KEY,
  invited_by_user_id text REFERENCES "user" (id) ON DELETE SET NULL,
  created_at text NOT NULL
);

CREATE UNIQUE INDEX superadmin_email_nocase_unique ON superadmin (lower(email));

CREATE TABLE project (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  created_by_user_id text NOT NULL REFERENCES "user" (id) ON DELETE RESTRICT,
  created_at text NOT NULL,
  rules_json text NOT NULL DEFAULT '{"allowedSpacing":[],"requireTokenCategories":[],"frameBounds":null}',
  pd_in_charge_user_id text REFERENCES "user" (id) ON DELETE SET NULL,
  UNIQUE (id, workspace_id),
  UNIQUE (workspace_id, name)
);

CREATE TABLE handoff (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  project_id text NOT NULL,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  created_by_user_id text NOT NULL REFERENCES "user" (id) ON DELETE RESTRICT,
  created_at text NOT NULL,
  review_share_id text,
  published_version_id text,
  published_at text,
  published_by_user_id text REFERENCES "user" (id) ON DELETE SET NULL,
  sharing_mode text NOT NULL DEFAULT 'workspace' CHECK (sharing_mode IN ('workspace', 'invited', 'anyone')),
  FOREIGN KEY (project_id, workspace_id) REFERENCES project (id, workspace_id) ON DELETE CASCADE,
  UNIQUE (id, workspace_id),
  UNIQUE (project_id, name)
);

CREATE TABLE handoff_version (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  handoff_id text NOT NULL,
  version_label text NOT NULL CHECK (length(trim(version_label)) > 0),
  release_note text,
  source text NOT NULL CHECK (source IN ('figma', 'paper', 'bundle')),
  source_file_id text NOT NULL,
  source_revision_id text,
  captured_at text NOT NULL,
  content_hash text NOT NULL CHECK (length(content_hash) = 64),
  visual_only boolean NOT NULL DEFAULT false,
  snapshot_json text NOT NULL CHECK (snapshot_json::jsonb IS NOT NULL),
  created_by_user_id text NOT NULL REFERENCES "user" (id) ON DELETE RESTRICT,
  created_at text NOT NULL,
  FOREIGN KEY (handoff_id, workspace_id) REFERENCES handoff (id, workspace_id) ON DELETE CASCADE,
  UNIQUE (handoff_id, version_label),
  UNIQUE (id, workspace_id)
);

ALTER TABLE handoff
  ADD CONSTRAINT handoff_published_version_id_fkey
  FOREIGN KEY (published_version_id) REFERENCES handoff_version (id) ON DELETE SET NULL;

CREATE TABLE capture_session (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  project_id text NOT NULL,
  handoff_id text,
  handoff_name text,
  version_label text NOT NULL CHECK (length(trim(version_label)) > 0),
  release_note text,
  created_by_user_id text NOT NULL REFERENCES "user" (id) ON DELETE RESTRICT,
  token_hash text NOT NULL UNIQUE,
  expires_at text NOT NULL,
  used_at text,
  created_at text NOT NULL,
  FOREIGN KEY (project_id, workspace_id) REFERENCES project (id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (handoff_id, workspace_id) REFERENCES handoff (id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE capture_upload (
  id text PRIMARY KEY,
  capture_session_id text NOT NULL REFERENCES capture_session (id) ON DELETE CASCADE,
  upload_kind text NOT NULL CHECK (upload_kind IN ('snapshot', 'asset')),
  asset_key text,
  object_key text NOT NULL UNIQUE CHECK (object_key ~ '^[a-f0-9]{48}$'),
  file_name text NOT NULL,
  content_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  created_at text NOT NULL,
  is_current boolean NOT NULL DEFAULT true,
  finalized_at text,
  version_id text REFERENCES handoff_version (id) ON DELETE SET NULL,
  CHECK ((upload_kind = 'snapshot' AND asset_key IS NULL) OR (upload_kind = 'asset' AND asset_key IS NOT NULL))
);

CREATE UNIQUE INDEX capture_upload_snapshot_per_session_idx
  ON capture_upload (capture_session_id) WHERE upload_kind = 'snapshot' AND is_current;
CREATE UNIQUE INDEX capture_upload_asset_per_session_idx
  ON capture_upload (capture_session_id, asset_key) WHERE upload_kind = 'asset' AND is_current;

CREATE TABLE capture_upload_abandoned (
  object_key text PRIMARY KEY CHECK (object_key ~ '^[a-f0-9]{48}$'),
  created_at text NOT NULL,
  delete_after text NOT NULL
);
CREATE INDEX capture_upload_abandoned_delete_after_idx ON capture_upload_abandoned (delete_after);

CREATE TABLE handoff_version_snapshot (
  version_id text PRIMARY KEY REFERENCES handoff_version (id) ON DELETE CASCADE,
  encoding text NOT NULL CHECK (encoding IN ('br')),
  compressed bytea NOT NULL,
  raw_bytes bigint NOT NULL CHECK (raw_bytes >= 0),
  frame_index text NOT NULL CHECK (frame_index::jsonb IS NOT NULL)
);

CREATE TABLE handoff_asset (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  handoff_version_id text NOT NULL,
  asset_key text NOT NULL,
  object_key text NOT NULL,
  file_name text NOT NULL,
  content_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  sha256 text NOT NULL CHECK (length(sha256) = 64),
  width integer CHECK (width IS NULL OR width > 0),
  height integer CHECK (height IS NULL OR height > 0),
  created_at text NOT NULL,
  FOREIGN KEY (handoff_version_id, workspace_id) REFERENCES handoff_version (id, workspace_id) ON DELETE CASCADE,
  UNIQUE (handoff_version_id, asset_key)
);

CREATE TABLE handoff_comment (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  handoff_version_id text NOT NULL,
  frame_id text NOT NULL,
  source_node_id text,
  x double precision,
  y double precision,
  parent_comment_id text REFERENCES handoff_comment (id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  body text NOT NULL CHECK (length(trim(body)) > 0 AND length(body) <= 4000),
  resolved_at text,
  resolved_by_user_id text REFERENCES "user" (id) ON DELETE SET NULL,
  created_by_user_id text REFERENCES "user" (id) ON DELETE RESTRICT,
  created_by_invite_id text,
  author_label text,
  author_role text CHECK (author_role IS NULL OR author_role IN ('pd', 'qa', 'dev', 'exec')),
  created_at text NOT NULL,
  FOREIGN KEY (handoff_version_id, workspace_id) REFERENCES handoff_version (id, workspace_id) ON DELETE CASCADE,
  CHECK ((x IS NULL AND y IS NULL) OR (x IS NOT NULL AND y IS NOT NULL)),
  CHECK (created_by_user_id IS NOT NULL OR (author_label IS NOT NULL AND author_role IS NOT NULL)),
  UNIQUE (id, handoff_version_id, workspace_id)
);

CREATE TABLE handoff_invite (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  handoff_id text NOT NULL,
  email text NOT NULL CHECK (length(trim(email)) > 3 AND email = lower(trim(email))),
  token_hash text NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  expires_at text,
  revoked_at text,
  invited_by_user_id text NOT NULL REFERENCES "user" (id) ON DELETE RESTRICT,
  created_at text NOT NULL,
  role text NOT NULL DEFAULT 'exec' CHECK (role IN ('pd', 'qa', 'dev', 'exec')),
  FOREIGN KEY (handoff_id, workspace_id) REFERENCES handoff (id, workspace_id) ON DELETE CASCADE
);

ALTER TABLE handoff_comment
  ADD CONSTRAINT handoff_comment_created_by_invite_id_fkey
  FOREIGN KEY (created_by_invite_id) REFERENCES handoff_invite (id) ON DELETE SET NULL;

CREATE TABLE handoff_annotation (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  handoff_version_id text NOT NULL,
  frame_id text NOT NULL,
  source_node_id text,
  x double precision NOT NULL,
  y double precision NOT NULL,
  title text NOT NULL CHECK (length(trim(title)) > 0),
  body text NOT NULL CHECK (length(trim(body)) > 0),
  created_by_user_id text NOT NULL REFERENCES "user" (id) ON DELETE RESTRICT,
  created_at text NOT NULL,
  updated_at text NOT NULL,
  FOREIGN KEY (handoff_version_id, workspace_id) REFERENCES handoff_version (id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE handoff_frame_replacement (
  handoff_id text NOT NULL,
  workspace_id text NOT NULL,
  baseline_version_id text NOT NULL,
  new_version_id text NOT NULL,
  before_frame_id text NOT NULL,
  after_frame_id text NOT NULL,
  confirmed_by_user_id text NOT NULL REFERENCES "user" (id) ON DELETE RESTRICT,
  created_at text NOT NULL,
  PRIMARY KEY (new_version_id, before_frame_id),
  UNIQUE (new_version_id, after_frame_id),
  FOREIGN KEY (handoff_id, workspace_id) REFERENCES handoff (id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (baseline_version_id, workspace_id) REFERENCES handoff_version (id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (new_version_id, workspace_id) REFERENCES handoff_version (id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE handoff_node_replacement (
  handoff_id text NOT NULL,
  workspace_id text NOT NULL,
  baseline_version_id text NOT NULL,
  new_version_id text NOT NULL,
  before_frame_id text NOT NULL,
  after_frame_id text NOT NULL,
  before_node_id text NOT NULL,
  after_node_id text NOT NULL,
  confirmed_by_user_id text NOT NULL REFERENCES "user" (id) ON DELETE RESTRICT,
  created_at text NOT NULL,
  PRIMARY KEY (baseline_version_id, new_version_id, before_frame_id, before_node_id),
  UNIQUE (baseline_version_id, new_version_id, after_frame_id, after_node_id),
  FOREIGN KEY (handoff_id, workspace_id) REFERENCES handoff (id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (baseline_version_id, workspace_id) REFERENCES handoff_version (id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (new_version_id, workspace_id) REFERENCES handoff_version (id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE changelog_draft (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  handoff_id text NOT NULL,
  from_version_id text NOT NULL,
  to_version_id text NOT NULL,
  title text NOT NULL,
  summary text NOT NULL,
  statements_json text NOT NULL CHECK (statements_json::jsonb IS NOT NULL),
  evidence_json text NOT NULL CHECK (evidence_json::jsonb IS NOT NULL),
  model_id text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved')),
  created_by_user_id text NOT NULL REFERENCES "user" (id) ON DELETE RESTRICT,
  created_at text NOT NULL,
  updated_at text NOT NULL,
  FOREIGN KEY (handoff_id, workspace_id) REFERENCES handoff (id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (from_version_id, workspace_id) REFERENCES handoff_version (id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (to_version_id, workspace_id) REFERENCES handoff_version (id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE comment_mention (
  comment_id text NOT NULL REFERENCES handoff_comment (id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  workspace_id text NOT NULL,
  handoff_id text NOT NULL,
  thread_id text NOT NULL,
  mentioned_by_user_id text REFERENCES "user" (id) ON DELETE SET NULL,
  created_at text NOT NULL,
  done_at text,
  PRIMARY KEY (comment_id, user_id)
);

CREATE TABLE comparison_cache (
  handoff_id text NOT NULL,
  from_version_id text NOT NULL REFERENCES handoff_version (id) ON DELETE CASCADE,
  to_version_id text NOT NULL REFERENCES handoff_version (id) ON DELETE CASCADE,
  match_key text NOT NULL,
  encoding text NOT NULL CHECK (encoding IN ('br')),
  compressed bytea NOT NULL,
  created_at text NOT NULL,
  PRIMARY KEY (from_version_id, to_version_id, match_key)
);

CREATE TABLE handoff_view (
  user_id text NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  workspace_id text NOT NULL,
  handoff_id text NOT NULL,
  last_seen_version_id text NOT NULL,
  seen_at text NOT NULL,
  PRIMARY KEY (user_id, handoff_id),
  FOREIGN KEY (handoff_id, workspace_id) REFERENCES handoff (id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE layout_finding_comment (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  handoff_version_id text NOT NULL,
  finding_key text NOT NULL CHECK (length(trim(finding_key)) > 0),
  author_user_id text NOT NULL REFERENCES "user" (id) ON DELETE RESTRICT,
  body text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 4000),
  created_at text NOT NULL,
  FOREIGN KEY (handoff_version_id, workspace_id) REFERENCES handoff_version (id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE layout_finding_state (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  handoff_version_id text NOT NULL,
  finding_key text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  assignee_user_id text REFERENCES "user" (id) ON DELETE SET NULL,
  note text,
  updated_by_user_id text NOT NULL REFERENCES "user" (id) ON DELETE RESTRICT,
  updated_at text NOT NULL,
  FOREIGN KEY (handoff_version_id, workspace_id) REFERENCES handoff_version (id, workspace_id) ON DELETE CASCADE,
  UNIQUE (handoff_version_id, finding_key)
);

CREATE TABLE linked_external_task (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  handoff_id text NOT NULL,
  version_id text NOT NULL,
  source_system text NOT NULL CHECK (length(trim(source_system)) > 0),
  external_task_id text,
  external_url text,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  evidence_json text NOT NULL CHECK (evidence_json::jsonb IS NOT NULL),
  created_by_user_id text NOT NULL REFERENCES "user" (id) ON DELETE RESTRICT,
  created_at text NOT NULL,
  agent_run_url text,
  pull_request_url text,
  CHECK (external_task_id IS NOT NULL OR external_url IS NOT NULL),
  FOREIGN KEY (handoff_id, workspace_id) REFERENCES handoff (id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (version_id, workspace_id) REFERENCES handoff_version (id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE notification_preference (
  user_id text PRIMARY KEY REFERENCES "user" (id) ON DELETE CASCADE,
  slack text NOT NULL DEFAULT 'all' CHECK (slack IN ('all', 'mentions', 'off')),
  updated_at text NOT NULL
);

CREATE TABLE project_icon (
  project_id text PRIMARY KEY REFERENCES project (id) ON DELETE CASCADE,
  content_type text NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg', 'image/webp')),
  bytes bytea NOT NULL,
  sha256 text NOT NULL,
  updated_by_user_id text,
  updated_at text NOT NULL
);

CREATE TABLE viewer_pin (
  user_id text NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('workspace', 'project')),
  target_id text NOT NULL,
  created_at text NOT NULL,
  PRIMARY KEY (user_id, kind, target_id)
);

CREATE TABLE workspace_mcp_token (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  created_by_user_id text NOT NULL REFERENCES "user" (id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  token_hash text NOT NULL UNIQUE,
  scopes_json text NOT NULL CHECK (scopes_json::jsonb IS NOT NULL),
  expires_at text NOT NULL,
  revoked_at text,
  created_at text NOT NULL
);

CREATE INDEX "account_userId_idx" ON account ("userId");
CREATE INDEX "session_userId_idx" ON session ("userId");
CREATE INDEX verification_identifier_idx ON verification (identifier);
CREATE INDEX capture_session_expiry_idx ON capture_session (expires_at, used_at);
CREATE INDEX changelog_draft_handoff_updated_idx ON changelog_draft (handoff_id, updated_at DESC);
CREATE INDEX comment_mention_open_idx ON comment_mention (user_id, done_at, created_at DESC);
CREATE INDEX comparison_cache_created_idx ON comparison_cache (created_at);
CREATE INDEX handoff_annotation_version_frame_idx ON handoff_annotation (handoff_version_id, frame_id, created_at);
CREATE INDEX handoff_asset_object_key_idx ON handoff_asset (object_key);
CREATE INDEX handoff_asset_version_idx ON handoff_asset (handoff_version_id, asset_key);
CREATE INDEX handoff_comment_parent_idx ON handoff_comment (parent_comment_id, created_at);
CREATE INDEX handoff_comment_version_created_idx ON handoff_comment (handoff_version_id, created_at);
CREATE INDEX handoff_frame_replacement_pair_idx ON handoff_frame_replacement (baseline_version_id, new_version_id);
CREATE UNIQUE INDEX handoff_invite_active_email_unique ON handoff_invite (handoff_id, email) WHERE revoked_at IS NULL;
CREATE INDEX handoff_invite_handoff_idx ON handoff_invite (workspace_id, handoff_id, created_at DESC);
CREATE INDEX handoff_invite_token_idx ON handoff_invite (token_hash, handoff_id) WHERE revoked_at IS NULL;
CREATE INDEX handoff_node_replacement_pair_idx ON handoff_node_replacement (baseline_version_id, new_version_id);
CREATE INDEX handoff_project_created_idx ON handoff (project_id, created_at DESC);
CREATE INDEX handoff_published_project_idx ON handoff (workspace_id, project_id, published_at DESC) WHERE published_version_id IS NOT NULL;
CREATE UNIQUE INDEX handoff_review_share_id_unique ON handoff (review_share_id) WHERE review_share_id IS NOT NULL;
CREATE INDEX handoff_version_created_idx ON handoff_version (handoff_id, created_at DESC);
CREATE INDEX handoff_version_workspace_idx ON handoff_version (workspace_id, created_at DESC);
CREATE INDEX layout_finding_comment_version_key_created_idx ON layout_finding_comment (workspace_id, handoff_version_id, finding_key, created_at, id);
CREATE INDEX linked_external_task_handoff_created_idx ON linked_external_task (workspace_id, handoff_id, created_at DESC);
CREATE INDEX project_workspace_created_idx ON project (workspace_id, created_at DESC);
CREATE INDEX workspace_invite_workspace_idx ON workspace_invite (workspace_id, created_at DESC);
CREATE INDEX workspace_mcp_token_workspace_idx ON workspace_mcp_token (workspace_id, created_at DESC);
CREATE INDEX workspace_membership_user_idx ON workspace_membership (user_id, workspace_id);

CREATE OR REPLACE FUNCTION reject_handoff_version_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.snapshot_json = '{}'
    AND OLD.snapshot_json <> '{}'
    AND EXISTS (
      SELECT 1 FROM handoff_version_snapshot WHERE version_id = OLD.id
    )
    AND (to_jsonb(NEW) - 'snapshot_json') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'snapshot_json')
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Handoff versions are immutable';
END;
$$;

CREATE TRIGGER handoff_version_immutable_update
BEFORE UPDATE ON handoff_version
FOR EACH ROW EXECUTE FUNCTION reject_handoff_version_mutation();

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'handoff-assets',
  'handoff-assets',
  false,
  268435456,
  ARRAY[
    'image/png', 'image/jpeg', 'image/webp', 'image/svg+xml',
    'application/zip', 'application/x-zip-compressed', 'application/octet-stream'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DO $$
DECLARE
  app_table record;
BEGIN
  FOR app_table IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', app_table.tablename);
  END LOOP;
END;
$$;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
