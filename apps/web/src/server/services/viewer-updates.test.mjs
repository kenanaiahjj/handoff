import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createPostgresTestFixture } from "../test-support/postgres-test-fixture.mjs";

const fixture = await createPostgresTestFixture();
const { database, pool } = fixture;

await pool.query(`
  CREATE TABLE workspace_membership (workspace_id TEXT, user_id TEXT, role TEXT);
  CREATE TABLE project (id TEXT, workspace_id TEXT, pd_in_charge_user_id TEXT);
  CREATE TABLE handoff (id TEXT PRIMARY KEY, workspace_id TEXT, project_id TEXT);
  CREATE TABLE handoff_invite (id TEXT, workspace_id TEXT, handoff_id TEXT, email TEXT, revoked_at TEXT, expires_at TEXT);
  CREATE TABLE handoff_version (id TEXT PRIMARY KEY, handoff_id TEXT, snapshot_json TEXT, created_at TEXT);
  CREATE TABLE IF NOT EXISTS handoff_version_snapshot (version_id TEXT PRIMARY KEY, encoding TEXT NOT NULL, compressed BYTEA NOT NULL, raw_bytes INTEGER NOT NULL, frame_index TEXT NOT NULL);
  CREATE TABLE handoff_asset (handoff_version_id TEXT, asset_key TEXT, object_key TEXT);
  CREATE TABLE handoff_view (user_id TEXT, workspace_id TEXT, handoff_id TEXT, last_seen_version_id TEXT, seen_at TEXT, PRIMARY KEY (user_id, handoff_id));
`);

async function version(id, handoffId, createdAt, screens) {
  // Frame ids stay the same when a screen is renamed; names here change to prove ids are used.
  const frames = Object.keys(screens).map((name) => ({ sourceFrameId: `id-${name}`, name: `${name} (${id})`, renderAssetKey: `render-${name}` }));
  await database.prepare("INSERT INTO handoff_version VALUES (?, ?, ?, ?)").run(id, handoffId, JSON.stringify({ frames }), createdAt);
  for (const [name, objectKey] of Object.entries(screens)) {
    await database.prepare("INSERT INTO handoff_asset VALUES (?, ?, ?)").run(id, `render-${name}`, objectKey);
  }
}

await database.prepare("INSERT INTO workspace_membership VALUES ('ws', 'riley', 'reviewer')").run();
await database.prepare("INSERT INTO project VALUES ('p', 'ws', NULL)").run();
await database.prepare("INSERT INTO handoff VALUES ('shared', 'ws', 'p'), ('hidden', 'ws', 'p')").run();
await database.prepare("INSERT INTO handoff_invite VALUES ('i', 'ws', 'shared', 'riley@example.com', NULL, NULL)").run();
await version("v1", "shared", "2026-01-01", { Home: "a", Search: "b", Profile: "c" });
await version("v2", "shared", "2026-01-02", { Home: "a", Search: "B2", Checkout: "d" });
await version("h1", "hidden", "2026-01-01", { Home: "a" });

const { markHandoffsSeenForViewer, screenChangesBetween } = await import("./review-visibility.ts");

after(async () => fixture.close());

test("counts screens changed, added and removed between two versions", async () => {
  assert.deepEqual(await screenChangesBetween("v1", "v2"), { changed: 1, added: 1, removed: 1 });
  assert.deepEqual(await screenChangesBetween("v1", "v1"), { changed: 0, added: 0, removed: 0 });
});

test("mark as seen records the newest version, only for handoffs this person can see", async () => {
  const marked = await markHandoffsSeenForViewer({ id: "riley", email: "riley@example.com" }, ["shared", "hidden", "missing"]);
  assert.equal(marked, 1);
  const rows = await database.prepare("SELECT handoff_id AS handoffId, last_seen_version_id AS seen FROM handoff_view").all();
  assert.deepEqual(rows.map((row) => ({ ...row })), [{ handoffId: "shared", seen: "v2" }]);
});
