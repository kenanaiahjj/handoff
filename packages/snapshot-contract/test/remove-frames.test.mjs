import assert from "node:assert/strict";
import test from "node:test";
import { createSnapshotEnvelope, removedFrameRecords, removeFramesFromSnapshot } from "../src/index.ts";

const m = (value) => ({ value, unit: "px", provenance: "source", sourceProperty: "x" });
const bounds = (x, y, w, h) => ({ x: m(x), y: m(y), width: m(w), height: m(h) });
const asset = (key) => ({ key, fileName: `${key}.png`, contentType: "image/png", sizeBytes: 1, sha256: "a".repeat(64), width: 10, height: 10 });

async function baseline() {
  const envelope = await createSnapshotEnvelope({
    schemaVersion: 1,
    source: "figma",
    sourceFileId: "file",
    sourceRevisionId: null,
    sourceFileName: "File",
    capturedAt: "2026-11-16T00:00:00.000Z",
    overviewAssetKey: "overview",
    canvasBounds: bounds(0, 0, 1000, 1000),
    frames: [
      { sourceFrameId: "keep", sourcePageId: "page", name: "Keep", bounds: bounds(0, 0, 100, 200), renderAssetKey: "keep-render", nodes: [] },
      { sourceFrameId: "drop", sourcePageId: "page", name: "Drop", bounds: bounds(300, 0, 100, 200), renderBounds: bounds(290, -10, 120, 220), renderAssetKey: "drop-render", nodes: [] },
    ],
    assets: [asset("overview"), asset("keep-render"), asset("drop-render")],
    sourceMetadata: { captureScope: "page" },
  });
  assert.ok(envelope.success, JSON.stringify(envelope.error?.issues));
  return envelope.data;
}

test("removing screens keeps the rest, drops their assets, and records the cut-out", async () => {
  const source = await baseline();
  const { snapshot, removed } = removeFramesFromSnapshot(source, ["drop"]);
  assert.deepEqual(snapshot.frames.map((frame) => frame.sourceFrameId), ["keep"]);
  assert.deepEqual(snapshot.assets.map((entry) => entry.key).sort(), ["keep-render", "overview"]);
  assert.deepEqual(removed, [{ sourceFrameId: "drop", name: "Drop", sourcePageId: "page", x: 290, y: -10, width: 120, height: 220 }]);
  assert.deepEqual(removedFrameRecords(snapshot.sourceMetadata), removed);
  const finalized = await createSnapshotEnvelope(snapshot);
  assert.ok(finalized.success);
  assert.notEqual(finalized.data.contentHash, source.contentHash);
});

test("cannot remove every screen or an unknown one", async () => {
  const source = await baseline();
  assert.throws(() => removeFramesFromSnapshot(source, ["keep", "drop"]), /at least one screen/);
  assert.throws(() => removeFramesFromSnapshot(source, ["missing"]), /not in this version/);
});
