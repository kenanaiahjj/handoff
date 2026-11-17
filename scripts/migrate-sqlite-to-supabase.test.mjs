import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createPostgresTestDatabase } from "../apps/web/src/server/test-support/postgres-test-database.mjs";
import { migrateSqliteToSupabase } from "./migrate-sqlite-to-supabase.mjs";
import { verifySqliteToSupabase } from "./verify-supabase-migration.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webRequire = createRequire(path.join(repositoryRoot, "apps/web/package.json"));
const Sqlite = webRequire("better-sqlite3");

const objectKey = "0123456789abcdef0123456789abcdef0123456789abcdef";
const content = Buffer.from("sanitized fixture asset");

class FakeStorage {
  objects = new Map();
  putCalls = 0;

  async get(key) {
    const entry = this.objects.get(key);
    return entry ? { bytes: Buffer.from(entry.bytes), contentType: entry.contentType } : null;
  }

  async put(key, bytes, contentType) {
    if (this.objects.has(key)) throw new Error("Object already exists.");
    this.putCalls += 1;
    this.objects.set(key, { bytes: Buffer.from(bytes), contentType });
  }
}

async function createFixture({ wrongLocalBytes = false, includeOrphan = false } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "asbir-migration-test-"));
  const objectDirectory = path.join(directory, "objects");
  const sqlitePath = path.join(directory, "source.sqlite");
  await mkdir(objectDirectory);
  const database = new Sqlite(sqlitePath);
  database.exec(`
    CREATE TABLE "user" (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, emailVerified INTEGER NOT NULL,
      image TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    );
    CREATE TABLE account (
      id TEXT PRIMARY KEY, accountId TEXT NOT NULL, providerId TEXT NOT NULL, userId TEXT NOT NULL,
      accessToken TEXT, refreshToken TEXT, idToken TEXT, accessTokenExpiresAt INTEGER,
      refreshTokenExpiresAt INTEGER, scope TEXT, password TEXT, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
    );
    CREATE TABLE workspace (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by_user_id TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE workspace_membership (
      workspace_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY (workspace_id, user_id)
    );
    CREATE TABLE workspace_invite (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, invited_by_user_id TEXT NOT NULL, token_hash TEXT NOT NULL,
      role TEXT NOT NULL, expires_at TEXT, accepted_at TEXT, reusable INTEGER NOT NULL, revoked_at TEXT,
      created_at TEXT NOT NULL, job_role TEXT
    );
    CREATE TABLE project (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL, created_by_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL, rules_json TEXT NOT NULL, pd_in_charge_user_id TEXT
    );
    CREATE TABLE handoff (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, name TEXT NOT NULL,
      created_by_user_id TEXT NOT NULL, created_at TEXT NOT NULL, review_share_id TEXT,
      published_version_id TEXT, published_at TEXT, published_by_user_id TEXT, sharing_mode TEXT NOT NULL
    );
    CREATE TABLE handoff_version (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, handoff_id TEXT NOT NULL, version_label TEXT NOT NULL,
      release_note TEXT, source TEXT NOT NULL, source_file_id TEXT NOT NULL, source_revision_id TEXT,
      captured_at TEXT NOT NULL, content_hash TEXT NOT NULL, visual_only INTEGER NOT NULL, snapshot_json TEXT NOT NULL,
      created_by_user_id TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE handoff_version_snapshot (
      version_id TEXT PRIMARY KEY, encoding TEXT NOT NULL, compressed BLOB NOT NULL,
      raw_bytes INTEGER NOT NULL, frame_index TEXT NOT NULL
    );
    CREATE TABLE handoff_asset (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, handoff_version_id TEXT NOT NULL,
      asset_key TEXT NOT NULL, object_key TEXT NOT NULL, file_name TEXT NOT NULL, content_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL, sha256 TEXT NOT NULL, width INTEGER, height INTEGER, created_at TEXT NOT NULL
    );
    CREATE TABLE handoff_comment (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, handoff_version_id TEXT NOT NULL, frame_id TEXT NOT NULL,
      source_node_id TEXT, x REAL, y REAL, parent_comment_id TEXT, body TEXT NOT NULL, resolved_at TEXT,
      resolved_by_user_id TEXT, created_by_user_id TEXT, created_by_invite_id TEXT, author_label TEXT,
      author_role TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE project_icon (
      project_id TEXT PRIMARY KEY, content_type TEXT NOT NULL, bytes BLOB NOT NULL,
      sha256 TEXT NOT NULL, updated_by_user_id TEXT, updated_at TEXT NOT NULL
    );
  `);

  const timestamp = "2025-02-03T04:05:06.000Z";
  database.prepare(`INSERT INTO "user" VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    "user-1", "Fixture User", "fixture@example.invalid", 1, null, timestamp, timestamp,
  );
  database.prepare("INSERT INTO account (id, accountId, providerId, userId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)")
    .run("account-1", "provider-user", "google", "user-1", 1_700_000_000_000, 1_700_000_000_000);
  database.prepare("INSERT INTO workspace VALUES (?, ?, ?, ?)").run("workspace-1", "Fixture workspace", "user-1", timestamp);
  database.prepare("INSERT INTO workspace_membership VALUES (?, ?, ?, ?)").run("workspace-1", "user-1", "owner", timestamp);
  database.prepare("INSERT INTO workspace_invite VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    "workspace-invite-1", "workspace-1", "user-1", "f".repeat(64), "reviewer", null, null, 1, null, timestamp, null,
  );
  database.prepare("INSERT INTO project VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    "project-1", "workspace-1", "Fixture project", "user-1", timestamp,
    '{"allowedSpacing":[],"requireTokenCategories":[],"frameBounds":null}', null,
  );
  database.prepare("INSERT INTO handoff VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    "handoff-1", "workspace-1", "project-1", "Fixture handoff", "user-1", timestamp,
    null, "version-1", null, null, "workspace",
  );
  database.prepare("INSERT INTO handoff_version VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    "version-1", "workspace-1", "handoff-1", "1.0", null, "figma", "file-1", null,
    timestamp, "a".repeat(64), 0, "{}", "user-1", timestamp,
  );
  database.prepare("INSERT INTO handoff_version_snapshot VALUES (?, ?, ?, ?, ?)").run(
    "version-1", "br", Buffer.from([1, 2, 3, 4]), 4, "[]",
  );
  const storedContent = wrongLocalBytes ? Buffer.from("corrupt fixture bytes") : content;
  const expectedHash = (await import("node:crypto")).createHash("sha256").update(content).digest("hex");
  database.prepare("INSERT INTO handoff_asset VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    "asset-1", "workspace-1", "version-1", "render-1", objectKey, "render.png", "image/png",
    content.byteLength, expectedHash, 320, 240, timestamp,
  );
  database.prepare("INSERT INTO handoff_comment VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    "comment-child", "workspace-1", "version-1", "frame-1", null, null, null, "comment-parent",
    "A child comment", null, null, "user-1", null, null, null, timestamp,
  );
  database.prepare("INSERT INTO handoff_comment VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    "comment-parent", "workspace-1", "version-1", "frame-1", null, null, null, null,
    "A parent comment", null, null, "user-1", null, null, null, timestamp,
  );
  database.prepare("INSERT INTO project_icon VALUES (?, ?, ?, ?, ?, ?)").run(
    "project-1", "image/png", Buffer.from([9, 8, 7]), "b".repeat(64), "user-1", timestamp,
  );
  database.close();

  await writeFile(path.join(objectDirectory, objectKey), storedContent);
  await writeFile(path.join(objectDirectory, `${objectKey}.json`), JSON.stringify({ contentType: "image/png" }));
  if (includeOrphan) await writeFile(path.join(objectDirectory, "f".repeat(48)), Buffer.from("orphan"));
  return { directory, sqlitePath, objectDirectory, checkpointPath: `${directory}.migration-checkpoint.json` };
}

test("migration dry-run is read-only, then apply resumes without duplicate rows or objects", async (t) => {
  const fixture = await createFixture();
  const postgres = await createPostgresTestDatabase();
  const storage = new FakeStorage();
  t.after(async () => {
    await postgres.close();
    await rm(fixture.directory, { recursive: true, force: true });
    await rm(fixture.checkpointPath, { force: true });
  });

  const dryRun = await migrateSqliteToSupabase({ ...fixture, pool: postgres.pool, storage, dryRun: true });
  assert.equal(dryRun.ok, true);
  assert.deepEqual(dryRun.objects.remoteMissing, [objectKey]);
  assert.equal(storage.putCalls, 0);
  assert.equal((await postgres.pool.query('SELECT COUNT(*) AS count FROM "user"')).rows[0].count, "0");

  const first = await migrateSqliteToSupabase({ ...fixture, pool: postgres.pool, storage, dryRun: false, batchSize: 1 });
  assert.equal(first.ok, true);
  assert.equal(first.objects.copied, 1);
  assert.equal(storage.putCalls, 1);
  const checkpoint = JSON.parse(await readFile(fixture.checkpointPath, "utf8"));
  assert.equal(checkpoint.completedObjects[objectKey].sha256.length, 64);
  assert.equal(checkpoint.completedTables.handoff_version.sourceRows, 1);

  const second = await migrateSqliteToSupabase({ ...fixture, pool: postgres.pool, storage, dryRun: false, batchSize: 1 });
  assert.equal(second.ok, true);
  assert.equal(second.objects.reused, 1);
  assert.equal(storage.putCalls, 1);
  assert.equal((await postgres.pool.query('SELECT COUNT(*) AS count FROM "user"')).rows[0].count, "1");
  assert.equal((await postgres.pool.query("SELECT \"emailVerified\" FROM \"user\" WHERE id = 'user-1'")).rows[0].emailVerified, true);
  assert.equal((await postgres.pool.query("SELECT reusable FROM workspace_invite WHERE id = 'workspace-invite-1'")).rows[0].reusable, true);
  assert.equal((await postgres.pool.query("SELECT \"createdAt\" FROM account WHERE id = 'account-1'")).rows[0].createdAt.toISOString(), "2023-11-14T22:13:20.000Z");
  assert.equal((await postgres.pool.query("SELECT published_version_id FROM handoff WHERE id = 'handoff-1'")).rows[0].published_version_id, "version-1");
  assert.equal((await postgres.pool.query("SELECT parent_comment_id FROM handoff_comment WHERE id = 'comment-child'")).rows[0].parent_comment_id, "comment-parent");
  assert.deepEqual((await postgres.pool.query("SELECT compressed FROM handoff_version_snapshot WHERE version_id = 'version-1'")).rows[0].compressed, Buffer.from([1, 2, 3, 4]));
  assert.deepEqual((await postgres.pool.query("SELECT bytes FROM project_icon WHERE project_id = 'project-1'")).rows[0].bytes, Buffer.from([9, 8, 7]));

  const verification = await verifySqliteToSupabase({ ...fixture, pool: postgres.pool, storage });
  assert.equal(verification.ok, true, JSON.stringify(verification, null, 2));

  storage.objects.set(objectKey, { bytes: Buffer.from("tampered"), contentType: "image/png" });
  const failedVerification = await verifySqliteToSupabase({ ...fixture, pool: postgres.pool, storage });
  assert.equal(failedVerification.ok, false);
  assert.equal(failedVerification.objects.storageMismatches.some((item) => item.objectKey === objectKey), true);
});

test("dry-run reports damaged and orphaned local objects without writing", async (t) => {
  const fixture = await createFixture({ wrongLocalBytes: true, includeOrphan: true });
  const postgres = await createPostgresTestDatabase();
  const storage = new FakeStorage();
  t.after(async () => {
    await postgres.close();
    await rm(fixture.directory, { recursive: true, force: true });
    await rm(fixture.checkpointPath, { force: true });
  });

  const summary = await migrateSqliteToSupabase({ ...fixture, pool: postgres.pool, storage, dryRun: true });
  assert.equal(summary.ok, false);
  assert.equal(summary.objects.localIssues.some((item) => item.kind === "local-object-mismatch"), true);
  assert.deepEqual(summary.objects.orphanedLocalFiles, ["f".repeat(48)]);
  assert.equal(storage.putCalls, 0);
  assert.equal((await postgres.pool.query('SELECT COUNT(*) AS count FROM "user"')).rows[0].count, "0");
});

test("conflicting target rows stay unchanged and the import can resume after resolution", async (t) => {
  const fixture = await createFixture();
  const postgres = await createPostgresTestDatabase();
  const storage = new FakeStorage();
  t.after(async () => {
    await postgres.close();
    await rm(fixture.directory, { recursive: true, force: true });
    await rm(fixture.checkpointPath, { force: true });
  });

  await postgres.pool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ('user-1', 'Existing target user', 'fixture@example.invalid', false, now(), now())`,
  );
  await assert.rejects(
    migrateSqliteToSupabase({ ...fixture, pool: postgres.pool, storage, dryRun: false }),
    /Existing user row conflicts with source column name/,
  );
  assert.equal((await postgres.pool.query('SELECT name FROM "user" WHERE id = $1', ["user-1"])).rows[0].name, "Existing target user");
  assert.equal(storage.putCalls, 1);

  await postgres.pool.query('DELETE FROM "user" WHERE id = $1', ["user-1"]);
  const resumed = await migrateSqliteToSupabase({ ...fixture, pool: postgres.pool, storage, dryRun: false });
  assert.equal(resumed.ok, true);
  assert.equal(resumed.objects.reused, 1);
  assert.equal(storage.putCalls, 1);
  assert.equal((await postgres.pool.query('SELECT name FROM "user" WHERE id = $1', ["user-1"])).rows[0].name, "Fixture User");
});
