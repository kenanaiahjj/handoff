import assert from "node:assert/strict";
import Database from "better-sqlite3";
import test, { after } from "node:test";

const priorDatabase = globalThis.__asbirDatabase;
const database = new Database(":memory:");
globalThis.__asbirDatabase = database;

database.exec(`
  CREATE TABLE workspace_membership (workspace_id TEXT, user_id TEXT, role TEXT);
  CREATE TABLE project (id TEXT PRIMARY KEY, workspace_id TEXT);
  CREATE TABLE viewer_pin (user_id TEXT, kind TEXT, target_id TEXT, created_at TEXT, PRIMARY KEY (user_id, kind, target_id));
`);
database.prepare("INSERT INTO workspace_membership VALUES ('ws-1', 'riley', 'reviewer')").run();
database.prepare("INSERT INTO project VALUES ('p-1', 'ws-1'), ('p-other', 'ws-2')").run();

const { canPin, listPinKeys, setPinned } = await import("./viewer-pins.ts");

after(() => {
  globalThis.__asbirDatabase = priorDatabase;
  database.close();
});

test("people can only pin workspaces and projects they belong to", () => {
  assert.equal(canPin("riley", "workspace", "ws-1"), true);
  assert.equal(canPin("riley", "workspace", "ws-2"), false);
  assert.equal(canPin("riley", "project", "p-1"), true);
  assert.equal(canPin("riley", "project", "p-other"), false);
});

test("pins keep their order, ignore repeats and can be removed", async () => {
  setPinned("riley", "project", "p-1", true);
  await new Promise((resolve) => setTimeout(resolve, 2));
  setPinned("riley", "workspace", "ws-1", true);
  setPinned("riley", "project", "p-1", true);
  assert.deepEqual(listPinKeys("riley"), ["project:p-1", "workspace:ws-1"]);

  setPinned("riley", "project", "p-1", false);
  assert.deepEqual(listPinKeys("riley"), ["workspace:ws-1"]);
});
