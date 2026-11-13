import assert from "node:assert/strict";
import Database from "better-sqlite3";
import test, { after } from "node:test";

const priorDatabase = globalThis.__asbirDatabase;
const priorSecret = process.env.BETTER_AUTH_SECRET;
const priorBaseUrl = process.env.BETTER_AUTH_URL;
const database = new Database(":memory:");
database.pragma("foreign_keys = ON");
globalThis.__asbirDatabase = database;
process.env.BETTER_AUTH_SECRET ??= "asbir-handoff-sharing-route-test-secret-over-thirty-two-bytes";
process.env.BETTER_AUTH_URL = "http://localhost:3000";

database.exec(`
  CREATE TABLE workspace_membership (
    workspace_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, user_id)
  );
  CREATE TABLE project (id TEXT NOT NULL, workspace_id TEXT NOT NULL, PRIMARY KEY (id, workspace_id));
  CREATE TABLE handoff (
    id TEXT NOT NULL PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    review_share_id TEXT,
    published_version_id TEXT,
    published_at TEXT,
    published_by_user_id TEXT,
    sharing_mode TEXT NOT NULL
  );
  CREATE TABLE handoff_invite (
    id TEXT NOT NULL PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    handoff_id TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'exec',
    token_hash TEXT NOT NULL,
    expires_at TEXT,
    revoked_at TEXT,
    invited_by_user_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE "user" (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    emailVerified INTEGER NOT NULL DEFAULT 0,
    image TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  CREATE TABLE session (
    id TEXT PRIMARY KEY,
    expiresAt TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    ipAddress TEXT,
    userAgent TEXT,
    userId TEXT NOT NULL
  );
  CREATE TABLE account (
    id TEXT PRIMARY KEY,
    accountId TEXT NOT NULL,
    providerId TEXT NOT NULL,
    userId TEXT NOT NULL,
    accessToken TEXT,
    refreshToken TEXT,
    idToken TEXT,
    accessTokenExpiresAt TEXT,
    refreshTokenExpiresAt TEXT,
    scope TEXT,
    password TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  CREATE TABLE verification (
    id TEXT PRIMARY KEY,
    identifier TEXT NOT NULL,
    value TEXT NOT NULL,
    expiresAt TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
`);

const workspaceId = "00000000-0000-4000-8000-000000000001";
const projectId = "10000000-0000-4000-8000-000000000001";
const handoffId = "20000000-0000-4000-8000-000000000001";
const publicShareId = "public-share-before-revoke";
const now = "2026-11-11T12:00:00.000Z";

database.prepare("INSERT INTO project (id, workspace_id) VALUES (?, ?)").run(projectId, workspaceId);
database.prepare("INSERT INTO workspace_membership (workspace_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)")
  .run(workspaceId, "owner-id", now);
database.prepare(`INSERT INTO handoff
  (id, workspace_id, project_id, name, created_at, review_share_id, published_version_id, published_at, published_by_user_id, sharing_mode)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'anyone')`)
  .run(handoffId, workspaceId, projectId, "Test handoff", now, publicShareId, "version-1", now, "owner-id");
database.prepare(`INSERT INTO handoff_invite
  (id, workspace_id, handoff_id, email, token_hash, expires_at, revoked_at, invited_by_user_id, created_at)
  VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)`)
  .run("invite-1", workspaceId, handoffId, "qa@example.com", "token-hash", "owner-id", now);

const { auth } = await import("@/src/server/auth.ts");
const originalGetSession = auth.api.getSession;
let currentSession = { user: { id: "owner-id", email: "owner@example.com" } };
auth.api.getSession = async () => currentSession;
const { PATCH: updateSharing } = await import("./route.ts");

function request(body) {
  return new Request(`http://localhost:3000/api/workspaces/${workspaceId}/projects/${projectId}/handoffs/${handoffId}/sharing`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const context = { params: Promise.resolve({ workspaceId, projectId, handoffId }) };

after(() => {
  auth.api.getSession = originalGetSession;
  database.close();
  if (priorDatabase === undefined) delete globalThis.__asbirDatabase;
  else globalThis.__asbirDatabase = priorDatabase;
  if (priorSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
  else process.env.BETTER_AUTH_SECRET = priorSecret;
  if (priorBaseUrl === undefined) delete process.env.BETTER_AUTH_URL;
  else process.env.BETTER_AUTH_URL = priorBaseUrl;
});

test("revoking a public link invalidates the old URL and outstanding invitations", async () => {
  const response = await updateSharing(request({ mode: "workspace", revokePublicLink: true }), context);
  const payload = await response.json();
  const handoff = database.prepare("SELECT review_share_id AS reviewShareId, sharing_mode AS mode FROM handoff WHERE id = ?").get(handoffId);
  const invite = database.prepare("SELECT revoked_at AS revokedAt FROM handoff_invite WHERE id = ?").get("invite-1");

  assert.equal(response.status, 200);
  assert.equal(handoff.mode, "workspace");
  assert.notEqual(handoff.reviewShareId, publicShareId);
  assert.equal(invite.revokedAt !== null, true);
  assert.equal(payload.reviewUrl, `http://localhost:3000/review/${handoff.reviewShareId}`);
  assert.deepEqual(payload.invites, []);

  await updateSharing(request({ mode: "anyone" }), context);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM handoff WHERE review_share_id = ?").get(publicShareId).count, 0);
  assert.equal(database.prepare("SELECT revoked_at FROM handoff_invite WHERE id = ?").get("invite-1").revoked_at !== null, true);
});

test("reviewers cannot rotate a handoff share URL", async () => {
  const previousShareId = database.prepare("SELECT review_share_id AS id FROM handoff WHERE id = ?").get(handoffId).id;
  currentSession = { user: { id: "qa-id", email: "qa@example.com" } };
  database.prepare("INSERT INTO workspace_membership (workspace_id, user_id, role, created_at) VALUES (?, ?, 'qa', ?)")
    .run(workspaceId, "qa-id", now);

  const response = await updateSharing(request({ mode: "workspace", revokePublicLink: true }), context);

  assert.equal(response.status, 403);
  assert.equal(database.prepare("SELECT review_share_id AS id FROM handoff WHERE id = ?").get(handoffId).id, previousShareId);
});
