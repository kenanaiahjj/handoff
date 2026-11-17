import assert from "node:assert/strict";
import Database from "better-sqlite3";
import test, { after, beforeEach } from "node:test";

const priorDatabase = globalThis.__asbirDatabase;
const database = new Database(":memory:");
globalThis.__asbirDatabase = database;

database.exec(`
  CREATE TABLE "user" (id TEXT PRIMARY KEY, name TEXT, email TEXT);
  CREATE TABLE workspace_membership (workspace_id TEXT, user_id TEXT, role TEXT, created_at TEXT, PRIMARY KEY (workspace_id, user_id));
  CREATE TABLE user_profile (user_id TEXT PRIMARY KEY, job_role TEXT, onboarded_at TEXT, requested_role TEXT);
  CREATE TABLE superadmin (email TEXT PRIMARY KEY COLLATE NOCASE, invited_by_user_id TEXT, created_at TEXT);
  CREATE TABLE handoff_invite (id TEXT, workspace_id TEXT, email TEXT, revoked_at TEXT);
  CREATE TABLE project (id TEXT, workspace_id TEXT, pd_in_charge_user_id TEXT);
  CREATE TABLE viewer_pin (user_id TEXT, kind TEXT, target_id TEXT, created_at TEXT);
  CREATE TABLE comment_mention (comment_id TEXT, user_id TEXT, workspace_id TEXT, done_at TEXT);
`);

const { changeMemberRole, declineDesignerRequest, hasPendingDesignerRequest, listMembers, removeMember } = await import("./members.ts");

after(() => {
  globalThis.__asbirDatabase = priorDatabase;
  database.close();
});

beforeEach(() => {
  for (const table of ['"user"', "workspace_membership", "user_profile", "superadmin", "handoff_invite", "project", "viewer_pin", "comment_mention"]) {
    database.prepare(`DELETE FROM ${table}`).run();
  }
  database.prepare(`INSERT INTO "user" VALUES ('owner', 'Olive', 'olive@lmf.ventures'), ('admin', 'Ada', 'ada@gmail.com'), ('dee', 'Dee', 'dee@lmf.ventures'), ('riley', 'Riley', 'riley@lmf.ventures')`).run();
  database.prepare("INSERT INTO workspace_membership VALUES ('ws', 'owner', 'owner', 't'), ('ws', 'admin', 'owner', 't'), ('ws', 'dee', 'reviewer', 't'), ('ws', 'riley', 'reviewer', 't')").run();
  database.prepare("INSERT INTO user_profile VALUES ('dee', 'designer', 't', 'designer'), ('riley', 'pm', 't', NULL)").run();
  database.prepare("INSERT INTO superadmin VALUES ('ada@gmail.com', NULL, 't')").run();
});

const roleOf = (userId) => database.prepare("SELECT role FROM workspace_membership WHERE user_id = ?").get(userId)?.role;

test("an owner approves a designer request by giving designer access", () => {
  assert.equal(hasPendingDesignerRequest("dee"), true);
  assert.equal(listMembers("ws")[0].id, "dee", "pending requests are listed first");
  changeMemberRole({ workspaceId: "ws", actorId: "owner", userId: "dee", role: "designer" });
  assert.equal(roleOf("dee"), "designer");
  assert.equal(hasPendingDesignerRequest("dee"), false);
});

test("declining keeps the person as a reviewer and clears the request", () => {
  declineDesignerRequest({ workspaceId: "ws", actorId: "owner", userId: "dee" });
  assert.equal(roleOf("dee"), "reviewer");
  assert.equal(hasPendingDesignerRequest("dee"), false);
});

test("owners can't edit themselves or leave the team without an owner", () => {
  assert.throws(() => changeMemberRole({ workspaceId: "ws", actorId: "owner", userId: "owner", role: "qa" }), /your own access/);
  assert.throws(() => changeMemberRole({ workspaceId: "ws", actorId: "owner", userId: "missing", role: "qa" }), /isn't on the team/);

  // Ada was added as an owner by email; she is an ordinary owner and can be demoted. Demoting her
  // also drops her from that list, so she isn't made owner again on her next visit.
  changeMemberRole({ workspaceId: "ws", actorId: "owner", userId: "admin", role: "designer" });
  assert.equal(roleOf("admin"), "designer");
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM superadmin").get().n, 0);

  // Olive is now the only owner: she can't be demoted or removed.
  assert.throws(() => changeMemberRole({ workspaceId: "ws", actorId: "admin", userId: "owner", role: "designer" }), /at least one owner/);
  assert.throws(() => removeMember({ workspaceId: "ws", actorId: "admin", userId: "owner" }), /at least one owner/);
  changeMemberRole({ workspaceId: "ws", actorId: "owner", userId: "admin", role: "owner" });
});

test("removing someone revokes their shares, PD role, pins and open mentions", () => {
  database.prepare("INSERT INTO handoff_invite VALUES ('i1', 'ws', 'Riley@lmf.ventures', NULL)").run();
  database.prepare("INSERT INTO project VALUES ('p', 'ws', 'riley')").run();
  database.prepare("INSERT INTO viewer_pin VALUES ('riley', 'project', 'p', 't')").run();
  database.prepare("INSERT INTO comment_mention VALUES ('c', 'riley', 'ws', NULL)").run();

  removeMember({ workspaceId: "ws", actorId: "owner", userId: "riley" });
  assert.equal(roleOf("riley"), undefined);
  assert.ok(database.prepare("SELECT revoked_at FROM handoff_invite").get().revoked_at);
  assert.equal(database.prepare("SELECT pd_in_charge_user_id AS pd FROM project").get().pd, null);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM viewer_pin").get().n, 0);
  assert.ok(database.prepare("SELECT done_at FROM comment_mention").get().done_at);
});
