import assert from "node:assert/strict";
import test from "node:test";
import { canvasAnnotationAnchorError } from "./canvas-annotation-anchor.ts";

const measurement = (value) => ({ value, unit: "px", provenance: "source", sourceProperty: "fixture" });
const frame = {
  sourceFrameId: "screen-1",
  bounds: { width: measurement(320), height: measurement(640) },
  nodes: [{ sourceNodeId: "button-1" }],
};
const snapshot = {
  overviewAssetKey: "overview",
  canvasBounds: { width: measurement(1000), height: measurement(800) },
  assets: [{ key: "overview", width: 900, height: 700 }],
  frames: [frame],
};

test("accepts canvas anchors at the source canvas boundary", () => {
  assert.equal(canvasAnnotationAnchorError(snapshot, {
    frameId: "__overview__",
    sourceNodeId: null,
    x: 1000,
    y: 800,
  }), null);
});

test("rejects canvas anchors outside bounds or attached to a layer", () => {
  assert.equal(canvasAnnotationAnchorError(snapshot, {
    frameId: "__overview__",
    sourceNodeId: null,
    x: 1001,
    y: 40,
  }), "The annotation point is outside the canvas bounds.");
  assert.equal(canvasAnnotationAnchorError(snapshot, {
    frameId: "__overview__",
    sourceNodeId: "button-1",
    x: 40,
    y: 40,
  }), "A canvas point cannot be linked to a layer.");
});

test("uses overview asset dimensions when captured canvas bounds are unavailable", () => {
  const snapshotWithoutCanvasBounds = { ...snapshot, canvasBounds: undefined };
  assert.equal(canvasAnnotationAnchorError(snapshotWithoutCanvasBounds, {
    frameId: "__overview__",
    sourceNodeId: null,
    x: 900,
    y: 700,
  }), null);
  assert.equal(canvasAnnotationAnchorError(snapshotWithoutCanvasBounds, {
    frameId: "__overview__",
    sourceNodeId: null,
    x: 901,
    y: 40,
  }), "The annotation point is outside the canvas bounds.");
});

test("validates screen anchors and selected-layer membership", () => {
  assert.equal(canvasAnnotationAnchorError(snapshot, {
    frameId: "screen-1",
    sourceNodeId: "button-1",
    x: 320,
    y: 640,
  }), null);
  assert.equal(canvasAnnotationAnchorError(snapshot, {
    frameId: "missing-screen",
    sourceNodeId: null,
    x: 10,
    y: 10,
  }), "Choose a screen in this version.");
  assert.equal(canvasAnnotationAnchorError(snapshot, {
    frameId: "screen-1",
    sourceNodeId: "missing-layer",
    x: 10,
    y: 10,
  }), "The selected layer is not in this screen.");
  assert.equal(canvasAnnotationAnchorError(snapshot, {
    frameId: "screen-1",
    sourceNodeId: null,
    x: -1,
    y: 10,
  }), "The annotation point is outside the screen bounds.");
});
