import assert from "node:assert/strict";
import { brotliCompressSync } from "node:zlib";
import test, { after } from "node:test";
import { setDatabasePoolForTests } from "../db.ts";
import { createPostgresTestDatabase } from "../test-support/postgres-test-database.mjs";

const fixture = await createPostgresTestDatabase({ seed: true });
const previousPool = globalThis.__asbirDatabase;
setDatabasePoolForTests(fixture.pool);
after(async () => {
  setDatabasePoolForTests(previousPool);
  await fixture.close();
});

const { readScreenNodes, storeScreenCopies } = await import("./frame-store.ts");
const { getVersionRecord } = await import("../repositories/versions.ts");
const { deleteHandoffVersionInDatabase } = await import("./handoff-lifecycle.ts");
const { getDatabase } = await import("../db.ts");

const workspaceId = "local-test-workspace";
const measure = (value) => ({ value, unit: "px", provenance: "source" });
const frame = (id, name) => ({
  sourceFrameId: id,
  sourcePageId: "0:1",
  name,
  renderAssetKey: `render-${id}`,
  bounds: { x: measure(0), y: measure(0), width: measure(393), height: measure(852) },
  nodes: [{ sourceNodeId: id, parentSourceNodeId: null, sourceFrameId: id, name, type: "FRAME" }],
});

async function insertVersion(id, snapshot, createdAt) {
  await fixture.pool.query(
    `INSERT INTO handoff_version (id, workspace_id, handoff_id, version_label, source, source_file_id, captured_at,
       content_hash, snapshot_json, created_by_user_id, created_at)
     VALUES ($1, $2, 'h1', $1, 'figma', 'file', $3, $4, '{}', 'local-test-user', $3)`,
    [id, workspaceId, createdAt, snapshot.contentHash],
  );
  const json = JSON.stringify(snapshot);
  await fixture.pool.query(
    "INSERT INTO handoff_version_snapshot (version_id, encoding, compressed, raw_bytes, frame_index) VALUES ($1, 'br', $2, $3, '[]')",
    [id, brotliCompressSync(Buffer.from(json)), json.length],
  );
}

await fixture.pool.query(`
  INSERT INTO handoff (id, workspace_id, project_id, name, created_by_user_id, created_at)
  VALUES ('h1', 'local-test-workspace', 'local-test-project', 'Screens', 'local-test-user', '2026-11-18T00:00:00.000Z');
`);
const first = { contentHash: "a".repeat(64), overviewAssetKey: "overview", assets: [], sourceMetadata: {}, frames: [frame("1:1", "Home"), frame("1:2", "Search")] };
const second = { ...first, contentHash: "b".repeat(64), frames: [frame("1:1", "Home"), frame("1:3", "Checkout")] };
await insertVersion("v1", first, "2026-11-18T00:00:01.000Z");
await insertVersion("v2", second, "2026-11-18T00:00:02.000Z");

const chunkCount = async () => Number((await fixture.pool.query("SELECT count(*) AS count FROM handoff_snapshot_frame_chunk")).rows[0].count);

test("a screen is read from the whole capture until its own copy exists, then from that copy", async () => {
  const version = await getVersionRecord({ workspaceId, versionId: "v1" });
  assert.deepEqual(await readScreenNodes(version, "1:2"), first.frames[1].nodes);
  assert.equal(await readScreenNodes(version, "missing"), null);

  await storeScreenCopies(workspaceId, "v1", first);
  await storeScreenCopies(workspaceId, "v1", first); // already saved: a no-op, not an error
  assert.equal(await chunkCount(), 2);

  // With the whole capture emptied, the screen still comes from its own copy.
  await fixture.pool.query("UPDATE handoff_version_snapshot SET compressed = $1 WHERE version_id = 'v1'", [brotliCompressSync(Buffer.from("{}"))]);
  assert.deepEqual(await readScreenNodes(version, "1:1"), first.frames[0].nodes);
});

test("unchanged screens are shared between versions, and deleting a version removes only screens nobody uses", async () => {
  await storeScreenCopies(workspaceId, "v2", second);
  assert.equal(await chunkCount(), 3, "Home is stored once for both versions");

  await deleteHandoffVersionInDatabase(getDatabase(), { workspaceId, projectId: "local-test-project", handoffId: "h1", versionId: "v1" });
  assert.equal(await chunkCount(), 2, "Search went with v1; Home stays for v2");
  const version = await getVersionRecord({ workspaceId, versionId: "v2" });
  assert.deepEqual(await readScreenNodes(version, "1:1"), second.frames[0].nodes);
  assert.deepEqual(await readScreenNodes(version, "1:3"), second.frames[1].nodes);
});
