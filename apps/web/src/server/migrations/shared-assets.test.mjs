import assert from "node:assert/strict";
import test from "node:test";
import { PostgresDatabase } from "../db.ts";
import { createPostgresTestDatabase } from "../test-support/postgres-test-database.mjs";

async function createDatabase() {
  const fixture = await createPostgresTestDatabase();
  const database = new PostgresDatabase(fixture.pool);
  await database.prepare(`INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
    VALUES ('user-1', 'Test designer', 'designer@example.invalid', true, now(), now())`).run();
  await database.prepare("INSERT INTO workspace (id, name, created_by_user_id, created_at) VALUES ('workspace-1', 'Workspace', 'user-1', now())").run();
  await database.prepare("INSERT INTO project (id, workspace_id, name, created_by_user_id, created_at) VALUES ('project-1', 'workspace-1', 'Project', 'user-1', now())").run();
  await database.prepare(`INSERT INTO handoff (id, workspace_id, project_id, name, created_by_user_id, created_at)
    VALUES ('handoff-1', 'workspace-1', 'project-1', 'Handoff', 'user-1', now())`).run();
  return { fixture, database };
}

async function insertVersion(database, id, label) {
  await database.prepare(`INSERT INTO handoff_version
    (id, workspace_id, handoff_id, version_label, source, source_file_id, captured_at,
     content_hash, snapshot_json, created_by_user_id, created_at)
    VALUES (?, 'workspace-1', 'handoff-1', ?, 'figma', 'file-1', now(), ?, '{}', 'user-1', now())`)
    .run(id, label, "a".repeat(64));
}

test("a new version can reuse a stored object from the same handoff", async () => {
  const { fixture, database } = await createDatabase();

  try {
    await insertVersion(database, "version-1", "Version 1");
    await insertVersion(database, "version-2", "Version 2");
    await database.prepare(`INSERT INTO handoff_asset (
        id, workspace_id, handoff_version_id, asset_key, object_key, file_name,
        content_type, size_bytes, sha256, width, height, created_at
      ) VALUES (?, 'workspace-1', 'version-1', ?, ?, ?, ?, ?, ?, ?, ?, now())`)
      .run("asset-1", "home-render", "a".repeat(48), "home.png", "image/png", 10, "b".repeat(64), 100, 200);
    await database.prepare(`INSERT INTO handoff_asset (
        id, workspace_id, handoff_version_id, asset_key, object_key, file_name,
        content_type, size_bytes, sha256, width, height, created_at
      ) VALUES (?, 'workspace-1', 'version-2', ?, ?, ?, ?, ?, ?, ?, ?, now())`)
      .run("asset-2", "home-render", "a".repeat(48), "home.png", "image/png", 10, "b".repeat(64), 100, 200);

    const result = await database.prepare("SELECT COUNT(*) AS count FROM handoff_asset WHERE object_key = ?").get("a".repeat(48));
    assert.equal(result.count, 2);
    await database.prepare("DELETE FROM handoff_version WHERE id = ?").run("version-1");
    const remaining = await database.prepare("SELECT COUNT(*) AS count FROM handoff_asset WHERE object_key = ?").get("a".repeat(48));
    assert.equal(remaining.count, 1);
  } finally {
    await fixture.close();
  }
});
