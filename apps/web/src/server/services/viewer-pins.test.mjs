import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createPostgresTestFixture } from "../test-support/postgres-test-fixture.mjs";

const fixture = await createPostgresTestFixture();
const { database, pool } = fixture;

await pool.query(`
  CREATE TABLE workspace_membership (workspace_id TEXT, user_id TEXT, role TEXT);
  CREATE TABLE project (id TEXT PRIMARY KEY, workspace_id TEXT);
  CREATE TABLE viewer_pin (user_id TEXT, kind TEXT, target_id TEXT, created_at TEXT, PRIMARY KEY (user_id, kind, target_id));
`);
await database.prepare("INSERT INTO workspace_membership VALUES ('ws-1', 'riley', 'reviewer')").run();
await database.prepare("INSERT INTO project VALUES ('p-1', 'ws-1'), ('p-other', 'ws-2')").run();

const { canPin, listPinKeys, setPinned } = await import("./viewer-pins.ts");

after(async () => fixture.close());

test("people can only pin workspaces and projects they belong to", async () => {
  assert.equal(await canPin("riley", "workspace", "ws-1"), true);
  assert.equal(await canPin("riley", "workspace", "ws-2"), false);
  assert.equal(await canPin("riley", "project", "p-1"), true);
  assert.equal(await canPin("riley", "project", "p-other"), false);
});

test("pins keep their order, ignore repeats and can be removed", async () => {
  await setPinned("riley", "project", "p-1", true);
  await new Promise((resolve) => setTimeout(resolve, 2));
  await setPinned("riley", "workspace", "ws-1", true);
  await setPinned("riley", "project", "p-1", true);
  assert.deepEqual(await listPinKeys("riley"), ["project:p-1", "workspace:ws-1"]);

  await setPinned("riley", "project", "p-1", false);
  assert.deepEqual(await listPinKeys("riley"), ["workspace:ws-1"]);
});
