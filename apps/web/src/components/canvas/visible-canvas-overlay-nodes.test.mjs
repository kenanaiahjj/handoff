import assert from "node:assert/strict";
import test from "node:test";
import { getVisibleCanvasOverlayNodes } from "./visible-canvas-overlay-nodes.ts";

function measurement(value, sourceProperty) {
  return { value, unit: "px", provenance: "source", sourceProperty };
}

function node(id, x, y, width, height, visible = true) {
  return {
    sourceNodeId: id,
    sourceFrameId: "frame-1",
    name: id,
    type: "RECTANGLE",
    visible,
    bounds: {
      x: measurement(x, "absoluteBoundingBox.x"),
      y: measurement(y, "absoluteBoundingBox.y"),
      width: measurement(width, "absoluteBoundingBox.width"),
      height: measurement(height, "absoluteBoundingBox.height"),
    },
  };
}

test("renders only visible, in-viewport targets large enough to select", () => {
  const nodes = [
    node("inside", 60, 70, 24, 18),
    node("selected-small", 140, 140, 4, 4),
    node("too-small", 80, 80, 4, 4),
    node("outside", 151, 80, 20, 20),
    node("hidden", 90, 90, 20, 20, false),
    node("unknown", null, 80, 20, 20),
  ];

  const visible = getVisibleCanvasOverlayNodes({
    nodes,
    frameWidth: 200,
    frameHeight: 200,
    viewportWidth: 100,
    viewportHeight: 100,
    offsetX: 0,
    offsetY: 0,
    scale: 1,
    selectedNodeId: "selected-small",
  });

  assert.deepEqual(visible.map((entry) => entry.sourceNodeId), ["inside", "selected-small"]);
});

test("maps absolute overview coordinates back to the viewport origin", () => {
  const visible = getVisibleCanvasOverlayNodes({
    nodes: [node("overview-item", 160, 270, 24, 18)],
    frameWidth: 200,
    frameHeight: 200,
    frameOriginX: 100,
    frameOriginY: 200,
    viewportWidth: 100,
    viewportHeight: 100,
    offsetX: 0,
    offsetY: 0,
    scale: 1,
  });

  assert.equal(visible.length, 1);
  assert.equal(visible[0].sourceNodeId, "overview-item");
});

test("limits a 31,500-node overview to the 150 targets in the visible screen", () => {
  const nodes = Array.from({ length: 210 }, (_, frameIndex) =>
    Array.from({ length: 150 }, (_, nodeIndex) => node(
      `screen-${frameIndex}-node-${nodeIndex}`,
      frameIndex * 1200 + 10,
      10 + nodeIndex * 5,
      20,
      20,
    )),
  ).flat();

  const visible = getVisibleCanvasOverlayNodes({
    nodes,
    frameWidth: 252_000,
    frameHeight: 900,
    viewportWidth: 800,
    viewportHeight: 800,
    offsetX: 125_600,
    offsetY: 50,
    scale: 1,
  });

  assert.equal(nodes.length, 31_500);
  assert.equal(visible.length, 150);
  assert.ok(visible.every((entry) => entry.sourceNodeId.startsWith("screen-0-")));
});

test("a margin keeps targets just past the viewport edge, so panning a little needs no new list", async () => {
  const { visibleCanvasRegion, regionContains } = await import("./visible-canvas-overlay-nodes.ts");
  const base = { frameWidth: 300, frameHeight: 300, viewportWidth: 100, viewportHeight: 100, offsetX: 0, offsetY: 0, scale: 1 };
  const nodes = [node("in-margin", 210, 140, 20, 20)];
  assert.deepEqual(getVisibleCanvasOverlayNodes({ nodes, ...base }).map((entry) => entry.sourceNodeId), []);
  assert.deepEqual(getVisibleCanvasOverlayNodes({ nodes, ...base, margin: 0.25 }).map((entry) => entry.sourceNodeId), ["in-margin"]);
  const padded = visibleCanvasRegion({ ...base, margin: 0.25 });
  assert.deepEqual(padded, { left: 75, right: 225, top: 75, bottom: 225 });
  assert.equal(regionContains(padded, visibleCanvasRegion({ ...base, offsetX: -20 })), true);
  assert.equal(regionContains(padded, visibleCanvasRegion({ ...base, offsetX: -30 })), false);
});
