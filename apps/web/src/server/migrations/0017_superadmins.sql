-- People who own every workspace. Listed by email so someone can be added before their first sign-in.
CREATE TABLE IF NOT EXISTS superadmin (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  invited_by_user_id TEXT REFERENCES "user" (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

-- Today's workspace owners become the first super admins.
INSERT OR IGNORE INTO superadmin (email, invited_by_user_id, created_at)
SELECT DISTINCT lower("user".email), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM workspace_membership
JOIN "user" ON "user".id = workspace_membership.user_id
WHERE workspace_membership.role = 'owner';
