-- A slim copy of each version's capture with only what the canvas draws (frame layout, element
-- summaries, capture metadata). Pages read this instead of decompressing and parsing the full
-- capture, which takes about a second and hundreds of MB for a large file on a fresh server.
-- It is a cache: rows are rebuilt from the full capture whenever they are missing or out of date.
CREATE TABLE handoff_version_canvas (
  version_id text PRIMARY KEY REFERENCES handoff_version (id) ON DELETE CASCADE,
  content_hash text NOT NULL,
  format integer NOT NULL CHECK (format > 0),
  encoding text NOT NULL CHECK (encoding IN ('br')),
  compressed bytea NOT NULL,
  created_at text NOT NULL
);

-- Tables added after the baseline do not get its row-level-security pass, so enable it here.
-- Only the server's service role reads these tables.
ALTER TABLE handoff_version_canvas ENABLE ROW LEVEL SECURITY;
ALTER TABLE package_import_upload ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON handoff_version_canvas FROM anon, authenticated;
GRANT ALL ON handoff_version_canvas TO service_role;
