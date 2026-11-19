import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { PostgresDatabase } from "../db.ts";
import { createPostgresTestDatabase } from "../test-support/postgres-test-database.mjs";
import { compressSnapshot, compressStoredSnapshots, decompressSnapshot, frameDesignHash, frameIndexForFrames, readSnapshotJson, refreshFrameIndexes } from "./snapshot-store.ts";

function legacyFrameDesignHash(frame) {
  function normalizeNumbers(value) {
    if (typeof value === "number") return Math.round(value * 1000) / 1000;
    if (Array.isArray(value)) return value.map(normalizeNumbers);
    if (value && typeof value === "object") {
      const record = value;
      if (record.unit === "px" && typeof record.value === "number") {
        return { ...record, value: Math.round(record.value * 2) / 2 };
      }
      return Object.fromEntries(Object.entries(record).map(([key, entry]) => [key, normalizeNumbers(entry)]));
    }
    return value;
  }
  const bounds = frame.bounds ?? {};
  const nodes = frame.nodes.map((node) => {
    const rest = { ...node };
    delete rest.name;
    if (rest.sourcePayload && typeof rest.sourcePayload === "object") {
      const payload = { ...rest.sourcePayload };
      delete payload.layerExportAssetKey;
      rest.sourcePayload = payload;
    }
    return rest;
  });
  const design = { width: normalizeNumbers(bounds.width), height: normalizeNumbers(bounds.height), nodes };
  return createHash("sha256").update(JSON.stringify(normalizeNumbers(design))).digest("hex");
}

async function createDatabase() {
  const fixture = await createPostgresTestDatabase();
  const database = new PostgresDatabase(fixture.pool);
  await database.prepare(`INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
    VALUES ('user-1', 'Test designer', 'designer@example.invalid', true, now(), now())`).run();
  await database.prepare("INSERT INTO workspace (id, name, created_by_user_id, created_at) VALUES ('ws', 'Workspace', 'user-1', now())").run();
  await database.prepare("INSERT INTO project (id, workspace_id, name, created_by_user_id, created_at) VALUES ('project-1', 'ws', 'Project', 'user-1', now())").run();
  await database.prepare(`INSERT INTO handoff (id, workspace_id, project_id, name, created_by_user_id, created_at)
    VALUES ('h', 'ws', 'project-1', 'Handoff', 'user-1', now())`).run();
  return { fixture, database };
}

// A capture-shaped payload large enough to show the size win, with characters outside ASCII.
const frames = Array.from({ length: 300 }, (_, index) => ({
  sourceFrameId: `1:${index}`,
  name: `Screen ${index} · Café`,
  renderAssetKey: `frame-${index}`,
  nodes: Array.from({ length: 20 }, (__, node) => ({ id: `${index}:${node}`, width: { value: 390.5 }, fills: ["#ff7a30"] })),
}));
const snapshotJson = JSON.stringify({ schemaVersion: 1, frames, contentHash: "a".repeat(64) });

async function insertVersion(database, id, json = snapshotJson) {
  await database.prepare(`INSERT INTO handoff_version
    (id, workspace_id, handoff_id, version_label, source, source_file_id, captured_at,
     content_hash, visual_only, snapshot_json, created_by_user_id, created_at)
    VALUES (?, 'ws', 'h', ?, 'figma', 'file', 'now', ?, false, ?, 'user-1', 'now')`)
    .run(id, id === "v1" ? "1.0" : id, "b".repeat(64), json);
}

async function assertUpdateRejected(database, sql) {
  await assert.rejects(
    database.transaction(async () => {
      await database.prepare(sql).run();
    })(),
    /Handoff versions are immutable/,
  );
}

test("existing captures are compressed, read back byte for byte, and keep a screen index", async () => {
  const { fixture, database } = await createDatabase();

  try {
    await insertVersion(database, "v1");
    assert.equal(await compressStoredSnapshots(database), 1);
    const cleared = await database.prepare("SELECT snapshot_json FROM handoff_version WHERE id = 'v1'").get();
    assert.equal(cleared.snapshot_json, "{}");
    assert.equal(await readSnapshotJson(database, "v1", "ws"), snapshotJson);

    const stored = await database.prepare("SELECT raw_bytes, length(compressed) AS size, frame_index FROM handoff_version_snapshot").get();
    assert.equal(stored.raw_bytes, Buffer.byteLength(snapshotJson));
    assert.ok(stored.size * 10 < stored.raw_bytes, `expected at least 10x smaller, got ${stored.raw_bytes} -> ${stored.size}`);
    const { designHash, designHashVersion, ...entry } = JSON.parse(stored.frame_index)[2];
    assert.ok(designHashVersion >= 1);
    assert.deepEqual(entry, { sourceFrameId: "1:2", name: "Screen 2 · Café", renderAssetKey: "frame-2" });
    assert.match(designHash, /^[0-9a-f]{64}$/);

    // Running again finds nothing left to do.
    assert.equal(await compressStoredSnapshots(database), 0);
  } finally {
    await fixture.close();
  }
});

test("chunked versions reuse unchanged screens and reject missing screen data", async () => {
  const { storeChunkedSnapshot, readChunkedFrame, readChunkedSnapshotJson } = await import("./snapshot-store.ts");
  const { fixture, database } = await createDatabase();
  try {
    await insertVersion(database, "chunk-v1", "{}");
    await insertVersion(database, "chunk-v2", "{}");
    const first = { schemaVersion: 1, frames: frames.slice(0, 3), contentHash: "a".repeat(64) };
    const second = { ...first, frames: [{ ...first.frames[0], name: "Changed" }, ...first.frames.slice(1)] };
    await database.transaction(async () => storeChunkedSnapshot(database, "ws", "chunk-v1", first))();
    await database.transaction(async () => storeChunkedSnapshot(database, "ws", "chunk-v2", second))();
    assert.deepEqual(JSON.parse(await readChunkedSnapshotJson(database, "chunk-v1", "ws")), first);
    assert.deepEqual(JSON.parse(await readChunkedSnapshotJson(database, "chunk-v2", "ws")), second);
    assert.deepEqual(await readChunkedFrame(database, "ws", "chunk-v2", "1:1"), first.frames[1]);
    assert.equal(await readChunkedFrame(database, "other", "chunk-v2", "1:1"), null);
    const { count } = await database.prepare("SELECT count(*) AS count FROM handoff_snapshot_frame_chunk").get();
    assert.equal(Number(count), 4);
    await database.prepare("UPDATE handoff_snapshot_frame_ref SET frame_id = 'wrong' WHERE version_id = 'chunk-v2' AND frame_position = 1").run();
    await assert.rejects(readChunkedFrame(database, "ws", "chunk-v2", "wrong"), /does not match/);
    await assert.rejects(readChunkedSnapshotJson(database, "chunk-v2", "ws"), /does not match/);
    await database.prepare("UPDATE handoff_snapshot_frame_ref SET frame_id = '1:1' WHERE version_id = 'chunk-v2' AND frame_position = 1").run();
    await database.prepare("UPDATE handoff_snapshot_frame_chunk SET compressed = ? WHERE content_hash = (SELECT content_hash FROM handoff_snapshot_frame_ref WHERE version_id = 'chunk-v2' AND frame_position = 0)").run(Buffer.from('damaged'));
    await assert.rejects(readChunkedFrame(database, "ws", "chunk-v2", "1:0"));
    await insertVersion(database, "chunk-v3", "{}");
    await assert.rejects(storeChunkedSnapshot(database, "ws", "chunk-v3", second));
    assert.equal(await readChunkedSnapshotJson(database, "chunk-v3", "ws"), null);
  } finally { await fixture.close(); }
});

test("a failed chunk write rolls back the entire version manifest", async () => {
  const { storeChunkedSnapshot, readChunkedSnapshotJson } = await import("./snapshot-store.ts");
  const { fixture, database } = await createDatabase();
  try {
    await insertVersion(database, "incomplete", "{}");
    await assert.rejects(storeChunkedSnapshot(database, "ws", "incomplete", {
      frames: [frames[0], { ...frames[1], sourceFrameId: frames[0].sourceFrameId }],
    }));
    assert.equal(await readChunkedSnapshotJson(database, "incomplete", "ws"), null);
    const { count } = await database.prepare("SELECT count(*) AS count FROM handoff_snapshot_frame_chunk").get();
    assert.equal(Number(count), 0);
  } finally { await fixture.close(); }
});

test("versions stay immutable apart from swapping in the verified compressed copy", async () => {
  const { fixture, database } = await createDatabase();

  try {
    await insertVersion(database, "v1");

    // No compressed copy yet: blanking the capture is refused.
    await assertUpdateRejected(database, "UPDATE handoff_version SET snapshot_json = '{}' WHERE id = 'v1'");

    await compressStoredSnapshots(database);
    // Any other change is still refused, even alongside the allowed one.
    await assertUpdateRejected(database, "UPDATE handoff_version SET version_label = 'Edited' WHERE id = 'v1'");
    await assertUpdateRejected(database, `UPDATE handoff_version SET snapshot_json = '{"x":1}' WHERE id = 'v1'`);
    const version = await database.prepare("SELECT version_label FROM handoff_version WHERE id = 'v1'").get();
    assert.equal(version.version_label, "1.0");
  } finally {
    await fixture.close();
  }
});

test("screen design fingerprints ignore renames but catch real changes", async () => {
  const frame = { name: "Screen - Home", bounds: { width: 390 }, nodes: [{ sourceNodeId: "1", name: "Button", fills: ["#ff7a30"], bounds: { width: 120 } }] };
  const renamed = { ...frame, name: "Home", nodes: [{ ...frame.nodes[0], name: "Primary button" }] };
  const resized = { ...frame, nodes: [{ ...frame.nodes[0], bounds: { width: 140 } }] };
  assert.equal(frameDesignHash(renamed), frameDesignHash(frame));
  assert.notEqual(frameDesignHash(resized), frameDesignHash(frame));
  assert.equal(frameDesignHash({ name: "Uploaded image", nodes: [] }), null, "visual-only screens fall back to their image");

  // Moving a screen on the Figma canvas, float noise and export file pointers don't count either.
  const m = (value) => ({ value, unit: "px" });
  const placed = { bounds: { x: m(-438), y: m(-2260), width: m(393), height: m(852) }, nodes: [{ sourceNodeId: "1", bounds: { x: m(193.6666717529297) }, sourcePayload: { opacity: 1, layerExportAssetKey: "merge-a-frame-1" } }] };
  const moved = { bounds: { x: m(-8647), y: m(-12295), width: m(393), height: m(852) }, nodes: [{ sourceNodeId: "1", bounds: { x: m(193.6669921875) }, sourcePayload: { opacity: 1, layerExportAssetKey: "merge-b-frame-1" } }] };
  assert.equal(frameDesignHash(moved), frameDesignHash(placed));
  const taller = { ...placed, bounds: { ...placed.bounds, height: m(900) } };
  assert.notEqual(frameDesignHash(taller), frameDesignHash(placed));
});

test("screen design fingerprints preserve their stored hash format", () => {
  const frame = {
    bounds: { width: { value: 393.7777, unit: "px", metric: { raw: 3.14159 } }, height: { value: 852.2222, unit: "px" } },
    nodes: [{
      sourceNodeId: "1:1",
      name: "Primary button",
      bounds: { x: { value: 193.6666717529297, unit: "px" }, width: { value: 120.12345, unit: "px" } },
      fills: [{ color: [0.123456, 0.5, 0.987654], opacity: 0.99991 }],
      sourcePayload: { label: "Save · 😀", opacity: 0.333333, layerExportAssetKey: "render-1" },
    }],
  };
  assert.equal(frameDesignHash(frame), legacyFrameDesignHash(frame));
});

test("capture compression preserves snapshot JSON and its index while enforcing a raw-size limit", async () => {
  const snapshot = {
    schemaVersion: 1,
    source: "figma",
    contentHash: "a".repeat(64),
    sourceMetadata: { longText: `${"x".repeat(16_383)}😀${"y".repeat(40_000)}` },
    frames: [{
      sourceFrameId: "1:0",
      name: "Home · Café",
      renderAssetKey: "frame-0",
      bounds: { width: { value: 390.6667, unit: "px" } },
      nodes: [{
        sourceNodeId: "1:1",
        name: "Primary button",
        bounds: { width: { value: 120.4999, unit: "px" } },
        sourcePayload: { opacity: 0.99991, layerExportAssetKey: "asset-1", label: "😀" },
      }],
    }],
  };
  const expectedJson = JSON.stringify(snapshot);
  const compressed = await compressSnapshot(snapshot);

  assert.equal(compressed.rawBytes, Buffer.byteLength(expectedJson, "utf8"));
  assert.equal(decompressSnapshot(compressed.encoding, compressed.compressed), expectedJson);
  assert.deepEqual(JSON.parse(compressed.frameIndex), JSON.parse(frameIndexForFrames(snapshot.frames)));
  await assert.rejects(compressSnapshot(snapshot, { maxRawBytes: Buffer.byteLength(expectedJson) - 1 }), /snapshot exceeds.*byte limit/i);
});

test("older screen indexes get design fingerprints added once", async () => {
  const { fixture, database } = await createDatabase();

  try {
    await insertVersion(database, "v1");
    await compressStoredSnapshots(database);
    // Simulate an index written before fingerprints existed.
    await database.prepare(`UPDATE handoff_version_snapshot SET frame_index = '[{"sourceFrameId":"1:0","name":"x","renderAssetKey":"frame-0"}]'`).run();
    assert.equal(await refreshFrameIndexes(database), 1);
    const row = await database.prepare("SELECT frame_index FROM handoff_version_snapshot").get();
    assert.match(JSON.parse(row.frame_index)[0].designHash, /^[0-9a-f]{64}$/);
    assert.equal(await refreshFrameIndexes(database), 0);
  } finally {
    await fixture.close();
  }
});
