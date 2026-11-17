import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createPostgresTestFixture } from "../test-support/postgres-test-fixture.mjs";

const fixture = await createPostgresTestFixture();
const { database, pool } = fixture;

await pool.query(`
  CREATE TABLE "user" (id TEXT PRIMARY KEY, name TEXT, email TEXT);
  CREATE TABLE workspace (id TEXT PRIMARY KEY, name TEXT, created_at TEXT);
  CREATE TABLE workspace_membership (workspace_id TEXT, user_id TEXT, role TEXT, created_at TEXT, PRIMARY KEY (workspace_id, user_id));
  CREATE TABLE superadmin (email TEXT PRIMARY KEY, invited_by_user_id TEXT, created_at TEXT NOT NULL);
  CREATE UNIQUE INDEX superadmin_email_nocase_unique ON superadmin (lower(email));
`);
await database.prepare(`INSERT INTO "user" VALUES ('owner', 'Owner', 'owner@gmail.com'), ('ken', 'Ken', 'Ken@lmf.ventures')`).run();
await database.prepare("INSERT INTO workspace VALUES ('ws-1', 'One', '2026-01-01'), ('ws-2', 'Two', '2026-01-02')").run();
await database.prepare("INSERT INTO workspace_membership VALUES ('ws-1', 'owner', 'owner', '2026-01-01'), ('ws-2', 'ken', 'reviewer', '2026-01-02')").run();
await database.prepare("INSERT INTO superadmin VALUES ('owner@gmail.com', NULL, '2026-01-01')").run();

const { addSuperadmin, addSuperadminsToWorkspace, isSuperadmin, listSuperadmins, removeSuperadmin, syncSuperadminAccess } = await import("./superadmins.ts");

after(async () => fixture.close());

const roles = async (userId) =>
  Object.fromEntries((await database.prepare("SELECT workspace_id, role FROM workspace_membership WHERE user_id = ?").all(userId)).map((row) => [row.workspace_id, row.role]));

test("a super admin owns every workspace once synced", async () => {
  assert.equal(await syncSuperadminAccess({ id: "owner", email: "owner@gmail.com" }), true);
  assert.deepEqual(await roles("owner"), { "ws-1": "owner", "ws-2": "owner" });
});

test("adding an existing user upgrades them to owner everywhere, matching email case-insensitively", async () => {
  assert.equal(await isSuperadmin("ken@lmf.ventures"), false);
  await addSuperadmin(" KEN@lmf.ventures ", "owner");
  assert.equal(await isSuperadmin("Ken@LMF.ventures"), true);
  assert.deepEqual(await roles("ken"), { "ws-1": "owner", "ws-2": "owner" });
});

test("new workspaces include every super admin with an account", async () => {
  await database.prepare("INSERT INTO workspace VALUES ('ws-3', 'Three', '2026-01-03')").run();
  await addSuperadminsToWorkspace("ws-3");
  assert.equal((await roles("owner"))["ws-3"], "owner");
  assert.equal((await roles("ken"))["ws-3"], "owner");
});

test("people invited before signing in show as invited; removal only touches the list", async () => {
  await addSuperadmin("new@lmf.ventures", "owner");
  const invited = (await listSuperadmins()).find((admin) => admin.email === "new@lmf.ventures");
  assert.equal(invited.hasSignedIn, false);
  assert.equal(await syncSuperadminAccess({ id: "nobody", email: "someone@else.com" }), false);

  assert.equal(await removeSuperadmin("ken@lmf.ventures"), true);
  assert.equal(await isSuperadmin("ken@lmf.ventures"), false);
  assert.equal((await roles("ken"))["ws-1"], "owner");
});
