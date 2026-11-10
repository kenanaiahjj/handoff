import assert from "node:assert/strict";
import test from "node:test";
import { canvasAnchorAtPoint, canvasAnchorToViewportPoint, overviewCanvasFrameId } from "./canvas-anchor.ts";

const overview = {
  id: overviewCanvasFrameId,
  kind: "overview",
  sourceX: 100,
  sourceY: 200,
  sourceWidth: 1000,
  sourceHeight: 800,
};
const screen = {
  id: "screen-1",
  kind: "frame",
  sourceX: 200,
  sourceY: 300,
  sourceWidth: 320,
  sourceHeight: 640,
};

test("clicks within a screen become screen-relative anchors and preserve the selected layer", () => {
  assert.deepEqual(canvasAnchorAtPoint(overview, [screen], { x: 130, y: 150 }, "button-1"), {
    frameId: "screen-1",
    sourceNodeId: "button-1",
    x: 30,
    y: 50,
  });
});

test("clicks in empty overview space become canvas anchors without a layer", () => {
  assert.deepEqual(canvasAnchorAtPoint(overview, [screen], { x: 20, y: 30 }, "ignored-layer"), {
    frameId: overviewCanvasFrameId,
    sourceNodeId: null,
    x: 20,
    y: 30,
  });
});

test("rejects points outside the viewport and empty space outside a screen view", () => {
  assert.equal(canvasAnchorAtPoint(overview, [screen], { x: -1, y: 20 }, null), null);
  assert.equal(canvasAnchorAtPoint(screen, [screen], { x: 400, y: 20 }, null), null);
});

test("maps saved canvas and screen anchors into a panned overview viewport", () => {
  const viewport = { ...overview, sourceX: 120, sourceY: 220, sourceWidth: 500, sourceHeight: 400 };

  assert.deepEqual(canvasAnchorToViewportPoint({
    frameId: overviewCanvasFrameId,
    sourceNodeId: null,
    x: 40,
    y: 50,
  }, viewport, [screen], { sourceX: 100, sourceY: 200 }), { x: 20, y: 30 });

  assert.deepEqual(canvasAnchorToViewportPoint({
    frameId: screen.id,
    sourceNodeId: "button-1",
    x: 12,
    y: 30,
  }, viewport, [screen], { sourceX: 100, sourceY: 200 }), { x: 92, y: 110 });
});

test("hides pins whose source anchors are outside the current viewport", () => {
  const viewport = { ...overview, sourceX: 700, sourceY: 600, sourceWidth: 200, sourceHeight: 150 };
  assert.equal(canvasAnchorToViewportPoint({
    frameId: screen.id,
    sourceNodeId: null,
    x: 12,
    y: 30,
  }, viewport, [screen], { sourceX: 100, sourceY: 200 }), null);
});
