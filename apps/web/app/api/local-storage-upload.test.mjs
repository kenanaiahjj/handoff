import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createPostgresTestDatabase } from "@/src/server/test-support/postgres-test-database.mjs";
import { getDatabasePool, setDatabasePoolForTests } from "@/src/server/db.ts";
import { LocalObjectStore } from "@/src/server/storage/local-object-store.ts";
import { setObjectStoreForTests } from "@/src/server/storage/supabase-object-store.ts";

test("local signed uploads accept only declared bytes for the signed object key", async () => {
  const route = await import("../storage/v1/object/upload/sign/[bucket]/[key]/route.ts").catch(() => null);
  assert.ok(route, "the local Storage upload route must be available");
  assert.equal(typeof route.PUT, "function");

  const priorEnvironment = {
    NODE_ENV: process.env.NODE_ENV,
    ASBIR_LOCAL_DEV_MODE: process.env.ASBIR_LOCAL_DEV_MODE,
    ASBIR_LOCAL_STORAGE_SECRET: process.env.ASBIR_LOCAL_STORAGE_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    SUPABASE_STORAGE_BUCKET: process.env.SUPABASE_STORAGE_BUCKET,
  };
  process.env.NODE_ENV = "test";
  process.env.ASBIR_LOCAL_DEV_MODE = "1";
  process.env.ASBIR_LOCAL_STORAGE_SECRET = "local-storage-test-secret";
  process.env.BETTER_AUTH_URL = "http://localhost:3000";
  process.env.SUPABASE_STORAGE_BUCKET = "handoff-assets";

  const previousPool = globalThis.__asbirDatabase;
  const previousStore = globalThis.__asbirObjectStore;
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "asbir-local-storage-"));
  const localStore = new LocalObjectStore(dataDirectory);
  const database = await createPostgresTestDatabase({ seed: true });
  setDatabasePoolForTests(database.pool);
  setObjectStoreForTests(localStore);

  try {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
    await database.pool.query(await readFile(
      path.join(repositoryRoot, "supabase/migrations/20261117010000_package_import_uploads.sql"),
      "utf8",
    ));
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const key = "a".repeat(48);
    const now = new Date().toISOString();
    await getDatabasePool().query(
      `INSERT INTO package_import_upload
        (id, workspace_id, project_id, handoff_id, handoff_name, version_label, file_name, content_type,
         size_bytes, sha256, object_key, created_by_user_id, created_at, expires_at)
       VALUES ($1, 'local-test-workspace', 'local-test-project', NULL, 'Local upload', '1.0', 'image.png',
         'image/png', $2, $3, $4, 'local-test-user', $5, $6)`,
      ["local-upload-test", bytes.byteLength, createHash("sha256").update(bytes).digest("hex"), key, now, new Date(Date.now() + 60_000).toISOString()],
    );

    const credential = await localStore.createSignedUploadUrl(key);
    const request = new Request(credential.signedUrl, {
      method: "PUT",
      headers: { "Content-Type": "image/png" },
      body: bytes,
    });
    const response = await route.PUT(request, { params: Promise.resolve({ bucket: "handoff-assets", key }) });

    assert.equal(response.status, 201, `unexpected upload response: ${response.status} ${await response.clone().text()}`);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
    assert.deepEqual([...(await localStore.get(key)).bytes], [...bytes]);
  } finally {
    setDatabasePoolForTests(previousPool);
    setObjectStoreForTests(previousStore);
    await database.close();
    await rm(dataDirectory, { recursive: true, force: true });
    for (const [name, value] of Object.entries(priorEnvironment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
