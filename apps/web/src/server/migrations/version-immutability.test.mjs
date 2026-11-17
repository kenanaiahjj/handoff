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
  await database.prepare(`INSERT INTO handoff_version
    (id, workspace_id, handoff_id, version_label, source, source_file_id, captured_at,
     content_hash, snapshot_json, created_by_user_id, created_at)
    VALUES ('version-1', 'workspace-1', 'handoff-1', 'Original', 'figma', 'file-1', now(), ?, '{}', 'user-1', now())`)
    .run("a".repeat(64));
  return { fixture, database };
}

test("rejects updates to an existing handoff version", async () => {
  const { fixture, database } = await createDatabase();

  try {
    await assert.rejects(
      database.transaction(async () => {
        await database.prepare("UPDATE handoff_version SET version_label = ? WHERE id = ?").run("Edited", "version-1");
      })(),
      /Handoff versions are immutable/,
    );
    const version = await database.prepare("SELECT version_label FROM handoff_version WHERE id = ?").get("version-1");
    assert.equal(version.version_label, "Original");
  } finally {
    await fixture.close();
  }
});

test("allows a new version and preserves parent handoff deletion cascades", async () => {
  const { fixture, database } = await createDatabase();

  try {
    await database.prepare(`INSERT INTO handoff_version
      (id, workspace_id, handoff_id, version_label, source, source_file_id, captured_at,
       content_hash, snapshot_json, created_by_user_id, created_at)
      VALUES ('version-2', 'workspace-1', 'handoff-1', 'Updated', 'figma', 'file-1', now(), ?, '{}', 'user-1', now())`)
      .run("b".repeat(64));
    const beforeDelete = await database.prepare("SELECT COUNT(*) AS count FROM handoff_version").get();
    assert.equal(beforeDelete.count, 2);

    await database.prepare("DELETE FROM handoff WHERE id = ?").run("handoff-1");
    const afterDelete = await database.prepare("SELECT COUNT(*) AS count FROM handoff_version").get();
    assert.equal(afterDelete.count, 0);
  } finally {
    await fixture.close();
  }
});
