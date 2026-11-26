import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import { createPostgresTestFixture } from "../test-support/postgres-test-fixture.mjs";

const fixture = await createPostgresTestFixture();
const { database, pool } = fixture;

await pool.query(`
  CREATE TABLE "user" (id TEXT PRIMARY KEY, name TEXT, email TEXT, image TEXT);
  CREATE TABLE user_about (user_id TEXT PRIMARY KEY, title TEXT, department TEXT);
  CREATE TABLE workspace (id TEXT PRIMARY KEY);
  INSERT INTO workspace VALUES ('ws');
  CREATE TABLE workspace_membership (workspace_id TEXT, user_id TEXT, role TEXT, created_at TEXT, PRIMARY KEY (workspace_id, user_id));
  CREATE TABLE user_profile (user_id TEXT PRIMARY KEY, job_role TEXT, onboarded_at TEXT, requested_role TEXT);
  CREATE TABLE superadmin (email TEXT PRIMARY KEY, invited_by_user_id TEXT, created_at TEXT);
  CREATE UNIQUE INDEX superadmin_email_nocase_unique ON superadmin (lower(email));
  CREATE TABLE handoff_invite (id TEXT, workspace_id TEXT, email TEXT, revoked_at TEXT);
  CREATE TABLE IF NOT EXISTS project_member (project_id TEXT, workspace_id TEXT, email TEXT, role TEXT, added_by_user_id TEXT, created_at TEXT);
  CREATE TABLE project (id TEXT, workspace_id TEXT, pd_in_charge_user_id TEXT);
  CREATE TABLE viewer_pin (user_id TEXT, kind TEXT, target_id TEXT, created_at TEXT);
  CREATE TABLE comment_mention (comment_id TEXT, user_id TEXT, workspace_id TEXT, done_at TEXT);
  CREATE TABLE session (id TEXT PRIMARY KEY, "userId" TEXT, "updatedAt" timestamptz);
  CREATE TABLE user_presence (user_id TEXT PRIMARY KEY, last_seen_at timestamptz);
`);

const { changeMemberRole, declineDesignerRequest, hasPendingDesignerRequest, listMembers, removeMember } = await import("./members.ts");

after(async () => fixture.close());

beforeEach(async () => {
  for (const table of ['"user"', "session", "workspace_membership", "user_profile", "superadmin", "handoff_invite", "project", "viewer_pin", "comment_mention"]) {
    await database.prepare(`DELETE FROM ${table}`).run();
  }
  await database.prepare(`INSERT INTO "user" (id, name, email) VALUES ('owner', 'Olive', 'olive@lmf.ventures'), ('admin', 'Ada', 'ada@gmail.com'), ('dee', 'Dee', 'dee@lmf.ventures'), ('riley', 'Riley', 'riley@lmf.ventures')`).run();
  await database.prepare("INSERT INTO workspace_membership VALUES ('ws', 'owner', 'owner', 't'), ('ws', 'admin', 'owner', 't'), ('ws', 'dee', 'reviewer', 't'), ('ws', 'riley', 'reviewer', 't')").run();
  await database.prepare("INSERT INTO user_profile VALUES ('dee', 'designer', 't', 'designer'), ('riley', 'pm', 't', NULL)").run();
  await database.prepare("INSERT INTO superadmin VALUES ('ada@gmail.com', NULL, 't')").run();
});

const roleOf = async (userId) => (await database.prepare("SELECT role FROM workspace_membership WHERE user_id = ?").get(userId))?.role;

test("an owner approves a designer request by giving designer access", async () => {
  assert.equal(await hasPendingDesignerRequest("dee"), true);
  assert.equal((await listMembers("ws"))[0].id, "dee", "pending requests are listed first");
  await changeMemberRole({ workspaceId: "ws", actorId: "owner", userId: "dee", role: "designer" });
  assert.equal(await roleOf("dee"), "designer");
  assert.equal(await hasPendingDesignerRequest("dee"), false);
});

test("declining keeps the person as a reviewer and clears the request", async () => {
  await declineDesignerRequest({ workspaceId: "ws", actorId: "owner", userId: "dee" });
  assert.equal(await roleOf("dee"), "reviewer");
  assert.equal(await hasPendingDesignerRequest("dee"), false);
});

test("owners can't edit themselves or leave the team without an owner", async () => {
  await assert.rejects(changeMemberRole({ workspaceId: "ws", actorId: "owner", userId: "owner", role: "qa" }), /your own access/);
  await assert.rejects(changeMemberRole({ workspaceId: "ws", actorId: "owner", userId: "missing", role: "qa" }), /isn't on the team/);

  // Ada was added as an owner by email; she is an ordinary owner and can be demoted. Demoting her
  // also drops her from that list, so she isn't made owner again on her next visit.
  await changeMemberRole({ workspaceId: "ws", actorId: "owner", userId: "admin", role: "designer" });
  assert.equal(await roleOf("admin"), "designer");
  assert.equal((await database.prepare("SELECT COUNT(*) AS n FROM superadmin").get()).n, 0);

  // Olive is now the only owner: she can't be demoted or removed.
  await assert.rejects(changeMemberRole({ workspaceId: "ws", actorId: "admin", userId: "owner", role: "designer" }), /at least one owner/);
  await assert.rejects(removeMember({ workspaceId: "ws", actorId: "admin", userId: "owner" }), /at least one owner/);
  await changeMemberRole({ workspaceId: "ws", actorId: "owner", userId: "admin", role: "owner" });
});

test("removing someone revokes their shares, PD role, pins and open mentions", async () => {
  await database.prepare("INSERT INTO handoff_invite VALUES ('i1', 'ws', 'Riley@lmf.ventures', NULL)").run();
  await database.prepare("INSERT INTO project VALUES ('p', 'ws', 'riley')").run();
  await database.prepare("INSERT INTO viewer_pin VALUES ('riley', 'project', 'p', 't')").run();
  await database.prepare("INSERT INTO comment_mention VALUES ('c', 'riley', 'ws', NULL)").run();

  await removeMember({ workspaceId: "ws", actorId: "owner", userId: "riley" });
  assert.equal(await roleOf("riley"), undefined);
  assert.ok((await database.prepare("SELECT revoked_at FROM handoff_invite").get()).revoked_at);
  assert.equal((await database.prepare("SELECT pd_in_charge_user_id AS pd FROM project").get()).pd, null);
  assert.equal((await database.prepare("SELECT COUNT(*) AS n FROM viewer_pin").get()).n, 0);
  assert.ok((await database.prepare("SELECT done_at FROM comment_mention").get()).done_at);
});

test("members show when they last used the app, or that they never signed in", async () => {
  await database.prepare(`INSERT INTO session VALUES ('s1', 'riley', '2026-11-01T10:00:00Z'), ('s2', 'riley', '2026-11-17T09:30:00Z')`).run();
  const members = await listMembers("ws");
  assert.equal(members.find((member) => member.id === "riley").lastActiveAt, "2026-11-17T09:30:00.000Z", "the newest session wins");
  assert.equal(members.find((member) => member.id === "dee").lastActiveAt, null);
});

const jobOf = async (userId) => (await database.prepare("SELECT job_role FROM user_profile WHERE user_id = ?").get(userId))?.job_role;

test("picking what someone does sets their access and replaces their onboarding pick", async () => {
  await changeMemberRole({ workspaceId: "ws", actorId: "owner", userId: "riley", jobRole: "dev" });
  assert.equal(await roleOf("riley"), "developer");
  assert.equal(await jobOf("riley"), "dev");

  await changeMemberRole({ workspaceId: "ws", actorId: "owner", userId: "riley", jobRole: "marketing" });
  assert.equal(await roleOf("riley"), "reviewer");
  assert.equal(await jobOf("riley"), "marketing");

  // Making someone an owner keeps what they do.
  await changeMemberRole({ workspaceId: "ws", actorId: "owner", userId: "riley", jobRole: "owner" });
  assert.equal(await roleOf("riley"), "owner");
  assert.equal(await jobOf("riley"), "marketing");
});

test("setting access directly keeps a stale onboarding pick from showing", async () => {
  await database.prepare("UPDATE user_profile SET job_role = 'qa' WHERE user_id = 'riley'").run();
  await changeMemberRole({ workspaceId: "ws", actorId: "owner", userId: "riley", role: "developer" });
  assert.equal(await jobOf("riley"), "dev");
  // Someone with no profile row (an older invite) gets one.
  await changeMemberRole({ workspaceId: "ws", actorId: "owner", userId: "admin", role: "qa" });
  assert.equal(await jobOf("admin"), "qa");
});
