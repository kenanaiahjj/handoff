-- People added to a whole project see every handoff in it, including ones created later.
-- Owners and designers already see everything; this is for reviewers, developers and QA.
CREATE TABLE project_member (
  project_id text NOT NULL,
  workspace_id text NOT NULL,
  email text NOT NULL CHECK (length(trim(email)) > 3 AND email = lower(trim(email))),
  role text NOT NULL DEFAULT 'exec' CHECK (role IN ('pd', 'qa', 'dev', 'exec')),
  added_by_user_id text REFERENCES "user" (id) ON DELETE SET NULL,
  created_at text NOT NULL,
  PRIMARY KEY (project_id, email),
  FOREIGN KEY (project_id, workspace_id) REFERENCES project (id, workspace_id) ON DELETE CASCADE
);

CREATE INDEX project_member_email ON project_member (workspace_id, email);
