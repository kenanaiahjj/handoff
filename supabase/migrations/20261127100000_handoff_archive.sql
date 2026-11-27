-- Owners and designers can archive a handoff: it leaves the project's main list but keeps every
-- version, comment and share link. NULL means active.
ALTER TABLE handoff ADD COLUMN IF NOT EXISTS archived_at text;
