UPDATE workspace_invite
SET reusable = 1
WHERE revoked_at IS NULL
  AND (expires_at IS NULL OR julianday(expires_at) > julianday('now'));
