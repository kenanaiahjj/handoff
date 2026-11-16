import assert from "node:assert/strict";
import test from "node:test";
import { buildOverviewOverlayFromScreens, summarizeCanvasNode } from "./canvas-node-summary.ts";
import { buildOverviewOverlayNodes } from "./overview-overlay-nodes.ts";

const measure = (value, sourceProperty = "x") => ({ value, unit: "px", provenance: "source", sourceProperty });
const bounds = (x, y, width, height) => ({ x: measure(x), y: measure(y), width: measure(width), height: measure(height) });
const node = (id, frameId, extra = {}) => ({
  sourceNodeId: id,
  parentSourceNodeId: id === frameId ? null : frameId,
  sourceFrameId: frameId,
  name: id,
  type: "FRAME",
  visible: true,
  bounds: bounds(12, 30, 100, 40),
  layout: { mode: "NONE", constraints: {} },
  padding: {},
  margins: {},
  spacing: {},
  fills: [{ color: "#FF0000", opacity: measure(1), sourceStyleId: null }, { color: null, opacity: measure(1), sourceStyleId: null }],
  strokes: [],
  styleReferences: [],
  typography: { content: "Book a trip", fontFamily: "Inter" },
  tokens: [{ sourceId: "t1", name: "brand/red", value: "#FF0000", collectionId: null, collectionName: null, mode: null }],
  sourcePayload: { textSegments: [{ characters: "Book a trip" }], ...extra },
});

test("summaries keep what the canvas draws and searches, and drop the heavy fields", () => {
  const summary = summarizeCanvasNode(node("n1", "frame-1"), "frame-1");
  assert.deepEqual(summary.bounds, { x: { value: 12 }, y: { value: 30 }, width: { value: 100 }, height: { value: 40 } });
  assert.deepEqual(summary.typography, { content: "Book a trip" });
  assert.deepEqual(summary.fills, [{ color: "#FF0000" }]);
  assert.deepEqual(summary.tokens, [{ name: "brand/red", value: "#FF0000" }]);
  for (const heavy of ["sourcePayload", "layout", "padding", "margins", "spacing", "styleReferences"]) {
    assert.equal(heavy in summary, false, `${heavy} should load with full details instead`);
  }
});

test("only a screen's root node carries its layout grids", () => {
  const grids = [{ pattern: "COLUMNS", visible: true }];
  assert.deepEqual(summarizeCanvasNode(node("frame-1", "frame-1", { layoutGrids: grids }), "frame-1").layoutGrids, grids);
  assert.equal("layoutGrids" in summarizeCanvasNode(node("child", "frame-1", { layoutGrids: grids }), "frame-1"), false);
});

test("browser-built overview hit areas match the positions the server used to send", () => {
  const pageOffsets = new Map([["page-2", { offsetX: 5000, offsetY: -200 }]]);
  const frames = [
    { sourceFrameId: "frame-1", sourcePageId: "page-1", bounds: bounds(100, 50, 393, 852), nodes: [node("a", "frame-1")] },
    { sourceFrameId: "frame-2", sourcePageId: "page-2", bounds: bounds(-40, 900, 393, 852), nodes: [node("b", "frame-2")] },
  ];
  const expected = buildOverviewOverlayNodes(frames, pageOffsets);
  const screens = frames.map((frame) => {
    const offset = pageOffsets.get(frame.sourcePageId) ?? { offsetX: 0, offsetY: 0 };
    return {
      id: frame.sourceFrameId,
      sourceX: frame.bounds.x.value + offset.offsetX,
      sourceY: frame.bounds.y.value + offset.offsetY,
      nodes: frame.nodes.map((entry) => summarizeCanvasNode(entry, frame.sourceFrameId)),
    };
  });
  const actual = buildOverviewOverlayFromScreens(screens);
  assert.deepEqual(
    actual.map((entry) => [entry.sourceNodeId, entry.sourceFrameId, entry.bounds.x.value, entry.bounds.y.value, entry.bounds.width.value, entry.bounds.height.value]),
    expected.map((entry) => [entry.sourceNodeId, entry.sourceFrameId, entry.bounds.x.value, entry.bounds.y.value, entry.bounds.width.value, entry.bounds.height.value]),
  );
});
