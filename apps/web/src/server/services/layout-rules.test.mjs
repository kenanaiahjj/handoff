import assert from "node:assert/strict";
import test from "node:test";
import { evaluateLayoutRules } from "./layout-rules.ts";

function frame({ width, height }) {
  const measurement = (value) => ({ value, unit: "px" });
  return {
    sourceFrameId: "frame-a",
    name: "Checkout",
    bounds: {
      width: measurement(width),
      height: measurement(height),
    },
    nodes: [],
  };
}

function snapshot(currentFrame) {
  return { frames: [currentFrame] };
}

const noSpacingRules = {
  allowedSpacing: [],
  requireTokenCategories: [],
};

test("checks known frame width even when height is unavailable", () => {
  const result = evaluateLayoutRules(snapshot(frame({ width: 320, height: null })), {
    ...noSpacingRules,
    frameBounds: { minWidth: 360, maxWidth: null, minHeight: null, maxHeight: null },
  });

  assert.deepEqual(result.findings.map(({ ruleId, path, actual }) => ({ ruleId, path, actual })), [
    { ruleId: "frame.minimum-width", path: "bounds.width", actual: { value: 320, unit: "px" } },
  ]);
});

test("checks known frame height even when width is unavailable", () => {
  const result = evaluateLayoutRules(snapshot(frame({ width: null, height: 700 })), {
    ...noSpacingRules,
    frameBounds: { minWidth: null, maxWidth: null, minHeight: 800, maxHeight: null },
  });

  assert.deepEqual(result.findings.map(({ ruleId, path, actual }) => ({ ruleId, path, actual })), [
    { ruleId: "frame.minimum-height", path: "bounds.height", actual: { value: 700, unit: "px" } },
  ]);
});
