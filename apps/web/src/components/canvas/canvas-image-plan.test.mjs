import assert from "node:assert/strict";
import test from "node:test";
import { getCanvasImageRenderPlan } from "./canvas-image-plan.ts";

const overview = {
  kind: "overview",
  exact: true,
  changedOnly: false,
  frameVisible: true,
  hasScreenFrames: true,
  zoomScale: 0.075,
  overviewResolutionScale: 0.131,
};

test("keeps the composite overview at scales where it is not enlarged", () => {
  assert.deepEqual(getCanvasImageRenderPlan(overview), {
    showBaseImage: true,
    showFrameImages: false,
  });
});

test("overlays captured frame renders when zoom enlarges the overview past native resolution", () => {
  assert.deepEqual(getCanvasImageRenderPlan({ ...overview, zoomScale: 0.38 }), {
    showBaseImage: true,
    showFrameImages: true,
  });
});

test("shows only individual changed frames in changed-only mode", () => {
  assert.deepEqual(getCanvasImageRenderPlan({ ...overview, changedOnly: true }), {
    showBaseImage: false,
    showFrameImages: true,
  });
});

test("hides both images when changed-only mode has no changed frames", () => {
  assert.deepEqual(getCanvasImageRenderPlan({ ...overview, changedOnly: true, hasScreenFrames: false }), {
    showBaseImage: false,
    showFrameImages: false,
  });
});

test("uses the composite for inexact overviews and never invents frame-image positioning", () => {
  assert.deepEqual(getCanvasImageRenderPlan({ ...overview, exact: false, zoomScale: 0.8 }), {
    showBaseImage: true,
    showFrameImages: false,
  });
  assert.deepEqual(getCanvasImageRenderPlan({ ...overview, exact: false, changedOnly: true }), {
    showBaseImage: false,
    showFrameImages: false,
  });
});

test("keeps selected-frame images subject to the changed-only filter", () => {
  assert.deepEqual(getCanvasImageRenderPlan({ ...overview, kind: "frame", zoomScale: 0.8 }), {
    showBaseImage: true,
    showFrameImages: false,
  });
  assert.deepEqual(getCanvasImageRenderPlan({ ...overview, kind: "frame", changedOnly: true, frameVisible: false }), {
    showBaseImage: false,
    showFrameImages: false,
  });
  assert.deepEqual(getCanvasImageRenderPlan({ ...overview, kind: "frame", changedOnly: true, frameVisible: true }), {
    showBaseImage: true,
    showFrameImages: false,
  });
});
