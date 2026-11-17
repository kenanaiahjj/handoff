import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import test from "node:test";
import { PostgresDatabase } from "../../../../src/server/db.ts";
import { createPostgresTestDatabase } from "../../../../src/server/test-support/postgres-test-database.mjs";

const { createPackageImportHandlers } = await import("./package-import.ts");

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../../");
const migration = await readFile(path.join(repositoryRoot, "supabase/migrations/20261117010000_package_import_uploads.sql"), "utf8");
const userId = "package-import-test-user";
const workspaceId = "package-import-test-workspace";
const projectId = "package-import-test-project";
const packageBytes = new TextEncoder().encode("a staged ZIP payload");

async function setup({ authorizeProjectMember } = {}) {
  const fixture = await createPostgresTestDatabase();
  await fixture.pool.query(migration);
  const database = new PostgresDatabase(fixture.pool);
  await fixture.pool.query(
    `INSERT INTO "user" (id, name, email) VALUES ($1, 'Test User', 'package-import@example.invalid')`,
    [userId],
  );
  await fixture.pool.query(
    `INSERT INTO workspace (id, name, created_by_user_id, created_at) VALUES ($1, 'Test workspace', $2, now()::text)`,
    [workspaceId, userId],
  );
  await fixture.pool.query(
    `INSERT INTO project (id, workspace_id, name, created_by_user_id, created_at) VALUES ($1, $2, 'Test project', $3, now()::text)`,
    [projectId, workspaceId, userId],
  );

  const objects = new Map();
  const deletedKeys = [];
  const store = {
    async createSignedUploadUrl(key) {
      return { signedUrl: `https://storage.example.invalid/upload/${key}`, token: "signed-test-token" };
    },
    async get(key) {
      const object = objects.get(key);
      return object ? { bytes: object.bytes, contentType: object.contentType } : null;
    },
    async delete(key) {
      deletedKeys.push(key);
      objects.delete(key);
    },
  };
  let createVersionCalls = 0;
  let importCalls = 0;
  const handlers = createPackageImportHandlers({
    getDatabase: () => database,
    requireProjectMember: authorizeProjectMember ?? (async () => ({ userId, workspaceId, role: "designer", email: "package-import@example.invalid" })),
    storage: store,
    getStorageUrl: () => "https://storage.example.invalid",
    getObjectInfo: async (key) => {
      const object = objects.get(key);
      return object ? { size: object.bytes.byteLength, contentType: object.contentType } : null;
    },
    importSnapshotPackage: async (bytes) => {
      importCalls += 1;
      assert.deepEqual(bytes, packageBytes);
      return { snapshot: { marker: "parsed-package" }, assets: [] };
    },
    importImageOnly: async () => {
      throw new Error("The package test should not import images.");
    },
    createHandoffVersion: async () => {
      createVersionCalls += 1;
      return { handoffId: "created-handoff", versionId: "created-version" };
    },
  });

  return {
    fixture,
    database,
    handlers,
    objects,
    deletedKeys,
    get createVersionCalls() { return createVersionCalls; },
    get importCalls() { return importCalls; },
  };
}

function intentRequest(overrides = {}) {
  const bytes = overrides.bytes ?? packageBytes;
  const { bytes: _bytes, ...inputOverrides } = overrides;
  return new Request("https://app.example.invalid/api/uploads/packages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspaceId,
      projectId,
      handoffName: "Checkout",
      versionLabel: "1.0.0",
      fileName: "checkout.zip",
      sizeBytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      ...inputOverrides,
    }),
  });
}

test("package import uploads use staged Storage objects and finalize exactly once", async () => {
  const state = await setup();
  try {
    const intentResponse = await state.handlers.createIntent(intentRequest());
    assert.equal(intentResponse.status, 201);
    const intent = await intentResponse.json();
    assert.equal(intent.storageUrl, "https://storage.example.invalid");
    assert.equal(intent.bucket, "handoff-assets");
    assert.match(intent.path, /^[a-f0-9]{48}$/);
    assert.equal(intent.token, "signed-test-token");

    const [{ objectKey }] = await state.database.prepare(
      "SELECT object_key AS objectKey FROM package_import_upload WHERE id = ?",
    ).all(intent.uploadId);
    state.objects.set(objectKey, { bytes: packageBytes, contentType: "application/zip" });

    const finalizeRequest = new Request(`https://app.example.invalid/api/uploads/packages/${intent.uploadId}/finalize`, { method: "POST" });
    const first = await state.handlers.finalize(finalizeRequest, intent.uploadId);
    assert.equal(first.response.status, 201);
    assert.deepEqual(await first.response.json(), { handoffId: "created-handoff", versionId: "created-version" });
    assert.deepEqual(first.created, {
      workspaceId,
      handoffId: "created-handoff",
      versionId: "created-version",
      createdBy: userId,
    });
    assert.equal(state.objects.has(objectKey), false);
    const finalizedUpload = await state.database.prepare(
      "SELECT object_deleted_at AS objectDeletedAt FROM package_import_upload WHERE id = ?",
    ).get(intent.uploadId);
    assert.ok(finalizedUpload.objectDeletedAt);

    const replay = await state.handlers.finalize(finalizeRequest, intent.uploadId);
    assert.equal(replay.response.status, 200);
    assert.deepEqual(await replay.response.json(), { handoffId: "created-handoff", versionId: "created-version" });
    assert.equal(state.importCalls, 1);
    assert.equal(state.createVersionCalls, 1);
  } finally {
    await state.fixture.close();
  }
});

test("package import rejects a bad checksum and removes expired staged objects", async () => {
  const state = await setup();
  try {
    const intentResponse = await state.handlers.createIntent(intentRequest({ sha256: "0".repeat(64) }));
    assert.equal(intentResponse.status, 201);
    const intent = await intentResponse.json();
    const [{ objectKey }] = await state.database.prepare(
      "SELECT object_key AS objectKey FROM package_import_upload WHERE id = ?",
    ).all(intent.uploadId);
    state.objects.set(objectKey, { bytes: packageBytes, contentType: "application/zip" });

    const failed = await state.handlers.finalize(
      new Request("https://app.example.invalid/finalize", { method: "POST" }),
      intent.uploadId,
    );
    assert.equal(failed.response.status, 400);
    assert.equal(state.createVersionCalls, 0);

    const expiredId = "00000000-0000-4000-8000-000000000123";
    const expiredObjectKey = "a".repeat(48);
    await state.database.prepare(
      `INSERT INTO package_import_upload
        (id, workspace_id, project_id, handoff_name, version_label, file_name, content_type,
         size_bytes, sha256, object_key, created_by_user_id, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      expiredId, workspaceId, projectId, "Expired", "0.1", "expired.zip", "application/zip",
      packageBytes.byteLength, "b".repeat(64), expiredObjectKey, userId,
      "2026-11-15T00:00:00.000Z", "2026-11-16T00:00:00.000Z",
    );

    const replacement = await state.handlers.createIntent(intentRequest());
    assert.equal(replacement.status, 201);
    assert.ok(state.deletedKeys.includes(expiredObjectKey));
    const expiredRow = await state.database.prepare("SELECT id FROM package_import_upload WHERE id = ?").get(expiredId);
    assert.equal(expiredRow, undefined);
  } finally {
    await state.fixture.close();
  }
});

test("package import intent rejects oversized, unsupported, and oversized JSON requests", async () => {
  const state = await setup();
  try {
    assert.equal((await state.handlers.createIntent(intentRequest({ sizeBytes: 100_000_001 }))).status, 413);
    assert.equal((await state.handlers.createIntent(intentRequest({ fileName: "notes.txt" }))).status, 415);
    const tooLargeBody = " ".repeat(128_001);
    const tooLargeRequest = new Request("https://app.example.invalid/api/uploads/packages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: tooLargeBody,
    });
    assert.equal((await state.handlers.createIntent(tooLargeRequest)).status, 413);
  } finally {
    await state.fixture.close();
  }
});

test("package import intent requires manager authorization before staging an upload", async () => {
  const state = await setup({
    authorizeProjectMember: async () => {
      throw Object.assign(new Error("Only owners and designers can do this."), {
        name: "WorkspaceAccessError",
        status: 403,
      });
    },
  });
  try {
    const response = await state.handlers.createIntent(intentRequest());
    assert.equal(response.status, 403);
    const staged = await state.database.prepare("SELECT count(*)::integer AS count FROM package_import_upload").get();
    assert.equal(staged.count, 0);
  } finally {
    await state.fixture.close();
  }
});
