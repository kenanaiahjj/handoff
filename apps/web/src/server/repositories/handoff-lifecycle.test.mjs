import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createPostgresTestFixture } from "../test-support/postgres-test-fixture.mjs";
import {
  assertReusableAssetReferences,
  deleteHandoffInDatabase,
  deleteHandoffVersionInDatabase,
} from "../services/handoff-lifecycle.ts";
import { isWorkspaceRoleAllowed } from "../services/workspace-role-policy.ts";

const fixture = await createPostgresTestFixture();
const { database, pool } = fixture;

await pool.query(`
  CREATE TABLE project (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, UNIQUE (id, workspace_id));
  CREATE TABLE handoff_version (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    handoff_id TEXT NOT NULL,
    version_label TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (id, workspace_id)
  );
  CREATE TABLE handoff (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    review_share_id TEXT,
    published_version_id TEXT,
    published_at TEXT,
    published_by_user_id TEXT,
    sharing_mode TEXT NOT NULL DEFAULT 'workspace',
    UNIQUE (id, workspace_id),
    FOREIGN KEY (project_id, workspace_id) REFERENCES project (id, workspace_id) ON DELETE CASCADE
  );
  ALTER TABLE handoff_version
    ADD CONSTRAINT handoff_version_handoff_fk
    FOREIGN KEY (handoff_id, workspace_id) REFERENCES handoff (id, workspace_id) ON DELETE CASCADE;
  ALTER TABLE handoff
    ADD CONSTRAINT handoff_published_version_fk
    FOREIGN KEY (published_version_id) REFERENCES handoff_version (id) ON DELETE SET NULL;
  CREATE TABLE IF NOT EXISTS handoff_version_snapshot (version_id TEXT PRIMARY KEY, encoding TEXT NOT NULL, compressed BYTEA NOT NULL, raw_bytes INTEGER NOT NULL, frame_index TEXT NOT NULL);
  CREATE TABLE handoff_asset (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    handoff_version_id TEXT NOT NULL,
    object_key TEXT NOT NULL,
    FOREIGN KEY (handoff_version_id, workspace_id) REFERENCES handoff_version (id, workspace_id) ON DELETE CASCADE
  );
  CREATE TABLE handoff_invite (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    handoff_id TEXT NOT NULL,
    FOREIGN KEY (handoff_id, workspace_id) REFERENCES handoff (id, workspace_id) ON DELETE CASCADE
  );
  CREATE TABLE handoff_comment (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    handoff_version_id TEXT NOT NULL,
    FOREIGN KEY (handoff_version_id, workspace_id) REFERENCES handoff_version (id, workspace_id) ON DELETE CASCADE
  );
`);

const objectKey = "a".repeat(48);
const now = "2026-11-09T12:00:00.000Z";
for (const [projectId, handoffId] of [["project-a", "handoff-a"], ["project-b", "handoff-b"]]) {
  await database.prepare("INSERT INTO project (id, workspace_id) VALUES (?, ?)").run(projectId, "workspace-a");
  await database.prepare(`INSERT INTO handoff
    (id, workspace_id, project_id, name, created_at, review_share_id, published_version_id, published_at, published_by_user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(handoffId, "workspace-a", projectId, handoffId, now, `share-${handoffId}`, null, null, null);
}
for (const [handoffId, versionId, label, createdAt] of [
  ["handoff-a", "version-a1", "1", "2026-11-09T10:00:00.000Z"],
  ["handoff-a", "version-a2", "2", "2026-11-09T11:00:00.000Z"],
  ["handoff-b", "version-b1", "1", "2026-11-09T11:30:00.000Z"],
]) {
  await database.prepare("INSERT INTO handoff_version (id, workspace_id, handoff_id, version_label, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(versionId, "workspace-a", handoffId, label, createdAt);
  await database.prepare("INSERT INTO handoff_asset (id, workspace_id, handoff_version_id, object_key) VALUES (?, ?, ?, ?)")
    .run(`asset-${versionId}`, "workspace-a", versionId, objectKey);
}
await database.prepare("UPDATE handoff SET published_version_id = ? WHERE id = ?").run("version-a1", "handoff-a");
await database.prepare("INSERT INTO handoff_invite (id, workspace_id, handoff_id) VALUES (?, ?, ?)").run("invite-a", "workspace-a", "handoff-a");
await database.prepare("INSERT INTO handoff_comment (id, workspace_id, handoff_version_id) VALUES (?, ?, ?)").run("comment-a", "workspace-a", "version-a1");

after(async () => fixture.close());

test("deleting a version preserves shared assets and unpublishes that version", async () => {
  const result = await deleteHandoffVersionInDatabase(database, {
    workspaceId: "workspace-a",
    projectId: "project-a",
    handoffId: "handoff-a",
    versionId: "version-a1",
  });

  assert.deepEqual(result, {
    deletedVersionId: "version-a1",
    remainingLatestVersionId: "version-a2",
    unreferencedObjectKeys: [],
  });
  assert.equal((await database.prepare("SELECT published_version_id AS id FROM handoff WHERE id = ?").get("handoff-a")).id, null);
  assert.equal((await database.prepare("SELECT COUNT(*) AS count FROM handoff_comment WHERE id = ?").get("comment-a")).count, 0);
  assert.equal((await database.prepare("SELECT COUNT(*) AS count FROM handoff_asset WHERE object_key = ?").get(objectKey)).count, 2);
  await assert.rejects(assertReusableAssetReferences(database, {
      workspaceId: "workspace-a",
      handoffId: "handoff-a",
      sourceVersionId: "version-a1",
      objectKeys: [objectKey],
    }), /Reusable asset source version is no longer available/);
});

test("deleting a handoff keeps assets referenced elsewhere and cascades its data", async () => {
  const result = await deleteHandoffInDatabase(database, { workspaceId: "workspace-a", projectId: "project-a", handoffId: "handoff-a" });

  assert.deepEqual(result, { handoffId: "handoff-a", unreferencedObjectKeys: [] });
  assert.equal((await database.prepare("SELECT COUNT(*) AS count FROM handoff WHERE id = ?").get("handoff-a")).count, 0);
  assert.equal((await database.prepare("SELECT COUNT(*) AS count FROM handoff_invite WHERE id = ?").get("invite-a")).count, 0);
  assert.equal((await database.prepare("SELECT COUNT(*) AS count FROM handoff_version WHERE handoff_id = ?").get("handoff-a")).count, 0);
  assert.equal((await database.prepare("SELECT COUNT(*) AS count FROM handoff_asset WHERE object_key = ?").get(objectKey)).count, 1);
});

test("deleting the last reference returns its object key for cleanup", async () => {
  const result = await deleteHandoffInDatabase(database, { workspaceId: "workspace-a", projectId: "project-b", handoffId: "handoff-b" });

  assert.deepEqual(result, { handoffId: "handoff-b", unreferencedObjectKeys: [objectKey] });
  assert.equal((await database.prepare("SELECT COUNT(*) AS count FROM handoff_asset WHERE object_key = ?").get(objectKey)).count, 0);
});

test("strict role checks allow only owners and designers", () => {
  assert.equal(isWorkspaceRoleAllowed("owner", ["owner", "designer"]), true);
  assert.equal(isWorkspaceRoleAllowed("designer", ["owner", "designer"]), true);
  assert.equal(isWorkspaceRoleAllowed("reviewer", ["owner", "designer"]), false);
  assert.equal(isWorkspaceRoleAllowed("developer", ["owner", "designer"]), false);
  assert.equal(isWorkspaceRoleAllowed("qa", ["owner", "designer"]), false);
});
