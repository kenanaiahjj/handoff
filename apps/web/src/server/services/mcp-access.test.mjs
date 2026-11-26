import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createPostgresTestFixture } from "../test-support/postgres-test-fixture.mjs";
import { createWorkspaceMcpToken, resolveWorkspaceMcpToken } from "../repositories/mcp-tokens.ts";
import { getHandoff } from "../repositories/handoffs.ts";
import { getVersion } from "../repositories/versions.ts";
import { loadHandoff, loadVersion, scopedLoaders } from "./mcp-access.ts";
import { visibleHandoffIds } from "./review-visibility.ts";

const fixture = await createPostgresTestFixture();
const { database, pool } = fixture;

await pool.query(`
  CREATE TABLE "user" (id TEXT PRIMARY KEY, email TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS user_presence (user_id TEXT PRIMARY KEY, last_seen_at TIMESTAMPTZ);
  CREATE TABLE handoff_invite (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, handoff_id TEXT NOT NULL, email TEXT NOT NULL, token_hash TEXT NOT NULL, expires_at TEXT, revoked_at TEXT, invited_by_user_id TEXT NOT NULL, created_at TEXT NOT NULL, role TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS project_member (project_id TEXT, workspace_id TEXT, email TEXT, role TEXT, added_by_user_id TEXT, created_at TEXT);
  CREATE TABLE workspace_membership (workspace_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE workspace_mcp_token (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, created_by_user_id TEXT NOT NULL, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, scopes_json TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT, created_at TEXT NOT NULL, last_used_at TEXT);
  CREATE TABLE project (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL, created_by_user_id TEXT NOT NULL, created_at TEXT NOT NULL, pd_in_charge_user_id TEXT);
  CREATE TABLE handoff (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL, review_share_id TEXT, published_version_id TEXT, published_at TEXT, published_by_user_id TEXT, sharing_mode TEXT NOT NULL DEFAULT 'workspace', review_status TEXT NOT NULL DEFAULT 'draft', review_status_at TEXT, review_status_by_user_id TEXT);
  CREATE TABLE handoff_version (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, handoff_id TEXT NOT NULL, version_label TEXT NOT NULL, release_note TEXT, source TEXT NOT NULL, source_file_id TEXT NOT NULL, source_revision_id TEXT, captured_at TEXT NOT NULL, content_hash TEXT NOT NULL, visual_only BOOLEAN NOT NULL, snapshot_json TEXT NOT NULL, created_by_user_id TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS handoff_version_snapshot (version_id TEXT PRIMARY KEY, encoding TEXT NOT NULL, compressed BYTEA NOT NULL, raw_bytes INTEGER NOT NULL, frame_index TEXT NOT NULL);
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
  if (!(await database.prepare("SELECT 1 FROM project WHERE id = ?").get(projectId))) {
    await database.prepare("INSERT INTO project (id, workspace_id, name, created_by_user_id, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(projectId, workspaceId, projectId, "designer", now);
  }
  await database.prepare("INSERT INTO handoff (id, workspace_id, project_id, name, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(handoffId, workspaceId, projectId, handoffId, now);
}

for (const [id, email] of [["designer", "designer@example.test"], ["designer-b", "designer-b@example.test"], ["reviewer", "Reviewer@Example.test"]]) {
  await database.prepare('INSERT INTO "user" (id, email) VALUES (?, ?)').run(id, email);
}
await database.prepare("INSERT INTO workspace_membership (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)")
  .run("workspace-a", "designer", "designer", now);
await database.prepare("INSERT INTO workspace_membership (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)")
  .run("workspace-a", "reviewer", "reviewer", now);
await database.prepare(`INSERT INTO handoff_invite (id, workspace_id, handoff_id, email, token_hash, expires_at, revoked_at, invited_by_user_id, created_at, role)
  VALUES ('invite-a', 'workspace-a', 'handoff-a', 'reviewer@example.test', 'hash-a', NULL, NULL, 'designer', ?, 'qa')`).run(now);
await database.prepare("INSERT INTO workspace_membership (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)")
  .run("workspace-b", "designer-b", "designer", now);

for (const [workspaceId, handoffId, versionId] of [
  ["workspace-a", "handoff-a", "version-a"],
  ["workspace-a", "handoff-a-other", "version-a-other"],
  ["workspace-b", "handoff-b", "version-b"],
]) {
  await database.prepare(`INSERT INTO handoff_version
    (id, workspace_id, handoff_id, version_label, release_note, source, source_file_id,
     source_revision_id, captured_at, content_hash, visual_only, snapshot_json, created_by_user_id, created_at)
    VALUES (?, ?, ?, ?, NULL, 'figma', 'file-a', NULL, ?, ?, false, ?, 'designer', ?)`)
    .run(versionId, workspaceId, handoffId, versionId, now, "c".repeat(64), JSON.stringify(snapshot), now);
}

after(async () => fixture.close());

test("an MCP token can load only handoffs and versions from its workspace and handoff", async () => {
  const issued = await createWorkspaceMcpToken({
    workspaceId: "workspace-a",
    createdBy: "designer",
    name: "Synthetic isolation test",
    scopes: ["handoffs:read"],
    expiresInDays: 1,
  });
  const access = await resolveWorkspaceMcpToken(issued.token);
  assert.equal(access?.workspaceId, "workspace-a");
  assert.ok(await getHandoff({ workspaceId: access.workspaceId, projectId: "project-a", handoffId: "handoff-a" }));

  assert.equal(await getHandoff({ workspaceId: access.workspaceId, projectId: "project-b", handoffId: "handoff-b" }), undefined);
  assert.equal(await getVersion({ workspaceId: access.workspaceId, versionId: "version-b" }), null);
  await assert.rejects(loadHandoff(access.workspaceId, "project-b", "handoff-b"), /Handoff not found in this workspace/);
  await assert.rejects(
    loadVersion(access.workspaceId, { projectId: "project-a", handoffId: "handoff-a", versionId: "version-a-other" }),
    /Version not found in this handoff/,
  );
});

test("a reviewer's MCP token reaches only handoffs shared with that reviewer", async () => {
  const designerToken = await createWorkspaceMcpToken({
    workspaceId: "workspace-a", createdBy: "designer", name: "Designer agent", scopes: ["handoffs:read"], expiresInDays: 1,
  });
  const designerAccess = await resolveWorkspaceMcpToken(designerToken.token);
  assert.equal(await visibleHandoffIds("workspace-a", designerAccess.viewer), null, "designers keep workspace-wide access");

  const reviewerToken = await createWorkspaceMcpToken({
    workspaceId: "workspace-a", createdBy: "reviewer", name: "Reviewer agent", scopes: ["handoffs:read"], expiresInDays: 1,
  });
  const access = await resolveWorkspaceMcpToken(reviewerToken.token);
  assert.equal(access?.viewer.role, "reviewer");
  const allowed = await visibleHandoffIds("workspace-a", access.viewer);
  assert.deepEqual([...allowed], ["handoff-a"], "the invite email matches case-insensitively");

  const { loadHandoff: load, loadVersion: loadScopedVersion } = scopedLoaders(allowed);
  assert.ok(await load("workspace-a", "project-a", "handoff-a"));
  assert.ok(await loadScopedVersion("workspace-a", { projectId: "project-a", handoffId: "handoff-a", versionId: "version-a" }));
  await assert.rejects(load("workspace-a", "project-a", "handoff-a-other"), /Handoff not found in this workspace/);
  await assert.rejects(
    loadScopedVersion("workspace-a", { projectId: "project-a", handoffId: "handoff-a-other", versionId: "version-a-other" }),
    /Handoff not found in this workspace/,
  );

  await database.prepare("UPDATE handoff_invite SET revoked_at = ? WHERE id = 'invite-a'").run(now);
  assert.equal((await visibleHandoffIds("workspace-a", access.viewer)).size, 0, "revoking the invite removes access");
  await database.prepare("UPDATE project SET pd_in_charge_user_id = 'reviewer' WHERE id = 'project-a'").run();
  assert.deepEqual([...(await visibleHandoffIds("workspace-a", access.viewer))].sort(), ["handoff-a", "handoff-a-other"], "a PD in charge sees the whole project");
});

test("a developer's MCP token reaches published handoffs shared with the workspace, like the review page", async () => {
  await database.prepare('INSERT INTO "user" (id, email) VALUES (?, ?)').run("developer", "dev@example.test");
  await database.prepare("INSERT INTO workspace_membership (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)")
    .run("workspace-a", "developer", "developer", now);
  const issued = await createWorkspaceMcpToken({
    workspaceId: "workspace-a", createdBy: "developer", name: "Developer agent", scopes: ["handoffs:read"], expiresInDays: 1,
  });
  const access = await resolveWorkspaceMcpToken(issued.token);
  assert.equal(access?.viewer.role, "developer");
  assert.equal((await visibleHandoffIds("workspace-a", access.viewer)).size, 0, "unpublished handoffs stay hidden");

  await database.prepare("UPDATE handoff SET review_share_id = 'share-a', published_version_id = 'version-a', sharing_mode = 'workspace' WHERE id = 'handoff-a'").run();
  await database.prepare("UPDATE handoff SET review_share_id = 'share-other', published_version_id = 'version-a-other', sharing_mode = 'invited' WHERE id = 'handoff-a-other'").run();
  await database.prepare("UPDATE handoff SET review_share_id = 'share-b', published_version_id = 'version-b', sharing_mode = 'anyone' WHERE id = 'handoff-b'").run();
  const allowed = await visibleHandoffIds("workspace-a", access.viewer);
  assert.deepEqual([...allowed], ["handoff-a"], "workspace-shared handoffs show; invite-only and other workspaces do not");
  assert.ok(await scopedLoaders(allowed).loadHandoff("workspace-a", "project-a", "handoff-a"));
});
