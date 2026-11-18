-- Where a handoff stands in review: drafting, waiting on reviewers, or signed off.
ALTER TABLE handoff ADD COLUMN review_status text NOT NULL DEFAULT 'draft'
  CHECK (review_status IN ('draft', 'in_review', 'approved'));
ALTER TABLE handoff ADD COLUMN review_status_at text;
ALTER TABLE handoff ADD COLUMN review_status_by_user_id text REFERENCES "user" (id) ON DELETE SET NULL;
CREATE INDEX handoff_review_status ON handoff (workspace_id, review_status);
