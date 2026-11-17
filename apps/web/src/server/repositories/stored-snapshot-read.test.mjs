import assert from "node:assert/strict";
import test from "node:test";
import { createSnapshotEnvelope, snapshotEnvelopeSchema } from "@asbir/snapshot-contract";
import { parseStoredSnapshot } from "./versions.ts";

const m = (value) => ({ value, unit: "px", provenance: "source", sourceProperty: "x" });
const bounds = (x, y, w, h) => ({ x: m(x), y: m(y), width: m(w), height: m(h) });
const asset = (key) => ({ key, fileName: `${key}.png`, contentType: "image/png", sizeBytes: 1, sha256: "a".repeat(64), width: 10, height: 10 });

async function storedCapture() {
  const envelope = await createSnapshotEnvelope({
    schemaVersion: 1,
    source: "figma",
    sourceFileId: "file",
    sourceRevisionId: null,
    sourceFileName: "File",
    capturedAt: "2026-11-16T00:00:00.000Z",
    overviewAssetKey: "overview",
    canvasBounds: bounds(0, 0, 1000, 1000),
    frames: [{ sourceFrameId: "a", sourcePageId: "page", name: "Home", bounds: bounds(0, 0, 100, 200), renderAssetKey: "a-render", nodes: [] }],
    assets: [asset("overview"), asset("a-render")],
    sourceMetadata: { captureScope: "page" },
  });
  assert.ok(envelope.success);
  // What createHandoffVersion stores.
  return JSON.stringify(envelope.data);
}

test("reading a stored capture without re-validation gives exactly what full validation would", async () => {
  const json = await storedCapture();
  assert.deepEqual(parseStoredSnapshot(json), snapshotEnvelopeSchema.parse(JSON.parse(json)));
});

test("a damaged capture still goes through full validation and is rejected", () => {
  assert.throws(() => parseStoredSnapshot(JSON.stringify({ frames: "not a list" })));
  assert.throws(() => parseStoredSnapshot("{}"));
});
