import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { PostgresDatabase, setDatabasePoolForTests } from "../db.ts";
import { createPostgresTestDatabase } from "../test-support/postgres-test-database.mjs";
import { LocalObjectStore } from "../storage/local-object-store.ts";
import { setObjectStoreForTests } from "../storage/supabase-object-store.ts";

const previousDirectory = process.cwd();
const previousDataDirectory = process.env.ASBIR_DATA_DIR;
const previousNodeEnv = process.env.NODE_ENV;
const previousPool = globalThis.__asbirDatabase;
const applicationDirectory = fileURLToPath(new URL("../../..", import.meta.url));
let dataDirectory;
let fixture;
let database;
let createHandoffVersion;
let hashSnapshotPayload;

before(async () => {
  process.chdir(applicationDirectory);
  process.env.NODE_ENV = "test";
  dataDirectory = mkdtempSync(path.join(tmpdir(), "asbir-version-concurrency-"));
  process.env.ASBIR_DATA_DIR = dataDirectory;
  fixture = await createPostgresTestDatabase();
  setDatabasePoolForTests(fixture.pool);
  setObjectStoreForTests(new LocalObjectStore(path.join(dataDirectory, "objects")));

  const [versions, snapshotContract] = await Promise.all([
    import("./versions.ts"),
    import("@asbir/snapshot-contract"),
  ]);
  database = new PostgresDatabase(fixture.pool);
  createHandoffVersion = versions.createHandoffVersion;
  hashSnapshotPayload = snapshotContract.hashSnapshotPayload;

  await database.prepare(`INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
    VALUES ('user-1', 'Test designer', 'designer@example.com', true, '2026-11-10', '2026-11-10')`).run();
  await database.prepare("INSERT INTO workspace (id, name, created_by_user_id, created_at) VALUES ('workspace-1', 'Workspace', 'user-1', '2026-11-10')").run();
  await database.prepare("INSERT INTO project (id, workspace_id, name, created_by_user_id, created_at) VALUES ('project-1', 'workspace-1', 'Project', 'user-1', '2026-11-10')").run();
  await database.prepare("INSERT INTO handoff (id, workspace_id, project_id, name, created_by_user_id, created_at) VALUES ('handoff-1', 'workspace-1', 'project-1', 'Handoff', 'user-1', '2026-11-10')").run();

  const insertVersion = database.prepare(`INSERT INTO handoff_version
    (id, workspace_id, handoff_id, version_label, source, source_file_id, source_revision_id,
     captured_at, content_hash, visual_only, snapshot_json, created_by_user_id, created_at)
    VALUES (?, 'workspace-1', 'handoff-1', ?, 'figma', 'figma-file-1', NULL,
     '2026-11-10T00:00:00.000Z', ?, false, '{}', 'user-1', ?)`);
  await insertVersion.run("version-1", "Version 1", "a".repeat(64), "2026-11-10T00:00:00.000Z");
  await insertVersion.run("version-2", "Version 2", "b".repeat(64), "2026-11-10T00:01:00.000Z");
});

after(async () => {
  await fixture?.close();
  setDatabasePoolForTests(previousPool);
  setObjectStoreForTests(undefined);
  process.chdir(previousDirectory);
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
  if (previousDataDirectory === undefined) delete process.env.ASBIR_DATA_DIR;
  else process.env.ASBIR_DATA_DIR = previousDataDirectory;
  if (dataDirectory) rmSync(dataDirectory, { recursive: true, force: true });
});

test("rejects a capture when its baseline stopped being the latest version during upload", async () => {
  const bytes = new Uint8Array(Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+i3XsAAAAASUVORK5CYII=",
    "base64",
  ));
  const snapshot = {
    schemaVersion: 1,
    source: "bundle",
    sourceFileId: "bundle-file-1",
    sourceRevisionId: null,
    sourceFileName: "test bundle",
    capturedAt: "2026-11-10T00:02:00.000Z",
    contentHash: "0".repeat(64),
    visualOnly: true,
    overviewAssetKey: "overview",
    frames: [{ sourceFrameId: "screen-1", name: "Screen 1", renderAssetKey: "overview" }],
    assets: [{
      key: "overview",
      fileName: "overview.png",
      contentType: "image/png",
      sizeBytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      width: 1,
      height: 1,
    }],
    sourceMetadata: {},
  };
  snapshot.contentHash = await hashSnapshotPayload(snapshot);
  const asset = { ...snapshot.assets[0], bytes };

  const concurrentVersion = await createHandoffVersion({
    workspaceId: "workspace-1",
    projectId: "project-1",
    handoffId: "handoff-1",
    versionLabel: "Concurrent update",
    createdBy: "user-1",
    snapshot,
    assets: [asset],
    expectedLatestVersionId: "version-2",
  });
  const storedObjectsBeforeStaleCapture = readdirSync(path.join(dataDirectory, "objects"))
    .filter((name) => !name.endsWith(".json"));

  await assert.rejects(createHandoffVersion({
    workspaceId: "workspace-1",
    projectId: "project-1",
    handoffId: "handoff-1",
    versionLabel: "Stale capture",
    createdBy: "user-1",
    snapshot,
    assets: [asset],
    expectedLatestVersionId: "version-2",
  }), /handoff changed.*latest version/i);

  assert.deepEqual(
    (await database.prepare("SELECT id FROM handoff_version WHERE handoff_id = 'handoff-1' ORDER BY created_at, id").all()).map((row) => row.id),
    ["version-1", "version-2", concurrentVersion.versionId],
  );
  assert.deepEqual(
    readdirSync(path.join(dataDirectory, "objects")).filter((name) => !name.endsWith(".json")),
    storedObjectsBeforeStaleCapture,
  );
});
