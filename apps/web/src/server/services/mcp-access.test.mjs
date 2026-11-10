import assert from "node:assert/strict";
import Database from "better-sqlite3";
import test, { after } from "node:test";
import { createWorkspaceMcpToken, resolveWorkspaceMcpToken } from "../repositories/mcp-tokens.ts";
import { getHandoff } from "../repositories/handoffs.ts";
import { getVersion } from "../repositories/versions.ts";
import { loadHandoff, loadVersion } from "./mcp-access.ts";

const priorDatabase = globalThis.__asbirDatabase;
const database = new Database(":memory:");
database.pragma("foreign_keys = ON");
globalThis.__asbirDatabase = database;

database.exec(`
  CREATE TABLE workspace_membership (workspace_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE workspace_mcp_token (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, created_by_user_id TEXT NOT NULL, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, scopes_json TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT, created_at TEXT NOT NULL);
  CREATE TABLE project (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL, created_by_user_id TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE handoff (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL, review_share_id TEXT, published_version_id TEXT, published_at TEXT, published_by_user_id TEXT, sharing_mode TEXT NOT NULL DEFAULT 'workspace');
  CREATE TABLE handoff_version (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, handoff_id TEXT NOT NULL, version_label TEXT NOT NULL, release_note TEXT, source TEXT NOT NULL, source_file_id TEXT NOT NULL, source_revision_id TEXT, captured_at TEXT NOT NULL, content_hash TEXT NOT NULL, visual_only INTEGER NOT NULL, snapshot_json TEXT NOT NULL, created_by_user_id TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE handoff_asset (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, handoff_version_id TEXT NOT NULL, asset_key TEXT NOT NULL, object_key TEXT NOT NULL, file_name TEXT NOT NULL, content_type TEXT NOT NULL, size_bytes INTEGER NOT NULL, sha256 TEXT NOT NULL, width INTEGER, height INTEGER);
`);

const now = "2026-11-09T00:00:00.000Z";
const measurement = (value, sourceProperty) => ({ value, unit: "px", provenance: "source", sourceProperty });
const bounds = {
  x: measurement(0, "x"),
  y: measurement(0, "y"),
  width: measurement(320, "width"),
  height: measurement(640, "height"),
};
const snapshot = {
  schemaVersion: 1,
  source: "figma",
  sourceFileId: "file-a",
  sourceRevisionId: null,
  sourceFileName: "Synthetic fixture",
  capturedAt: now,
  contentHash: "a".repeat(64),
  overviewAssetKey: "render",
  frames: [{ sourceFrameId: "frame-a", sourcePageId: "page-a", name: "Screen", bounds, renderAssetKey: "render", nodes: [] }],
  assets: [{ key: "render", fileName: "screen.png", contentType: "image/png", sizeBytes: 0, sha256: "b".repeat(64), width: 320, height: 640 }],
  sourceMetadata: {},
};

for (const [workspaceId, projectId, handoffId] of [
  ["workspace-a", "project-a", "handoff-a"],
  ["workspace-a", "project-a", "handoff-a-other"],
  ["workspace-b", "project-b", "handoff-b"],
]) {
  if (!database.prepare("SELECT 1 FROM project WHERE id = ?").get(projectId)) {
    database.prepare("INSERT INTO project (id, workspace_id, name, created_by_user_id, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(projectId, workspaceId, projectId, "designer", now);
  }
  database.prepare("INSERT INTO handoff (id, workspace_id, project_id, name, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(handoffId, workspaceId, projectId, handoffId, now);
}

database.prepare("INSERT INTO workspace_membership (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)")
  .run("workspace-a", "designer", "designer", now);
database.prepare("INSERT INTO workspace_membership (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)")
  .run("workspace-b", "designer-b", "designer", now);

for (const [workspaceId, handoffId, versionId] of [
  ["workspace-a", "handoff-a", "version-a"],
  ["workspace-a", "handoff-a-other", "version-a-other"],
  ["workspace-b", "handoff-b", "version-b"],
]) {
  database.prepare(`INSERT INTO handoff_version
    (id, workspace_id, handoff_id, version_label, release_note, source, source_file_id,
     source_revision_id, captured_at, content_hash, visual_only, snapshot_json, created_by_user_id, created_at)
    VALUES (?, ?, ?, ?, NULL, 'figma', 'file-a', NULL, ?, ?, 0, ?, 'designer', ?)`)
    .run(versionId, workspaceId, handoffId, versionId, now, "c".repeat(64), JSON.stringify(snapshot), now);
}

after(() => {
  database.close();
  if (priorDatabase === undefined) delete globalThis.__asbirDatabase;
  else globalThis.__asbirDatabase = priorDatabase;
});

test("an MCP token can load only handoffs and versions from its workspace and handoff", () => {
  const issued = createWorkspaceMcpToken({
    workspaceId: "workspace-a",
    createdBy: "designer",
    name: "Synthetic isolation test",
    scopes: ["handoffs:read"],
    expiresInDays: 1,
  });
  const access = resolveWorkspaceMcpToken(issued.token);
  assert.equal(access?.workspaceId, "workspace-a");
  assert.ok(getHandoff({ workspaceId: access.workspaceId, projectId: "project-a", handoffId: "handoff-a" }));

  assert.equal(getHandoff({ workspaceId: access.workspaceId, projectId: "project-b", handoffId: "handoff-b" }), undefined);
  assert.equal(getVersion({ workspaceId: access.workspaceId, versionId: "version-b" }), null);
  assert.throws(() => loadHandoff(access.workspaceId, "project-b", "handoff-b"), /Handoff not found in this workspace/);
  assert.throws(
    () => loadVersion(access.workspaceId, { projectId: "project-a", handoffId: "handoff-a", versionId: "version-a-other" }),
    /Version not found in this handoff/,
  );
});
