import assert from "node:assert/strict";
import test from "node:test";
import { compareResultForPair, defaultCompareViewMode, preferredCompareFrameId } from "./compare-state.ts";

const visualResult = {
  diff: { fromVersionId: "v1", toVersionId: "v2", changes: [{ category: "visual" }] },
  frames: [{ frameId: "frame-1", status: "changed" }],
};

test("uses a comparison result only for its before and after version pair", () => {
  assert.deepEqual(
    compareResultForPair(null, { fromVersionId: "v1", toVersionId: "v2", result: visualResult, error: null }, "v1", "v2"),
    { result: visualResult, error: null },
  );
  assert.deepEqual(
    compareResultForPair(null, { fromVersionId: "v1", toVersionId: "v2", result: visualResult, error: null }, "v2", "v3"),
    { result: null, error: null },
  );
});

test("prefers a matching initial result and visualizes visual-only changes as a pixel diff", () => {
  assert.deepEqual(
    compareResultForPair(visualResult, { fromVersionId: "v1", toVersionId: "v2", result: null, error: "stale" }, "v1", "v2"),
    { result: visualResult, error: null },
  );
  assert.equal(defaultCompareViewMode(visualResult), "pixel-diff");
  assert.equal(defaultCompareViewMode({ diff: { changes: [{ category: "visual" }, { category: "layout" }] } }), "side-by-side");
  assert.equal(defaultCompareViewMode(null), "side-by-side");
});

test("selects the first changed screen as the comparison focus", () => {
  assert.equal(preferredCompareFrameId({ frames: [
    { frameId: "unchanged", status: "unchanged" },
    { frameId: "changed", status: "changed" },
  ] }), "changed");
  assert.equal(preferredCompareFrameId({ frames: [{ frameId: "only", status: "unchanged" }] }), "only");
  assert.equal(preferredCompareFrameId(null), "");
});
