import assert from "node:assert/strict";
import test from "node:test";
import { formatComparisonValue, formatFrameSize, formatPixelValue, formatPrecisePixelValue, inspectionMeasurementEntries } from "./format-captured-measurement.ts";

test("matches Figma's whole-pixel measurement display", () => {
  assert.equal(formatPixelValue(106.99979400634766), "107");
  assert.equal(formatPixelValue(0.25695228576660156), "0");
  assert.equal(formatPixelValue(40.975345611572266), "41");
  assert.equal(formatPixelValue(18.9802188873291), "19");
  assert.equal(formatPixelValue(35.9844970703125), "36");
  assert.equal(formatPixelValue(321.15625), "321");
  assert.equal(formatPixelValue(321.25), "321");
  assert.equal(formatPixelValue(321.5), "322");
  assert.equal(formatPixelValue(321.75), "322");
  assert.equal(formatPixelValue(-0.1), "0");
  assert.equal(formatPixelValue(-0.004), "0");
  assert.equal(formatPixelValue(-321.5), "-322");
  assert.equal(formatFrameSize(393.25, 852.49), "393 × 852 px");
  assert.equal(formatPrecisePixelValue(35.9844970703125), "35.98");
});

test("rounds nested pixel measurements without changing ratios", () => {
  const value = {
    bounds: { width: { value: 35.9844970703125, unit: "px" } },
    aspectRatio: { value: 0.3333, unit: "ratio" },
  };

  assert.equal(
    formatComparisonValue(value, "layout"),
    '{"bounds":{"width":{"value":35.98,"unit":"px"}},"aspectRatio":{"value":0.3333,"unit":"ratio"}}',
  );
  assert.equal(formatComparisonValue({ value: 35.9844970703125, unit: "px" }, "geometry"), "35.98 px");
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
