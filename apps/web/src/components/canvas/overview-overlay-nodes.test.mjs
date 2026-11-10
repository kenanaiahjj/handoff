import assert from "node:assert/strict";
import test from "node:test";
import { buildOverviewOverlayNodes } from "./overview-overlay-nodes.ts";

function measurement(value, sourceProperty) {
  return { value, unit: "px", provenance: "source", sourceProperty };
}

function bounds(x, y, width, height) {
  return {
    x: measurement(x, "absoluteBoundingBox.x"),
    y: measurement(y, "absoluteBoundingBox.y"),
    width: measurement(width, "absoluteBoundingBox.width"),
    height: measurement(height, "absoluteBoundingBox.height"),
  };
}

test("builds compact overview hit targets with absolute canvas coordinates", () => {
  const frame = {
    sourceFrameId: "frame-1",
    bounds: bounds(100, 200, 300, 500),
    nodes: [{
      sourceNodeId: "node-1",
      parentSourceNodeId: null,
      sourceFrameId: "frame-1",
      name: "Primary button",
      type: "RECTANGLE",
      visible: true,
      bounds: bounds(112, 245, 80, 36),
      layout: { mode: null, direction: null, primaryAxisAlign: null, counterAxisAlign: null, wrap: null, constraints: {} },
      padding: {},
      margins: {},
      spacing: {},
      fills: [],
      strokes: [],
      styleReferences: [],
      typography: null,
      tokens: [],
      sourcePayload: { largeCapturedDetail: "x".repeat(20_000) },
    }],
  };

  assert.deepEqual(buildOverviewOverlayNodes([frame]), [{
    sourceNodeId: "node-1",
    sourceFrameId: "frame-1",
    name: "Primary button",
    type: "RECTANGLE",
    visible: true,
    bounds: {
      ...bounds(112, 245, 80, 36),
      x: measurement(212, "absoluteBoundingBox.x"),
      y: measurement(445, "absoluteBoundingBox.y"),
    },
  }]);
});

test("preserves unknown coordinates as unknown", () => {
  const frame = {
    bounds: bounds(null, null, 300, 500),
    nodes: [{
      sourceNodeId: "node-2",
      name: "Unknown position",
      type: "FRAME",
      visible: true,
      bounds: bounds(10, 20, 30, 40),
    }],
  };

  const [node] = buildOverviewOverlayNodes([frame]);
  assert.equal(node.bounds.x.value, null);
  assert.equal(node.bounds.y.value, null);
});

test("places overview layers using their source page layout offset", () => {
  const frame = {
    sourcePageId: "page-2",
    bounds: bounds(100, 200, 300, 500),
    nodes: [{
      sourceNodeId: "node-page-2",
      name: "Page two layer",
      type: "RECTANGLE",
      visible: true,
      bounds: bounds(10, 20, 30, 40),
    }],
  };

  const [node] = buildOverviewOverlayNodes([frame], new Map([
    ["page-2", { offsetX: 900, offsetY: 1200 }],
  ]));

  assert.equal(node.bounds.x.value, 1010);
  assert.equal(node.bounds.y.value, 1420);
});
