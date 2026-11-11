import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import test, { after } from "node:test";

const priorDatabase = globalThis.__asbirDatabase;
const database = new Database(":memory:");
database.pragma("foreign_keys = ON");
database.exec(`
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
`);
database.exec(readFileSync(new URL("../migrations/0013_node_replacements.sql", import.meta.url), "utf8"));
globalThis.__asbirDatabase = database;

database.prepare('INSERT INTO "user" (id) VALUES (?)').run("designer-1");
database.prepare("INSERT INTO handoff (id, workspace_id) VALUES (?, ?)").run("handoff-1", "workspace-1");
database.prepare("INSERT INTO handoff_version (id, workspace_id, handoff_id, created_at) VALUES (?, ?, ?, ?)")
  .run("version-1", "workspace-1", "handoff-1", "2026-11-10T10:00:00.000Z");
database.prepare("INSERT INTO handoff_version (id, workspace_id, handoff_id, created_at) VALUES (?, ?, ?, ?)")
  .run("version-2", "workspace-1", "handoff-1", "2026-11-10T11:00:00.000Z");

const versions = await import("./versions.ts");

after(() => {
  database.close();
  if (priorDatabase === undefined) delete globalThis.__asbirDatabase;
  else globalThis.__asbirDatabase = priorDatabase;
});

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

test("persists and resolves a reviewer-confirmed layer match for a version pair", () => {
  assert.equal(typeof versions.createConfirmedNodeReplacementMatch, "function");
  assert.equal(typeof versions.getConfirmedNodeMatchesBetweenVersions, "function");

  assert.equal(versions.createConfirmedNodeReplacementMatch({
    ...replacement,
    confirmedByUserId: "designer-1",
  }), "created");
  assert.deepEqual(versions.getConfirmedNodeMatchesBetweenVersions({
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
  assert.deepEqual(versions.getConfirmedNodeMatchesBetweenVersions({
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

test("keeps a confirmed layer match idempotent and rejects conflicting matches", () => {
  const { createConfirmedNodeReplacementMatch, NodeReplacementConflictError } = versions;
  assert.equal(createConfirmedNodeReplacementMatch({
    ...replacement,
    confirmedByUserId: "designer-1",
  }), "already-confirmed");

  assert.throws(() => createConfirmedNodeReplacementMatch({
    ...replacement,
    afterNodeId: "different-after-node",
    confirmedByUserId: "designer-1",
  }), NodeReplacementConflictError);
});
