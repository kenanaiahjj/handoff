-- Local-only fixture data. These identities and records are not production credentials.
INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
VALUES ('local-test-user', 'Local Test User', 'local-test@example.invalid', true, now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO workspace (id, name, created_by_user_id, created_at)
VALUES ('local-test-workspace', 'Local Test Workspace', 'local-test-user', '2026-11-17T00:00:00.000Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO workspace_membership (workspace_id, user_id, role, created_at)
VALUES ('local-test-workspace', 'local-test-user', 'owner', '2026-11-17T00:00:00.000Z')
ON CONFLICT (workspace_id, user_id) DO NOTHING;

INSERT INTO project (id, workspace_id, name, created_by_user_id, created_at)
VALUES ('local-test-project', 'local-test-workspace', 'Local Test Project', 'local-test-user', '2026-11-17T00:00:00.000Z')
ON CONFLICT (id) DO NOTHING;
