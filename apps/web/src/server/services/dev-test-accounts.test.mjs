import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createPostgresTestFixture } from "../test-support/postgres-test-fixture.mjs";

const priorDomains = process.env.ASBIR_ALLOWED_EMAIL_DOMAINS;
const priorAuthUrl = process.env.BETTER_AUTH_URL;
const fixture = await createPostgresTestFixture();
const { database, pool } = fixture;
process.env.ASBIR_ALLOWED_EMAIL_DOMAINS = "lmf.ventures";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";

await pool.query(`
  CREATE TABLE "user" (id TEXT PRIMARY KEY, name TEXT, email TEXT, "emailVerified" BOOLEAN, image TEXT, "createdAt" TEXT, "updatedAt" TEXT);
  CREATE TABLE IF NOT EXISTS user_presence (user_id TEXT PRIMARY KEY, last_seen_at TIMESTAMPTZ);
  CREATE TABLE account (
    id TEXT PRIMARY KEY, "accountId" TEXT NOT NULL, "providerId" TEXT NOT NULL, "userId" TEXT NOT NULL,
    "accessToken" TEXT, "refreshToken" TEXT, "idToken" TEXT, "accessTokenExpiresAt" TIMESTAMPTZ,
    "refreshTokenExpiresAt" TIMESTAMPTZ, scope TEXT, password TEXT, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE session (
    id TEXT PRIMARY KEY, "expiresAt" TIMESTAMPTZ NOT NULL, token TEXT NOT NULL UNIQUE,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(), "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "ipAddress" TEXT, "userAgent" TEXT, "userId" TEXT NOT NULL
  );
  CREATE TABLE verification (
    id TEXT PRIMARY KEY, identifier TEXT NOT NULL, value TEXT NOT NULL, "expiresAt" TIMESTAMPTZ NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(), "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE workspace_membership (workspace_id TEXT, user_id TEXT REFERENCES "user" (id) ON DELETE CASCADE, role TEXT);
  CREATE TABLE user_profile (user_id TEXT PRIMARY KEY REFERENCES "user" (id) ON DELETE CASCADE, job_role TEXT);
  CREATE TABLE handoff_comment (id TEXT, created_by_user_id TEXT REFERENCES "user" (id) ON DELETE RESTRICT);
  CREATE TABLE handoff (id TEXT PRIMARY KEY, workspace_id TEXT, created_by_user_id TEXT, created_at TEXT);
  CREATE TABLE handoff_version (id TEXT PRIMARY KEY, handoff_id TEXT, created_at TEXT);
  CREATE TABLE IF NOT EXISTS handoff_version_snapshot (version_id TEXT PRIMARY KEY, encoding TEXT NOT NULL, compressed BYTEA NOT NULL, raw_bytes INTEGER NOT NULL, frame_index TEXT NOT NULL);
  CREATE TABLE handoff_invite (id TEXT PRIMARY KEY, workspace_id TEXT, handoff_id TEXT, email TEXT, token_hash TEXT, expires_at TEXT,
    revoked_at TEXT, invited_by_user_id TEXT, created_at TEXT, role TEXT, UNIQUE (handoff_id, email));
  CREATE TABLE IF NOT EXISTS project_member (project_id TEXT, workspace_id TEXT, email TEXT, role TEXT, added_by_user_id TEXT, created_at TEXT);
  CREATE TABLE handoff_view (user_id TEXT REFERENCES "user" (id) ON DELETE CASCADE, workspace_id TEXT, handoff_id TEXT,
    last_seen_version_id TEXT, seen_at TEXT, PRIMARY KEY (user_id, handoff_id));
`);
for (const [id, created] of [["h1", "2026-01-01"], ["h2", "2026-01-02"], ["h3", "2026-01-03"]]) {
  await database.prepare("INSERT INTO handoff VALUES (?, 'ws', 'owner', ?)").run(id, created);
  await database.prepare("INSERT INTO handoff_version VALUES (?, ?, ?)").run(`${id}-v1`, id, created);
}
await database.prepare("INSERT INTO handoff VALUES ('empty', 'ws', 'owner', '2026-01-04')").run();
await database.prepare(`INSERT INTO "user" (id, name, email, emailVerified) VALUES ('owner', 'Owner', 'owner@gmail.com', true)`).run();

const { createDevTestAccount, deleteDevTestAccounts, isDevTestAccount } = await import("./dev-test-accounts.ts");
const { viewAsModeFor } = await import("../auth-session.ts");

after(async () => {
  if (priorDomains === undefined) delete process.env.ASBIR_ALLOWED_EMAIL_DOMAINS;
  else process.env.ASBIR_ALLOWED_EMAIL_DOMAINS = priorDomains;
  if (priorAuthUrl === undefined) delete process.env.BETTER_AUTH_URL;
  else process.env.BETTER_AUTH_URL = priorAuthUrl;
  await fixture.close();
});

test("fresh accounts are verified company accounts with no workspace or role", async () => {
  const user = await createDevTestAccount();
  assert.ok(isDevTestAccount(user.id));
  assert.match(user.email, /@lmf\.ventures$/);
  assert.equal(viewAsModeFor(user), "test");
  const row = await database.prepare('SELECT emailVerified FROM "user" WHERE id = ?').get(user.id);
  assert.equal(row.emailVerified, true);
  assert.equal((await database.prepare("SELECT COUNT(*) AS n FROM workspace_membership WHERE user_id = ?").get(user.id)).n, 0);

  // Sample handoffs (with versions) are shared, about half already opened.
  const invites = (await database.prepare("SELECT handoff_id FROM handoff_invite WHERE email = ? ORDER BY handoff_id").all(user.email)).map((row) => row.handoff_id);
  assert.deepEqual(invites, ["h1", "h2", "h3"]);
  assert.equal((await database.prepare("SELECT COUNT(*) AS n FROM handoff_view WHERE user_id = ?").get(user.id)).n, 1);
});

test("cleanup removes test accounts, keeps ones with history but strips their access, never touches real users", async () => {
  const withHistory = await createDevTestAccount({ name: "Has Comments" });
  await database.prepare("INSERT INTO workspace_membership VALUES ('ws', ?, 'developer')").run(withHistory.id);
  await database.prepare("INSERT INTO handoff_comment VALUES ('c1', ?)").run(withHistory.id);

  const result = await deleteDevTestAccounts();
  assert.deepEqual(result, { deleted: 1, kept: 1 });
  assert.equal((await database.prepare("SELECT COUNT(*) AS n FROM handoff_invite").get()).n, 0);
  assert.equal((await database.prepare("SELECT COUNT(*) AS n FROM workspace_membership WHERE user_id = ?").get(withHistory.id)).n, 0);
  assert.ok(await database.prepare(`SELECT 1 FROM "user" WHERE id = 'owner'`).get());
});
