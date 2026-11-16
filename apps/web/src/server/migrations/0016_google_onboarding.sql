-- What each person does on the team, picked once during onboarding.
CREATE TABLE IF NOT EXISTS user_profile (
  user_id TEXT PRIMARY KEY REFERENCES "user" (id) ON DELETE CASCADE,
  job_role TEXT NOT NULL CHECK (job_role IN ('designer', 'dev', 'qa', 'pm', 'marketing', 'exec')),
  onboarded_at TEXT NOT NULL
);
