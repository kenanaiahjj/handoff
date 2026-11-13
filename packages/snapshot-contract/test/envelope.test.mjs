import assert from "node:assert/strict";
import test from "node:test";
import { createSnapshotEnvelope } from "../src/envelope.ts";
import { countBlankFrameNames, findDuplicateFrameNames } from "../src/frame-names.ts";
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

test("accepts blank and duplicate Figma screen names so naming warnings do not block upload", async () => {
  const payload = snapshotPayload();
  const sourceFrame = payload.frames[0];
  const blankFrame = structuredClone(sourceFrame);
  blankFrame.sourceFrameId = "blank-frame-id";
  blankFrame.name = "";
  blankFrame.renderAssetKey = "blank-frame-render";
  blankFrame.nodes = blankFrame.nodes.map((node) => ({
    ...node,
    sourceFrameId: blankFrame.sourceFrameId,
    sourceNodeId: "blank-frame-node-id",
  }));

  const duplicateFrame = structuredClone(sourceFrame);
  duplicateFrame.sourceFrameId = "duplicate-frame-id";
  duplicateFrame.name = sourceFrame.name;
  duplicateFrame.renderAssetKey = "duplicate-frame-render";
  duplicateFrame.nodes = duplicateFrame.nodes.map((node) => ({
    ...node,
    sourceFrameId: duplicateFrame.sourceFrameId,
    sourceNodeId: "duplicate-frame-node-id",
  }));

  payload.frames.push(blankFrame, duplicateFrame);
  payload.assets.push(
    { key: "blank-frame-render", fileName: "blank-frame.png", contentType: "image/png", sizeBytes: 1, sha256: "c".repeat(64), width: 1, height: 1 },
    { key: "duplicate-frame-render", fileName: "duplicate-frame.png", contentType: "image/png", sizeBytes: 1, sha256: "d".repeat(64), width: 1, height: 1 },
  );

  const result = await createSnapshotEnvelope(payload);

  assert.equal(result.success, true);
  assert.equal(countBlankFrameNames(payload.frames), 1);
  assert.deepEqual(findDuplicateFrameNames(payload.frames), [{ name: "Home", count: 2 }]);
  if (result.success) {
    assert.equal(result.data.frames[1].name, "");
    assert.equal(result.data.frames[2].name, "Home");
  }
});
