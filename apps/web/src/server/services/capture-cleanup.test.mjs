import assert from "node:assert/strict";
import test from "node:test";
import { createPostgresTestDatabase } from "../test-support/postgres-test-database.mjs";
import { getDatabase, setDatabasePoolForTests } from "../db.ts";
import { setObjectStoreForTests } from "../storage/supabase-object-store.ts";
import { cleanupCaptureUploads } from "./capture-cleanup.ts";

process.env.NODE_ENV = "test";
const key = (character) => character.repeat(48);
const now = new Date("2026-11-20T12:00:00.000Z");
const hoursAgo = (hours) => new Date(now.getTime() - hours * 3_600_000).toISOString();

test("deletes dead capture uploads and keeps anything a version or a live capture uses", async () => {
  const fixture = await createPostgresTestDatabase();
  setDatabasePoolForTests(fixture.pool);
  const deletedKeys = [];
  setObjectStoreForTests({ async delete(objectKey) { deletedKeys.push(objectKey); } });
  try {
    const db = getDatabase();
    await db.prepare(`INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES ('owner', 'Olive', 'owner@example.invalid', true, now(), now())`).run();
    await db.prepare("INSERT INTO workspace (id, name, created_by_user_id, created_at) VALUES ('w', 'Asbir', 'owner', now())").run();
    await db.prepare("INSERT INTO project (id, workspace_id, name, created_by_user_id, created_at) VALUES ('p', 'w', 'Tripket', 'owner', now())").run();
    const session = (id, createdHoursAgo, usedAt = null) => db.prepare(
      `INSERT INTO capture_session (id, workspace_id, project_id, version_label, created_by_user_id, token_hash, expires_at, used_at, created_at)
       VALUES (?, 'w', 'p', '1.0', 'owner', ?, ?, ?, ?)`,
    ).run(id, `hash-${id}`, hoursAgo(createdHoursAgo - 1), usedAt, hoursAgo(createdHoursAgo));
    const upload = (id, sessionId, objectKey) => db.prepare(
      `INSERT INTO capture_upload (id, capture_session_id, upload_kind, asset_key, object_key, file_name, content_type, size_bytes, sha256, created_at)
       VALUES (?, ?, 'asset', ?, ?, 'frame.png', 'image/png', 10, ?, ?)`,
    ).run(id, sessionId, id, objectKey, "b".repeat(64), hoursAgo(1));
    await session("stale", 30);
    await session("live", 2);
    await upload("stale-upload", "stale", key("a"));
    await upload("live-upload", "live", key("b"));
    const abandoned = (objectKey, deleteAfter) => db.prepare("INSERT INTO capture_upload_abandoned (object_key, created_at, delete_after) VALUES (?, ?, ?)").run(objectKey, hoursAgo(30), deleteAfter);
    await abandoned(key("c"), hoursAgo(1));
    await abandoned(key("d"), new Date(now.getTime() + 3_600_000).toISOString());

    const result = await cleanupCaptureUploads({ now });

    assert.deepEqual(deletedKeys.sort(), [key("a"), key("c")]);
    assert.deepEqual(result, { deletedObjects: 2, keptInUse: 0, failed: 0 });
    assert.deepEqual((await db.prepare("SELECT id FROM capture_upload ORDER BY id").all()).map((row) => row.id), ["live-upload"]);
    assert.deepEqual((await db.prepare("SELECT object_key AS k FROM capture_upload_abandoned").all()).map((row) => row.k), [key("d")]);
    assert.deepEqual(await cleanupCaptureUploads({ now }), { deletedObjects: 0, keptInUse: 0, failed: 0 });
  } finally {
    setObjectStoreForTests(undefined);
    setDatabasePoolForTests(undefined);
    await fixture.close();
  }
});

test("a failed Storage delete keeps its row, so the next run retries it", async () => {
  const fixture = await createPostgresTestDatabase();
  setDatabasePoolForTests(fixture.pool);
  let failNext = true;
  setObjectStoreForTests({ async delete() { if (failNext) { failNext = false; throw new Error("Supabase Storage delete failed: timeout"); } } });
  try {
    const db = getDatabase();
    await db.prepare("INSERT INTO capture_upload_abandoned (object_key, created_at, delete_after) VALUES (?, ?, ?)").run(key("e"), hoursAgo(30), hoursAgo(1));
    const first = await cleanupCaptureUploads({ now });
    assert.equal(first.failed, 1);
    assert.equal((await db.prepare("SELECT count(*)::int AS n FROM capture_upload_abandoned").get()).n, 1);
    const second = await cleanupCaptureUploads({ now });
    assert.equal(second.deletedObjects, 1);
    assert.equal((await db.prepare("SELECT count(*)::int AS n FROM capture_upload_abandoned").get()).n, 0);
  } finally {
    setObjectStoreForTests(undefined);
    setDatabasePoolForTests(undefined);
    await fixture.close();
  }
});
