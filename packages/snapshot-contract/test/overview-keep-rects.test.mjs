import assert from "node:assert/strict";
import test from "node:test";
import { getFigmaCaptureOverviewKeepRects } from "../src/capture-merge.ts";

const px = (value) => ({ value, unit: "px", provenance: "source" });
const frame = (id, x, renderBounds) => ({
  sourceFrameId: id,
  sourcePageId: "page",
  bounds: { x: px(x), y: px(0), width: px(10), height: px(20) },
  ...(renderBounds ? { renderBounds } : {}),
});

test("a merge keeps only the previous picture's surviving screens, so removed screens cannot reappear", () => {
  const shadowed = { x: px(98), y: px(-2), width: px(14), height: px(24) };
  const rects = getFigmaCaptureOverviewKeepRects(
    [frame("kept", 0), frame("replaced", 50), frame("shadowed", 100, shadowed)],
    ["replaced"],
    new Map([["page", { offsetX: 5, offsetY: 7 }]]),
  );
  assert.deepEqual(rects, [
    { x: 5, y: 7, width: 10, height: 20 },
    { x: 103, y: 5, width: 14, height: 24 },
  ]);
});
