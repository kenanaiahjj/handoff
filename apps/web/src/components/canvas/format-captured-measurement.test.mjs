import assert from "node:assert/strict";
import test from "node:test";
import { formatComparisonValue, formatFrameSize, formatPixelValue, formatPrecisePixelValue, inspectionMeasurementEntries } from "./format-captured-measurement.ts";
const { inspectionBounds, inspectionGeometryNotice } = await import("./format-captured-measurement.ts");

test("preserves exact Figma pixel values without display rounding", () => {
  assert.equal(formatPixelValue(106.99979400634766), "106.99979400634766");
  assert.equal(formatPixelValue(0.25695228576660156), "0.25695228576660156");
  assert.equal(formatPixelValue(40.975345611572266), "40.975345611572266");
  assert.equal(formatPixelValue(18.9802188873291), "18.9802188873291");
  assert.equal(formatPixelValue(35.9844970703125), "35.9844970703125");
  assert.equal(formatPixelValue(321.15625), "321.15625");
  assert.equal(formatPixelValue(321.25), "321.25");
  assert.equal(formatPixelValue(321.5), "321.5");
  assert.equal(formatPixelValue(321.75), "321.75");
  assert.equal(formatPixelValue(-0.1), "-0.1");
  assert.equal(formatPixelValue(-0.004), "-0.004");
  assert.equal(formatPixelValue(-321.5), "-321.5");
  assert.equal(formatFrameSize(393.25, 852.49), "393.25 × 852.49 px");
  assert.equal(formatPrecisePixelValue(35.9844970703125), "35.9844970703125");
});

test("preserves nested pixel measurements without changing ratios", () => {
  const value = {
    bounds: { width: { value: 35.9844970703125, unit: "px" } },
    aspectRatio: { value: 0.3333, unit: "ratio" },
  };

  assert.equal(
    formatComparisonValue(value, "layout"),
    '{"bounds":{"width":{"value":35.9844970703125,"unit":"px"}},"aspectRatio":{"value":0.3333,"unit":"ratio"}}',
  );
  assert.equal(formatComparisonValue({ value: 35.9844970703125, unit: "px" }, "geometry"), "35.9844970703125 px");
});

test("keeps unavailable measurements in inspector groups", () => {
  const rows = inspectionMeasurementEntries({
    top: { value: null, unit: "px", provenance: "unavailable", sourceProperty: null },
    right: { value: 8, unit: "px", provenance: "source", sourceProperty: "paddingRight" },
  });

  assert.deepEqual(rows.map(([label, measurement]) => [label, measurement.value, measurement.provenance]), [
    ["top", null, "unavailable"],
    ["right", 8, "source"],
  ]);
});

test("prefers Figma-native geometry for Inspect and falls back for older snapshots", () => {
  assert.equal(typeof inspectionBounds, "function", "the inspector geometry selector must be available");

  const screenBounds = {
    x: { value: 35.9844970703125, unit: "px", provenance: "measured", sourceProperty: "absoluteBoundingBox.x - frame.x" },
    y: { value: 322.95703125, unit: "px", provenance: "measured", sourceProperty: "absoluteBoundingBox.y - frame.y" },
    width: { value: 321.15625, unit: "px", provenance: "source", sourceProperty: "absoluteBoundingBox.width" },
    height: { value: 68.98123931884766, unit: "px", provenance: "source", sourceProperty: "absoluteBoundingBox.height" },
  };
  const figmaBounds = {
    x: { value: 36, unit: "px", provenance: "source", sourceProperty: "x" },
    y: { value: 323, unit: "px", provenance: "source", sourceProperty: "y" },
    width: { value: 321, unit: "px", provenance: "source", sourceProperty: "width" },
    height: { value: 69, unit: "px", provenance: "source", sourceProperty: "height" },
  };

  assert.equal(inspectionBounds({ bounds: screenBounds, layoutBounds: figmaBounds }), figmaBounds);
  assert.equal(inspectionBounds({ bounds: screenBounds }), screenBounds);
});

test("identifies snapshots that lack Figma-native layer geometry", () => {
  assert.equal(typeof inspectionGeometryNotice, "function", "the inspector should explain legacy geometry");
  assert.equal(
    inspectionGeometryNotice({ layoutBounds: undefined }),
    "Figma-native layer geometry is unavailable in this snapshot. Position and size use screen bounds; recapture from Figma for layer-relative values.",
  );
  assert.equal(inspectionGeometryNotice({ layoutBounds: { x: {}, y: {}, width: {}, height: {} } }), null);
});
