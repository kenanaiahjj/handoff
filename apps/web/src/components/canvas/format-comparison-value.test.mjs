import assert from "node:assert/strict";
import test from "node:test";

const comparisonFormatting = await import("./format-captured-measurement.ts").catch(() => null);
const formatComparisonValue = comparisonFormatting?.formatComparisonValue;
const inspectionMargins = comparisonFormatting?.inspectionMargins;

function format(value, category) {
  assert.equal(typeof formatComparisonValue, "function", "comparison value formatter must be available");
  return formatComparisonValue(value, category);
}

test("preserves fractional Figma pixels in comparison summaries", () => {
  assert.equal(format(15.9845, "layout"), "15.9845");
  assert.equal(format(15.25, "geometry"), "15.25");
  assert.equal(format(-0.068777, "layout"), "-0.068777");
});

test("formats captured pixel measurements without changing ratios", () => {
  const value = {
    bounds: { x: { value: 35.9845, unit: "px" }, width: { value: 15.25, unit: "px" } },
    aspectRatio: { value: 0.3333, unit: "ratio" },
  };
  assert.equal(
    format(value, "layout"),
    '{"bounds":{"x":{"value":35.9845,"unit":"px"},"width":{"value":15.25,"unit":"px"}},"aspectRatio":{"value":0.3333,"unit":"ratio"}}',
  );
  assert.equal(value.bounds.x.value, 35.9845, "formatting must not change the captured source value");
  assert.equal(format("1 of 5", "structure"), "1 of 5");
  assert.equal(format(0.125, "style"), "0.125");
});

test("formats pixel values inside structured diffs while preserving non-pixel values", () => {
  const value = {
    bounds: { x: { value: 35.9845, unit: "px" } },
    fills: [{ opacity: { value: 0.125, unit: "ratio" } }],
  };
  const expected = {
    bounds: { x: { value: 35.9845, unit: "px" } },
    fills: [{ opacity: { value: 0.125, unit: "ratio" } }],
  };
  assert.equal(format(value, "structure"), JSON.stringify(expected));
});

test("preserves fractional Figma pixels in direct measurements", () => {
  assert.equal(format({ value: 35.9845, unit: "px", provenance: "source" }, "geometry"), "35.9845 px");
  assert.equal(format({ value: 0.125, unit: "ratio" }, "style"), "0.125 ratio");
});

test("summarizes captured paint objects as a color and opacity", () => {
  assert.equal(
    format({ color: "#FFF8F0", opacity: { value: 1, unit: "ratio", provenance: "source" } }, "style"),
    "#FFF8F0 · 100% opacity",
  );
});

test("preserves fractional frame dimensions and labels them in pixels", () => {
  assert.equal(typeof comparisonFormatting?.formatFrameSize, "function", "frame size formatter must be available");
  assert.equal(comparisonFormatting.formatFrameSize(349.1485290527344, 253), "349.1485290527344 × 253 px");
  assert.equal(comparisonFormatting.formatFrameSize(100.25, 99.74), "100.25 × 99.74 px");
});

test("preserves missing and unavailable values", () => {
  assert.equal(format(undefined, "layout"), "Not present");
  assert.equal(format(null, "layout"), "Unavailable");
});

test("hides legacy frame margins while preserving measured child margins", () => {
  assert.equal(typeof inspectionMargins, "function", "frame margin handling must be available");
  const margins = {
    top: { value: 20, unit: "px", provenance: "measured", sourceProperty: "parent bounds" },
    right: { value: 3511, unit: "px", provenance: "measured", sourceProperty: "parent bounds" },
    bottom: { value: 20, unit: "px", provenance: "measured", sourceProperty: "parent bounds" },
    left: { value: 20, unit: "px", provenance: "measured", sourceProperty: "parent bounds" },
  };

  const rootMargins = inspectionMargins({ sourceNodeId: "frame-1", sourceFrameId: "frame-1", margins });
  const childMargins = inspectionMargins({ sourceNodeId: "node-1", sourceFrameId: "frame-1", margins });

  assert.deepEqual(
    [rootMargins.top, rootMargins.right, rootMargins.bottom, rootMargins.left].map(({ value, provenance }) => ({ value, provenance })),
    ["top", "right", "bottom", "left"].map(() => ({ value: null, provenance: "unavailable" })),
  );
  assert.equal(childMargins.right.value, 3511);
  assert.equal(childMargins.right.provenance, "measured");
});
