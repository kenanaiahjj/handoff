-- Invite links remember the job role they were made for (Marketing, Executive, …), the same list
-- people pick from in onboarding. NULL for Owner links and links made before this.
ALTER TABLE workspace_invite ADD COLUMN job_role TEXT
  CHECK (job_role IS NULL OR job_role IN ('designer', 'dev', 'qa', 'pm', 'marketing', 'exec'));
