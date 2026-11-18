import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createPostgresTestFixture } from "../test-support/postgres-test-fixture.mjs";

const fixture = await createPostgresTestFixture();
const { database, pool } = fixture;

await pool.query(`
  CREATE TABLE workspace (id TEXT PRIMARY KEY, name TEXT NOT NULL);
  CREATE TABLE project (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL, pd_in_charge_user_id TEXT);
  CREATE TABLE handoff (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE handoff_version (id TEXT PRIMARY KEY, handoff_id TEXT NOT NULL, version_label TEXT NOT NULL, created_at TEXT NOT NULL, created_by_user_id TEXT, snapshot_json TEXT);
  CREATE TABLE "user" (id TEXT PRIMARY KEY, name TEXT NOT NULL, image TEXT);
  CREATE TABLE IF NOT EXISTS user_presence (user_id TEXT PRIMARY KEY, last_seen_at TIMESTAMPTZ);
  CREATE TABLE handoff_view (user_id TEXT, workspace_id TEXT, handoff_id TEXT, last_seen_version_id TEXT, seen_at TEXT, PRIMARY KEY (user_id, handoff_id));
  CREATE TABLE handoff_asset (handoff_version_id TEXT, asset_key TEXT, object_key TEXT, content_type TEXT, width INTEGER, height INTEGER);
  CREATE TABLE project_icon (project_id TEXT PRIMARY KEY, sha256 TEXT);
`);

await database.prepare("INSERT INTO workspace VALUES ('ws', 'Asbir Tech')").run();
await database.prepare("INSERT INTO project VALUES ('p', 'ws', 'Tripket Mobile App', NULL)").run();
await database.prepare("INSERT INTO handoff VALUES ('h', 'ws', 'p', 'Tripket Compare Preview', '2026-11-17T00:00:00.000Z')").run();
await database.prepare("INSERT INTO \"user\" VALUES ('designer', 'Designer', NULL)").run();
await database.prepare("INSERT INTO handoff_version VALUES ('v', 'h', 'Tripket 2.0.5', '2026-11-17T00:00:00.000Z', 'designer', '{}')").run();
await database.prepare("INSERT INTO handoff_asset VALUES (?, ?, ?, 'image/png', 375, 812)").run("v", "overview.png", "asset-overview");
await database.prepare("INSERT INTO handoff_asset VALUES (?, ?, ?, 'image/png', 375, 812)").run("v", "screen-frame-10-render.png", "asset-frame-10");
await database.prepare("INSERT INTO handoff_asset VALUES (?, ?, ?, 'image/png', 375, 812)").run("v", "screen-frame-2-render.png", "asset-frame-2");

const { listViewerHome } = await import("./review-visibility.ts");

after(async () => fixture.close());

test("lists the reviewer home using PostgreSQL-compatible Figma frame preview ordering", async () => {
  const home = await listViewerHome("ws", { id: "riley", email: "reviewer@asbir.invalid", role: "owner" });

  assert.equal(home.length, 1);
  assert.equal(home[0].projectName, "Tripket Mobile App");
  assert.equal(home[0].handoffs[0].handoffName, "Tripket Compare Preview");
  assert.equal(home[0].handoffs[0].versionLabel, "Tripket 2.0.5");
  assert.equal(home[0].handoffs[0].previewUrl, "/api/assets/asset-frame-2");
});

test("an asset key with a very long frame number does not break the reviewer home", async () => {
  await database.prepare("INSERT INTO handoff_asset VALUES (?, ?, ?, 'image/png', 375, 812)").run("v", "screen-frame-123456789012-render.png", "asset-frame-huge");
  try {
    const home = await listViewerHome("ws", { id: "riley", email: "reviewer@asbir.invalid", role: "owner" });
    assert.equal(home[0].handoffs[0].previewUrl, "/api/assets/asset-frame-2");
  } finally {
    await database.prepare("DELETE FROM handoff_asset WHERE object_key = 'asset-frame-huge'").run();
  }
});
