import assert from "node:assert/strict";
import Database from "better-sqlite3";
import test, { after } from "node:test";

const priorDatabase = globalThis.__asbirDatabase;
const database = new Database(":memory:");
globalThis.__asbirDatabase = database;

database.exec(`
  CREATE TABLE "user" (id TEXT PRIMARY KEY, name TEXT, email TEXT);
  CREATE TABLE workspace (id TEXT PRIMARY KEY, name TEXT, created_at TEXT);
  CREATE TABLE workspace_membership (workspace_id TEXT, user_id TEXT, role TEXT, created_at TEXT, PRIMARY KEY (workspace_id, user_id));
  CREATE TABLE superadmin (email TEXT PRIMARY KEY COLLATE NOCASE, invited_by_user_id TEXT, created_at TEXT NOT NULL);
`);
database.prepare(`INSERT INTO "user" VALUES ('owner', 'Owner', 'owner@gmail.com'), ('ken', 'Ken', 'Ken@lmf.ventures')`).run();
database.prepare("INSERT INTO workspace VALUES ('ws-1', 'One', '2026-01-01'), ('ws-2', 'Two', '2026-01-02')").run();
database.prepare("INSERT INTO workspace_membership VALUES ('ws-1', 'owner', 'owner', '2026-01-01'), ('ws-2', 'ken', 'reviewer', '2026-01-02')").run();
database.prepare("INSERT INTO superadmin VALUES ('owner@gmail.com', NULL, '2026-01-01')").run();

const { addSuperadmin, addSuperadminsToWorkspace, isSuperadmin, listSuperadmins, removeSuperadmin, syncSuperadminAccess } = await import("./superadmins.ts");

after(() => {
  globalThis.__asbirDatabase = priorDatabase;
  database.close();
});

const roles = (userId) =>
  Object.fromEntries(database.prepare("SELECT workspace_id, role FROM workspace_membership WHERE user_id = ?").all(userId).map((row) => [row.workspace_id, row.role]));

test("a super admin owns every workspace once synced", () => {
  assert.equal(syncSuperadminAccess({ id: "owner", email: "owner@gmail.com" }), true);
  assert.deepEqual(roles("owner"), { "ws-1": "owner", "ws-2": "owner" });
});

test("adding an existing user upgrades them to owner everywhere, matching email case-insensitively", () => {
  assert.equal(isSuperadmin("ken@lmf.ventures"), false);
  addSuperadmin(" KEN@lmf.ventures ", "owner");
  assert.equal(isSuperadmin("Ken@LMF.ventures"), true);
  assert.deepEqual(roles("ken"), { "ws-1": "owner", "ws-2": "owner" });
});

test("new workspaces include every super admin with an account", () => {
  database.prepare("INSERT INTO workspace VALUES ('ws-3', 'Three', '2026-01-03')").run();
  addSuperadminsToWorkspace("ws-3");
  assert.equal(roles("owner")["ws-3"], "owner");
  assert.equal(roles("ken")["ws-3"], "owner");
});

test("people invited before signing in show as invited; removal only touches the list", () => {
  addSuperadmin("new@lmf.ventures", "owner");
  const invited = listSuperadmins().find((admin) => admin.email === "new@lmf.ventures");
  assert.equal(invited.hasSignedIn, false);
  assert.equal(syncSuperadminAccess({ id: "nobody", email: "someone@else.com" }), false);

  assert.equal(removeSuperadmin("ken@lmf.ventures"), true);
  assert.equal(isSuperadmin("ken@lmf.ventures"), false);
  assert.equal(roles("ken")["ws-1"], "owner");
});
