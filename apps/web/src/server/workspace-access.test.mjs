import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createPostgresTestFixture } from "./test-support/postgres-test-fixture.mjs";

const fixture = await createPostgresTestFixture();
const { database, pool } = fixture;
process.env.BETTER_AUTH_SECRET ??= "asbir-workspace-access-test-secret-over-thirty-two-bytes";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";

await pool.query(`
  CREATE TABLE "user" (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, "emailVerified" BOOLEAN NOT NULL DEFAULT false, image TEXT, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(), "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now());
  CREATE TABLE account (id TEXT PRIMARY KEY, "accountId" TEXT NOT NULL, "providerId" TEXT NOT NULL, "userId" TEXT NOT NULL, "accessToken" TEXT, "refreshToken" TEXT, "idToken" TEXT, "accessTokenExpiresAt" TIMESTAMPTZ, "refreshTokenExpiresAt" TIMESTAMPTZ, scope TEXT, password TEXT, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(), "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now());
  CREATE TABLE session (id TEXT PRIMARY KEY, "expiresAt" TIMESTAMPTZ NOT NULL, token TEXT NOT NULL UNIQUE, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(), "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(), "ipAddress" TEXT, "userAgent" TEXT, "userId" TEXT NOT NULL);
  CREATE TABLE verification (id TEXT PRIMARY KEY, identifier TEXT NOT NULL, value TEXT NOT NULL, "expiresAt" TIMESTAMPTZ NOT NULL, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(), "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now());
  CREATE TABLE workspace_membership (workspace_id TEXT, user_id TEXT, role TEXT, created_at TEXT);
  CREATE TABLE project (id TEXT, workspace_id TEXT, pd_in_charge_user_id TEXT);
  CREATE TABLE handoff (id TEXT PRIMARY KEY, workspace_id TEXT, project_id TEXT);
  CREATE TABLE handoff_invite (
    id TEXT PRIMARY KEY, workspace_id TEXT, handoff_id TEXT, email TEXT,
    revoked_at TEXT, expires_at TEXT
  );
`);

const workspaceId = "ws-1";
const now = "2026-11-16T00:00:00.000Z";
for (const [userId, role] of [["owner", "owner"], ["designer", "designer"], ["reviewer", "reviewer"], ["lead", "qa"]]) {
  await database.prepare("INSERT INTO workspace_membership VALUES (?, ?, ?, ?)").run(workspaceId, userId, role, now);
}
await database.prepare("INSERT INTO project VALUES (?, ?, ?)").run("project-a", workspaceId, "owner");
await database.prepare("INSERT INTO project VALUES (?, ?, ?)").run("project-b", workspaceId, "lead");
await database.prepare("INSERT INTO handoff VALUES (?, ?, ?)").run("invited", workspaceId, "project-a");
await database.prepare("INSERT INTO handoff VALUES (?, ?, ?)").run("hidden", workspaceId, "project-a");
await database.prepare("INSERT INTO handoff VALUES (?, ?, ?)").run("led", workspaceId, "project-b");
await database.prepare("INSERT INTO handoff_invite VALUES (?, ?, ?, ?, NULL, NULL)").run("i1", workspaceId, "invited", "Reviewer@Example.com");
await database.prepare("INSERT INTO handoff_invite VALUES (?, ?, ?, ?, ?, NULL)").run("i2", workspaceId, "hidden", "reviewer@example.com", now);

const { auth } = await import("@/src/server/auth.ts");
const originalGetSession = auth.api.getSession;
const emails = { owner: "owner@example.com", designer: "designer@example.com", reviewer: "reviewer@example.com", lead: "lead@example.com" };
let currentUser = "owner";
auth.api.getSession = async () => (currentUser ? { user: { id: currentUser, email: emails[currentUser] } } : null);

const { requireWorkspaceRole, requireHandoffAccess, requireProjectMember, managerRoles, WorkspaceAccessError } = await import("./workspace-access.ts");

after(async () => {
  auth.api.getSession = originalGetSession;
  await fixture.close();
});

const request = new Request("http://localhost:3000/api/test");

async function status(promise) {
  try {
    await promise;
    return 200;
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return error.status;
    throw error;
  }
}

test("signed-out and non-member requests are refused", async () => {
  currentUser = null;
  assert.equal(await status(requireWorkspaceRole(request, workspaceId, managerRoles)), 401);
  currentUser = "owner";
  assert.equal(await status(requireWorkspaceRole(request, "other-workspace", managerRoles)), 404);
});

test("only owners and designers pass manager checks", async () => {
  for (const [user, expected] of [["owner", 200], ["designer", 200], ["reviewer", 403], ["lead", 403]]) {
    currentUser = user;
    assert.equal(await status(requireWorkspaceRole(request, workspaceId, managerRoles)), expected, user);
    assert.equal(await status(requireHandoffAccess(request, { workspaceId, handoffId: "invited", manage: true })), expected, user);
    assert.equal(await status(requireProjectMember(request, workspaceId, "project-a", { manage: true })), expected, user);
  }
});

test("reviewers only reach handoffs they are invited to or lead", async () => {
  currentUser = "reviewer";
  assert.equal(await status(requireHandoffAccess(request, { workspaceId, handoffId: "invited" })), 200);
  assert.equal(await status(requireHandoffAccess(request, { workspaceId, handoffId: "hidden" })), 404, "revoked invite");
  assert.equal(await status(requireHandoffAccess(request, { workspaceId, handoffId: "led" })), 404);

  currentUser = "lead";
  assert.equal(await status(requireHandoffAccess(request, { workspaceId, handoffId: "led" })), 200, "PD in charge");
  assert.equal(await status(requireHandoffAccess(request, { workspaceId, handoffId: "invited" })), 404);

  currentUser = "designer";
  assert.equal(await status(requireHandoffAccess(request, { workspaceId, handoffId: "hidden" })), 200);
});

test("reviewers only reach projects holding a handoff shared with them", async () => {
  currentUser = "reviewer";
  assert.equal(await status(requireProjectMember(request, workspaceId, "project-a")), 200);
  assert.equal(await status(requireProjectMember(request, workspaceId, "project-b")), 404);
  assert.equal(await status(requireProjectMember(request, workspaceId, "missing")), 404);
});
