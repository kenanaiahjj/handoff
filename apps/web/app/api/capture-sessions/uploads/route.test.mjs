import assert from "node:assert/strict";
import test from "node:test";
import { createPostgresTestDatabase } from "../../../../src/server/test-support/postgres-test-database.mjs";
import { getDatabase, setDatabasePoolForTests } from "../../../../src/server/db.ts";
import { setObjectStoreForTests } from "../../../../src/server/storage/supabase-object-store.ts";
import { createCaptureSession } from "../../../../src/server/repositories/capture-sessions.ts";

process.env.NODE_ENV = "test";
process.env.SUPABASE_STORAGE_URL ??= "https://storage.invalid";
const { POST } = await import("./route.ts");

const sha = (character) => character.repeat(64);
const declaration = (assetCount, renew = false) => ({
  snapshot: { sizeBytes: 100, sha256: sha("a"), encoding: "gzip" },
  assets: Array.from({ length: assetCount }, (_, index) => ({ assetKey: `frame-${index}`, fileName: `frame-${index}.png`, contentType: "image/png", sizeBytes: 10, sha256: sha("b") })),
  ...(renew ? { renew: true } : {}),
});

async function withCapture(run) {
  const fixture = await createPostgresTestDatabase();
  setDatabasePoolForTests(fixture.pool);
  setObjectStoreForTests({
    async createSignedUploadUrl(key) { return { signedUrl: `https://storage.invalid/${key}`, token: `signed-${key}` }; },
    async delete() {},
  });
  try {
    const db = getDatabase();
    await db.prepare(`INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES ('owner', 'Olive', 'owner@example.invalid', true, now(), now())`).run();
    await db.prepare("INSERT INTO workspace (id, name, created_by_user_id, created_at) VALUES ('w', 'Asbir', 'owner', now())").run();
    await db.prepare("INSERT INTO workspace_membership VALUES ('w', 'owner', 'owner', now())").run();
    await db.prepare("INSERT INTO project (id, workspace_id, name, created_by_user_id, created_at) VALUES ('p', 'w', 'Tripket', 'owner', now())").run();
    const { token, id } = await createCaptureSession({ workspaceId: "w", projectId: "p", handoffId: null, handoffName: "Checkout", versionLabel: "1.0", releaseNote: null, createdBy: "owner" });
    const send = (body) => POST(new Request("http://localhost/api/capture-sessions/uploads", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) }));
    await run({ db, send, sessionId: id });
  } finally {
    setObjectStoreForTests(undefined);
    setDatabasePoolForTests(undefined);
    await fixture.close();
  }
}

test("declaring uploads stores every file in one go and repeats return the same slots", async () => {
  await withCapture(async ({ db, send, sessionId }) => {
    const first = await send(declaration(300));
    assert.equal(first.status, 200);
    const body = await first.json();
    assert.equal(body.uploads.length, 300);
    const rows = await db.prepare("SELECT upload_kind AS kind, size_bytes AS size FROM capture_upload WHERE capture_session_id = ? AND is_current").all(sessionId);
    assert.equal(rows.length, 301);
    assert.equal(Number(rows.find((row) => row.kind === "snapshot").size), 100);

    const again = await (await send(declaration(300))).json();
    assert.equal(again.snapshot.path, body.snapshot.path);
    assert.deepEqual(again.uploads.map((upload) => upload.path), body.uploads.map((upload) => upload.path));
  });
});

test("renewing retires the old slots, and a capture can only be renewed so many times", async () => {
  await withCapture(async ({ db, send, sessionId }) => {
    const first = await (await send(declaration(3))).json();
    const renewed = await send(declaration(3, true));
    assert.equal(renewed.status, 200);
    assert.notEqual((await renewed.json()).snapshot.path, first.snapshot.path);
    const abandoned = await db.prepare("SELECT object_key AS key FROM capture_upload_abandoned").all();
    assert.equal(abandoned.length, 4);
    assert.ok(abandoned.some((row) => row.key === first.snapshot.path));
    assert.equal((await db.prepare("SELECT count(*)::int AS n FROM capture_upload WHERE capture_session_id = ? AND is_current").get(sessionId)).n, 4);

    for (let renewal = 2; renewal <= 10; renewal += 1) assert.equal((await send(declaration(3, true))).status, 200);
    const refused = await send(declaration(3, true));
    assert.equal(refused.status, 409);
    assert.match((await refused.json()).error, /restarted too many times/);
  });
});
