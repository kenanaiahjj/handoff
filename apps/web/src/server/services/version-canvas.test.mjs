import assert from "node:assert/strict";
import { brotliCompressSync } from "node:zlib";
import test, { after } from "node:test";
import { setDatabasePoolForTests } from "../db.ts";
import { createPostgresTestDatabase } from "../test-support/postgres-test-database.mjs";
import { summarizeCanvasNode } from "../../components/canvas/canvas-node-summary.ts";

const fixture = await createPostgresTestDatabase({ seed: true });
const previousPool = globalThis.__asbirDatabase;
setDatabasePoolForTests(fixture.pool);
after(async () => {
  setDatabasePoolForTests(previousPool);
  await fixture.close();
});

const { getCanvasVersion, slimCanvasSnapshot, forgetCanvasMemoryForTests } = await import("./version-canvas.ts");

const measure = (value) => ({ value, unit: "px", provenance: "source", sourceProperty: "x" });
const fullNode = (id, frameId, extra = {}) => ({
  sourceNodeId: id,
  parentSourceNodeId: id === frameId ? null : frameId,
  sourceFrameId: frameId,
  name: "Layer " + id,
  type: "TEXT",
  visible: true,
  bounds: { x: measure(1), y: measure(2.5), width: measure(30), height: measure(null) },
  layoutBounds: { x: measure(1), y: measure(2.5), width: measure(30), height: measure(10) },
  layout: { mode: "NONE", constraints: { horizontal: "MIN" } },
  padding: { top: measure(4) },
  margins: {},
  spacing: {},
  fills: [{ color: "#FF0000", opacity: measure(1) }, { color: null, opacity: measure(1) }],
  strokes: [{ color: "#000000", opacity: measure(1) }],
  styleReferences: [{ id: "s1" }],
  typography: { content: "Book a trip", fontFamily: "Inter", fontSize: measure(14) },
  tokens: [{ sourceId: "t1", name: "brand/red", value: "#FF0000", collectionId: null }],
  sourcePayload: { textSegments: [{ characters: "Book a trip" }], fillPaintDetails: [{}], ...extra },
});
const frameId = "1:1";
const snapshot = {
  contentHash: "a".repeat(64),
  overviewAssetKey: "overview",
  canvasBounds: { x: measure(0), y: measure(0), width: measure(400), height: measure(900) },
  sourceMetadata: { captureScope: { kind: "page" }, pageLayout: [] },
  assets: [],
  frames: [{
    sourceFrameId: frameId,
    sourcePageId: "0:1",
    name: "Home",
    renderAssetKey: "frame-001-home",
    bounds: { x: measure(0), y: measure(0), width: measure(393), height: measure(852) },
    nodes: [
      fullNode(frameId, frameId, { layoutGrids: [{ pattern: "COLUMNS" }] }),
      fullNode("1:2", frameId, { layerExportAssetKey: "layer-1-2" }),
      { ...fullNode("1:3", frameId), typography: null, tokens: [], visible: false },
    ],
  }],
};

await fixture.pool.query(`
  INSERT INTO handoff (id, workspace_id, project_id, name, created_by_user_id, created_at)
  VALUES ('h1', 'local-test-workspace', 'local-test-project', 'Canvas test', 'local-test-user', '2026-11-18T00:00:00.000Z');
`);
await fixture.pool.query(
  `INSERT INTO handoff_version (id, workspace_id, handoff_id, version_label, source, source_file_id, captured_at,
     content_hash, snapshot_json, created_by_user_id, created_at)
   VALUES ('v1', 'local-test-workspace', 'h1', '1.0', 'figma', 'file', '2026-11-18T00:00:00.000Z', $1, '{}', 'local-test-user', '2026-11-18T00:00:00.000Z')`,
  [snapshot.contentHash],
);
await fixture.pool.query(
  "INSERT INTO handoff_version_snapshot (version_id, encoding, compressed, raw_bytes, frame_index) VALUES ('v1', 'br', $1, $2, '[]')",
  [brotliCompressSync(Buffer.from(JSON.stringify(snapshot))), JSON.stringify(snapshot).length],
);
const input = { workspaceId: "local-test-workspace", versionId: "v1" };

test("the slim canvas copy gives the canvas exactly what the full capture did", () => {
  const slim = slimCanvasSnapshot(structuredClone(snapshot));
  const full = snapshot.frames[0];
  const slimFrame = slim.frames[0];
  assert.deepEqual(
    slimFrame.nodes.map((node) => summarizeCanvasNode(node, frameId)),
    full.nodes.map((node) => summarizeCanvasNode(node, frameId)),
  );
  assert.deepEqual(slimFrame.nodes.map((node) => node.sourcePayload.layerExportAssetKey), [undefined, "layer-1-2", undefined]);
  const { nodes: _slimNodes, ...slimFrameMeta } = slimFrame;
  const { nodes: _fullNodes, ...fullFrameMeta } = full;
  assert.deepEqual(slimFrameMeta, fullFrameMeta);
  assert.deepEqual(slim.sourceMetadata, snapshot.sourceMetadata);
  assert.ok(JSON.stringify(slim).length < JSON.stringify(snapshot).length);
});

test("the canvas copy is saved once and then read back from the database", async () => {
  forgetCanvasMemoryForTests();
  const first = await getCanvasVersion(input);
  assert.equal(first.frames, undefined);
  assert.equal(first.snapshot.frames[0].nodes.length, 3);
  const { rows } = await fixture.pool.query("SELECT format, content_hash FROM handoff_version_canvas WHERE version_id = 'v1'");
  assert.equal(rows.length, 1);

  // With the full capture gone, the saved copy alone must serve the page.
  forgetCanvasMemoryForTests();
  await fixture.pool.query("UPDATE handoff_version_snapshot SET compressed = $1 WHERE version_id = 'v1'", [brotliCompressSync(Buffer.from("{}"))]);
  try {
    const second = await getCanvasVersion(input);
    assert.deepEqual(second.snapshot, first.snapshot);
  } finally {
    await fixture.pool.query("UPDATE handoff_version_snapshot SET compressed = $1 WHERE version_id = 'v1'", [brotliCompressSync(Buffer.from(JSON.stringify(snapshot)))]);
  }
});

test("a damaged or missing canvas copy falls back to the full capture instead of failing", async () => {
  forgetCanvasMemoryForTests();
  const expected = slimCanvasSnapshot(snapshot);
  await fixture.pool.query("UPDATE handoff_version_canvas SET compressed = $1 WHERE version_id = 'v1'", [Buffer.from("not brotli")]);
  assert.deepEqual((await getCanvasVersion(input)).snapshot, expected);

  forgetCanvasMemoryForTests();
  await fixture.pool.query("UPDATE handoff_version_canvas SET content_hash = $1 WHERE version_id = 'v1'", ["b".repeat(64)]);
  assert.deepEqual((await getCanvasVersion(input)).snapshot, expected, "a copy for different content is not used");
});
