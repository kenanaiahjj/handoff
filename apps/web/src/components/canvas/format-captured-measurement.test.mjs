import assert from "node:assert/strict";
import test from "node:test";
import { formatComparisonValue, formatFrameSize, formatPixelValue, inspectionMeasurementEntries } from "./format-captured-measurement.ts";

test("rounds pixel values to whole or half pixels", () => {
  assert.equal(formatPixelValue(35.9844970703125), "36");
  assert.equal(formatPixelValue(321.15625), "321");
  assert.equal(formatPixelValue(321.25), "321.5");
  assert.equal(formatPixelValue(321.75), "322");
  assert.equal(formatPixelValue(-0.1), "0");
  assert.equal(formatFrameSize(393.25, 852.49), "393.5 × 852.5 px");
});

test("rounds nested pixel measurements without changing ratios", () => {
  const value = {
    bounds: { width: { value: 35.9844970703125, unit: "px" } },
    aspectRatio: { value: 0.3333, unit: "ratio" },
  };

  assert.equal(
    formatComparisonValue(value, "layout"),
    '{"bounds":{"width":{"value":36,"unit":"px"}},"aspectRatio":{"value":0.3333,"unit":"ratio"}}',
  );
  assert.equal(formatComparisonValue({ value: 35.9844970703125, unit: "px" }, "geometry"), "36 px");
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
