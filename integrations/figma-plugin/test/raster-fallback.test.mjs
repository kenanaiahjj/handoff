import assert from "node:assert/strict";
import test from "node:test";
import { isRejectedSvgAssetResponse, makeRasterOnlyFallback } from "../src/raster-fallback.ts";

function asset(key, contentType) {
  return { key, fileName: `${key}.${contentType === "image/svg+xml" ? "svg" : "png"}`, contentType, sizeBytes: 12, sha256: "a".repeat(64), width: 10, height: 10 };
}

test("removes rejected SVG assets and references while retaining PNG renders and layer data", () => {
  const snapshot = {
    schemaVersion: 1,
    source: "figma",
    sourceFileId: "file-1",
    sourceRevisionId: null,
    sourceFileName: "Tripket",
    capturedAt: "2026-11-07T00:00:00.000Z",
    contentHash: "b".repeat(64),
    overviewAssetKey: "overview",
    frames: [
      { sourceFrameId: "frame-1", name: "Book", renderAssetKey: "frame-png", vectorAssetKey: "frame-svg", nodes: [
        { sourceNodeId: "node-1", sourcePayload: { layerExportAssetKey: "layer-svg", layerExportContentType: "image/svg+xml", keep: "metadata" } },
      ] },
    ],
    assets: [asset("overview", "image/png"), asset("frame-png", "image/png"), asset("frame-svg", "image/svg+xml"), asset("layer-svg", "image/svg+xml"), asset("layer-png", "image/png")],
    sourceMetadata: { captureWarnings: ["Existing warning"], vectorSourcePreserved: true, vectorSourceFrameCount: 1, layerExportAssetCount: 2 },
  };
  const captures = {
    vectorRenders: [{ key: "frame-svg", contentType: "image/svg+xml" }, { key: "frame-png", contentType: "image/png" }],
    layerRenders: [{ key: "layer-svg", contentType: "image/svg+xml" }, { key: "layer-png", contentType: "image/png" }],
  };

  const result = makeRasterOnlyFallback(snapshot, captures);

  assert.deepEqual(result.removedAssetKeys, ["frame-svg", "layer-svg"]);
  assert.deepEqual(result.snapshot.assets.map(({ key }) => key), ["overview", "frame-png", "layer-png"]);
  assert.equal(result.snapshot.frames[0].vectorAssetKey, undefined);
  assert.deepEqual(result.snapshot.frames[0].nodes[0].sourcePayload, { keep: "metadata" });
  assert.equal(result.snapshot.sourceMetadata.vectorSourcePreserved, false);
  assert.equal(result.snapshot.sourceMetadata.vectorSourceFrameCount, 0);
  assert.equal(result.snapshot.sourceMetadata.layerExportAssetCount, 1);
  assert.deepEqual(result.snapshot.sourceMetadata.captureWarnings.slice(0, 1), ["Existing warning"]);
  assert.match(result.snapshot.sourceMetadata.captureWarnings.at(-1), /SVG assets were omitted/);
  assert.deepEqual(result.vectorRenders.map(({ key }) => key), ["frame-png"]);
  assert.deepEqual(result.layerRenders.map(({ key }) => key), ["layer-png"]);
});

test("does not remove unrelated assets or alter a snapshot that has no SVG assets", () => {
  const snapshot = {
    schemaVersion: 1,
    source: "figma",
    sourceFileId: "file-1",
    sourceRevisionId: null,
    sourceFileName: "Tripket",
    capturedAt: "2026-11-07T00:00:00.000Z",
    contentHash: "b".repeat(64),
    overviewAssetKey: "overview",
    frames: [{ sourceFrameId: "frame-1", name: "Book", renderAssetKey: "frame-png", nodes: [] }],
    assets: [asset("overview", "image/png"), asset("frame-png", "image/png")],
    sourceMetadata: { captureWarnings: [], vectorSourcePreserved: false, vectorSourceFrameCount: 0, layerExportAssetCount: 0 },
  };

  const result = makeRasterOnlyFallback(snapshot, { vectorRenders: [], layerRenders: [] });

  assert.deepEqual(result.removedAssetKeys, []);
  const { contentHash: _contentHash, ...snapshotPayload } = snapshot;
  assert.deepEqual(result.snapshot, snapshotPayload);
});

test("only retries HTTP 415 responses that identify rejected SVG content", () => {
  assert.equal(isRejectedSvgAssetResponse(415, 'The SVG render "frame.svg" contains unsupported active content.'), true);
  assert.equal(isRejectedSvgAssetResponse(400, "Malformed snapshot payload."), false);
  assert.equal(isRejectedSvgAssetResponse(415, "Capture token expired."), false);
});
