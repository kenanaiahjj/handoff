import assert from "node:assert/strict";
import test from "node:test";
import { createSnapshotEnvelope } from "../src/envelope.ts";
import { hashSnapshotPayload } from "../src/hash.ts";
import { snapshotEnvelopeSchema } from "../src/schema.ts";

function measurement(value = 0) {
  return { value, unit: "px", provenance: "source", sourceProperty: "x" };
}

function snapshotPayload() {
  const bounds = {
    x: measurement(),
    y: measurement(),
    width: measurement(440),
    height: measurement(956),
  };
  const frameId = " frame-id ";
  return {
    schemaVersion: 1,
    source: "figma",
    sourceFileId: "file-id",
    sourceRevisionId: null,
    sourceFileName: "Tripket",
    capturedAt: "2026-11-09T00:00:00.000Z",
    overviewAssetKey: "overview",
    frames: [{
      sourceFrameId: frameId,
      sourcePageId: "page-id",
      name: "Home",
      bounds,
      renderAssetKey: "frame-render",
      nodes: [{
        sourceNodeId: "node-id",
        parentSourceNodeId: null,
        sourceFrameId: frameId,
        name: "Home",
        type: "FRAME",
        visible: true,
        bounds,
        layout: { mode: null, direction: null, primaryAxisAlign: null, counterAxisAlign: null, wrap: null, constraints: {} },
        padding: { top: measurement(), right: measurement(), bottom: measurement(), left: measurement() },
        margins: { top: measurement(), right: measurement(), bottom: measurement(), left: measurement() },
        spacing: { rowGap: measurement(), columnGap: measurement(), itemGap: measurement() },
        fills: [],
        strokes: [],
        styleReferences: [],
        typography: null,
        tokens: [],
        sourcePayload: {},
      }],
    }],
    assets: [
      { key: "overview", fileName: "overview.png", contentType: "image/png", sizeBytes: 1, sha256: "a".repeat(64), width: 1, height: 1 },
      { key: "frame-render", fileName: "frame.png", contentType: "image/png", sizeBytes: 1, sha256: "b".repeat(64), width: 1, height: 1 },
    ],
    sourceMetadata: { captureScope: "page" },
  };
}

test("createSnapshotEnvelope hashes the validated snapshot that the server receives", async () => {
  const result = await createSnapshotEnvelope(snapshotPayload());

  assert.equal(result.success, true);
  if (!result.success) return;

  const serverParsed = snapshotEnvelopeSchema.parse(JSON.parse(JSON.stringify(result.data)));
  assert.equal(serverParsed.frames[0].sourceFrameId, "frame-id");
  assert.equal(serverParsed.contentHash, await hashSnapshotPayload(serverParsed));
});
