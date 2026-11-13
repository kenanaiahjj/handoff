import assert from "node:assert/strict";
import test from "node:test";

const capture = await import("../src/capture.ts");

const sourceBounds = (x, y, width, height) => ({
  x: { value: x, unit: "px", provenance: "source", sourceProperty: "x" },
  y: { value: y, unit: "px", provenance: "source", sourceProperty: "y" },
  width: { value: width, unit: "px", provenance: "source", sourceProperty: "width" },
  height: { value: height, unit: "px", provenance: "source", sourceProperty: "height" },
});

test("captures Figma node geometry instead of deriving it from absolute screen bounds", () => {
  assert.equal(typeof capture.figmaLayoutBounds, "function", "Figma layout bounds capture must be available");

  const actual = capture.figmaLayoutBounds({
    x: 36,
    y: 323,
    width: 321,
    height: 69,
    absoluteBoundingBox: { x: 35.9844970703125, y: 322.95703125, width: 321.15625, height: 68.98123931884766 },
  });

  assert.deepEqual(actual, sourceBounds(36, 323, 321, 69));
});

test("preserves fractional Figma source geometry and marks unavailable values", () => {
  assert.equal(typeof capture.figmaLayoutBounds, "function", "Figma layout bounds capture must be available");

  const actual = capture.figmaLayoutBounds({ x: 12.5, y: 24.25, width: 88.5, height: Number.NaN });

  assert.deepEqual(actual, {
    ...sourceBounds(12.5, 24.25, 88.5, null),
    height: { value: null, unit: "px", provenance: "unavailable", sourceProperty: null },
  });
});
