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

test("checks captured spacing, measured margins, and explicit token bindings independently", () => {
  const sourceMeasurement = (value, sourceProperty) => ({
    value,
    unit: "px",
    provenance: "source",
    sourceProperty,
  });
  const measuredMargin = { value: 10, unit: "px", provenance: "measured" };
  const currentFrame = {
    ...frame({ width: 390, height: 844 }),
    nodes: [{
      sourceNodeId: "button-primary",
      name: "Primary button",
      padding: { left: sourceMeasurement(8, "paddingLeft") },
      spacing: { rowGap: sourceMeasurement(6, "itemSpacing") },
      margins: { right: measuredMargin },
      fills: [{ color: "#ffffff" }],
      strokes: [],
      typography: null,
      tokens: [],
    }],
  };

  const result = evaluateLayoutRules(snapshot(currentFrame), {
    allowedSpacing: [4, 8],
    requireTokenCategories: ["color", "spacing"],
    frameBounds: null,
  });

  assert.deepEqual(result.findings.map(({ path, category, actual }) => ({ path, category, actual })), [
    { path: "spacing.rowGap", category: "layout", actual: { value: 6, unit: "px", provenance: "source" } },
    { path: "margins.right", category: "layout", actual: { value: 10, unit: "px", provenance: "measured" } },
    { path: "tokens.color", category: "token", actual: null },
    { path: "tokens.spacing", category: "token", actual: null },
  ]);
});

test("evaluates 31,500 captured elements with stable, unique findings", () => {
  const nodeCountPerFrame = 150;
  const frames = Array.from({ length: 210 }, (_, frameIndex) => ({
    ...frame({ width: 390, height: 844 }),
    sourceFrameId: `frame-${frameIndex}`,
    name: `Screen ${frameIndex}`,
    nodes: Array.from({ length: nodeCountPerFrame }, (_, nodeIndex) => ({
      sourceNodeId: `${frameIndex}:${nodeIndex}`,
      name: `Element ${nodeIndex}`,
      padding: { left: { value: 6, unit: "px", provenance: "source", sourceProperty: "paddingLeft" } },
      spacing: {},
      margins: {},
      fills: [{ color: "#ffffff" }],
      strokes: [],
      typography: null,
      tokens: [],
    })),
  }));

  const result = evaluateLayoutRules({ frames }, {
    allowedSpacing: [8],
    requireTokenCategories: ["color"],
    frameBounds: null,
  });

  assert.equal(frames.reduce((count, currentFrame) => count + currentFrame.nodes.length, 0), 31_500);
  assert.equal(result.findings.length, 63_000);
  assert.equal(result.findings.filter((finding) => finding.category === "layout").length, 31_500);
  assert.equal(result.findings.filter((finding) => finding.category === "token").length, 31_500);
  assert.equal(new Set(result.findings.map((finding) => finding.findingKey)).size, 63_000);
});
