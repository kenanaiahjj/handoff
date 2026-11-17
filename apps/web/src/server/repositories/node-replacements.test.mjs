import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { after } from "node:test";
import { createPostgresTestFixture } from "../test-support/postgres-test-fixture.mjs";

const fixture = await createPostgresTestFixture();
const { database, pool } = fixture;
await pool.query(`
  CREATE TABLE "user" (id TEXT PRIMARY KEY);
  CREATE TABLE handoff (
    id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    PRIMARY KEY (id, workspace_id)
  );
  CREATE TABLE handoff_version (
    id TEXT NOT NULL PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    handoff_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (id, workspace_id),
    FOREIGN KEY (handoff_id, workspace_id) REFERENCES handoff (id, workspace_id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS handoff_version_snapshot (version_id TEXT PRIMARY KEY, encoding TEXT NOT NULL, compressed BYTEA NOT NULL, raw_bytes INTEGER NOT NULL, frame_index TEXT NOT NULL);
`);
await pool.query(readFileSync(new URL("../migrations/0013_node_replacements.sql", import.meta.url), "utf8"));

await database.prepare('INSERT INTO "user" (id) VALUES (?)').run("designer-1");
await database.prepare("INSERT INTO handoff (id, workspace_id) VALUES (?, ?)").run("handoff-1", "workspace-1");
await database.prepare("INSERT INTO handoff_version (id, workspace_id, handoff_id, created_at) VALUES (?, ?, ?, ?)")
  .run("version-1", "workspace-1", "handoff-1", "2026-11-10T10:00:00.000Z");
await database.prepare("INSERT INTO handoff_version (id, workspace_id, handoff_id, created_at) VALUES (?, ?, ?, ?)")
  .run("version-2", "workspace-1", "handoff-1", "2026-11-10T11:00:00.000Z");

const versions = await import("./versions.ts");

after(async () => fixture.close());

const replacement = {
  workspaceId: "workspace-1",
  handoffId: "handoff-1",
  baselineVersionId: "version-1",
  newVersionId: "version-2",
  beforeFrameId: "frame-before",
  afterFrameId: "frame-after",
  beforeNodeId: "node-before",
  afterNodeId: "node-after",
};

test("persists and resolves a reviewer-confirmed layer match for a version pair", async () => {
  assert.equal(typeof versions.createConfirmedNodeReplacementMatch, "function");
  assert.equal(typeof versions.getConfirmedNodeMatchesBetweenVersions, "function");

  assert.equal(await versions.createConfirmedNodeReplacementMatch({
    ...replacement,
    confirmedByUserId: "designer-1",
  }), "created");
  assert.deepEqual(await versions.getConfirmedNodeMatchesBetweenVersions({
    workspaceId: "workspace-1",
    handoffId: "handoff-1",
    from: { id: "version-1" },
    to: { id: "version-2" },
  }), [{
    beforeFrameId: "frame-before",
    afterFrameId: "frame-after",
    beforeNodeId: "node-before",
    afterNodeId: "node-after",
  }]);
  assert.deepEqual(await versions.getConfirmedNodeMatchesBetweenVersions({
    workspaceId: "workspace-1",
    handoffId: "handoff-1",
    from: { id: "version-2" },
    to: { id: "version-1" },
  }), [{
    beforeFrameId: "frame-after",
    afterFrameId: "frame-before",
    beforeNodeId: "node-after",
    afterNodeId: "node-before",
  }]);
});

test("keeps a confirmed layer match idempotent and rejects conflicting matches", async () => {
  const { createConfirmedNodeReplacementMatch, NodeReplacementConflictError } = versions;
  assert.equal(await createConfirmedNodeReplacementMatch({
    ...replacement,
    confirmedByUserId: "designer-1",
  }), "already-confirmed");

  await assert.rejects(createConfirmedNodeReplacementMatch({
    ...replacement,
    afterNodeId: "different-after-node",
    confirmedByUserId: "designer-1",
  }), NodeReplacementConflictError);
});
