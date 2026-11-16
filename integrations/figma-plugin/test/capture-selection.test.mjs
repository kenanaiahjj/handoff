import assert from "node:assert/strict";
import test from "node:test";
import { filterCaptureToFrameIds } from "../src/capture-selection.ts";

test("filters a capture by frame ID and recomputes its included export report", () => {
  const capture = {
    type: "capture-ready",
    scope: "page",
    captureAllTopLevel: false,
    excludedTopLevelSections: [],
    excludedSectionCounts: [],
    payload: {
      frames: [
        { sourceFrameId: "frame-a", renderAssetKey: "render-a", vectorAssetKey: "vector-a", nodes: [] },
        { sourceFrameId: "frame-b", renderAssetKey: "render-b", vectorAssetKey: "vector-b", nodes: [] },
      ],
      sourceMetadata: {
        vectorSourcePreserved: true,
        vectorSourceFrameCount: 2,
        layerExportAssetCount: 2,
        layerExportSkippedCount: 2,
        captureWarnings: [
          "Styles could not be resolved.",
          "Selected 3 of 4 eligible layer assets because Handoff limits individual layer exports to 256 per capture.",
        ],
      },
    },
    renders: [{ key: "render-a" }, { key: "render-b" }],
    vectorRenders: [{ key: "vector-a" }, { key: "vector-b" }],
    layerRenders: [
      { key: "layer-a", sourceFrameId: "frame-a" },
      { key: "layer-b", sourceFrameId: "frame-b" },
    ],
    warnings: [
      "Styles could not be resolved.",
      "Selected 3 of 4 eligible layer assets because Handoff limits individual layer exports to 256 per capture.",
    ],
    layerAssetReport: {
      mode: "recommended",
      limit: 256,
      eligibleCount: 4,
      modeSkippedCount: 0,
      limitSkippedCount: 1,
      selectedCount: 3,
      exportedCount: 2,
      exportFailureCount: 1,
      sizeSkippedCount: 0,
      fallbackCount: 0,
      frames: [
        {
          sourceFrameId: "frame-a",
          frameName: "Frame A",
          eligibleCount: 2,
          modeSkippedCount: 0,
          candidateCount: 2,
          limitSkippedCount: 0,
          selectedCount: 2,
          exportedCount: 1,
          exportFailureCount: 1,
          sizeSkippedCount: 0,
          fallbackCount: 0,
        },
        {
          sourceFrameId: "frame-b",
          frameName: "Frame B",
          eligibleCount: 2,
          modeSkippedCount: 0,
          candidateCount: 2,
          limitSkippedCount: 1,
          selectedCount: 1,
          exportedCount: 1,
          exportFailureCount: 0,
          sizeSkippedCount: 0,
          fallbackCount: 0,
        },
      ],
    },
  };

  const filtered = filterCaptureToFrameIds(capture, new Set(["frame-a"]));

  assert.deepEqual(filtered.payload.frames.map((frame) => frame.sourceFrameId), ["frame-a"]);
  assert.deepEqual(filtered.renders.map((asset) => asset.key), ["render-a"]);
  assert.deepEqual(filtered.vectorRenders.map((asset) => asset.key), ["vector-a"]);
  assert.deepEqual(filtered.layerRenders.map((asset) => asset.key), ["layer-a"]);
  assert.equal(filtered.layerAssetReport.eligibleCount, 2);
  assert.equal(filtered.layerAssetReport.exportedCount, 1);
  assert.equal(filtered.payload.sourceMetadata.layerExportAssetCount, 1);
  assert.equal(filtered.payload.sourceMetadata.layerExportSkippedCount, 1);
  assert.equal(filtered.payload.sourceMetadata.vectorSourceFrameCount, 1);
  assert.equal(filtered.payload.sourceMetadata.vectorSourcePreserved, true);
  assert.deepEqual(filtered.warnings, [
    "Styles could not be resolved.",
    "1 individual layer image/vector export could not be generated. Their frame renders and structured layer data were retained.",
  ]);

  const empty = filterCaptureToFrameIds(capture, new Set());
  assert.equal(empty.payload.frames.length, 0);
  assert.equal(empty.renders.length, 0);
  assert.equal(empty.vectorRenders.length, 0);
  assert.equal(empty.layerRenders.length, 0);
  assert.equal(empty.layerAssetReport.eligibleCount, 0);
  assert.equal(empty.payload.sourceMetadata.vectorSourcePreserved, false);
});
