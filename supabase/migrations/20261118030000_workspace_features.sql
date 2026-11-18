-- Last time each person used the app (throttled to a few minutes), so "Last active" is accurate
-- even while a sign-in session stays valid for days.
CREATE TABLE user_presence (
  user_id text PRIMARY KEY REFERENCES "user" (id) ON DELETE CASCADE,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
