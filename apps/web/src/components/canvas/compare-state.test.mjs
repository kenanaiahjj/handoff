import assert from "node:assert/strict";
import test from "node:test";
import * as compareState from "./compare-state.ts";
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

test("uses a refreshed result for the same version pair over the server-rendered result", () => {
  const refreshedResult = {
    diff: { fromVersionId: "v1", toVersionId: "v2", changes: [] },
    frames: [{ frameId: "frame-1", status: "matched" }],
  };

  assert.deepEqual(
    compareResultForPair(visualResult, {
      fromVersionId: "v1",
      toVersionId: "v2",
      result: refreshedResult,
      error: null,
    }, "v1", "v2"),
    { result: refreshedResult, error: null },
  );
});

test("selects the first changed screen as the comparison focus", () => {
  assert.equal(preferredCompareFrameId({ frames: [
    { frameId: "unchanged", status: "unchanged" },
    { frameId: "changed", status: "changed" },
  ] }), "changed");
  assert.equal(preferredCompareFrameId({ frames: [{ frameId: "only", status: "unchanged" }] }), "only");
  assert.equal(preferredCompareFrameId(null), "");
});

test("parses a direct comparison link with its selected screen and view", () => {
  assert.equal(typeof compareState.parseCompareRouteState, "function");
  assert.deepEqual(
    compareState.parseCompareRouteState(new URLSearchParams("compare=1&compareFrom=v3&compareTo=v4&compareFrame=frame%3A7&compareMode=overlay")),
    { fromVersionId: "v3", toVersionId: "v4", frameId: "frame:7", mode: "overlay" },
  );
  assert.equal(compareState.parseCompareRouteState(new URLSearchParams("compare=1&compareFrom=v3&compareTo=v3")), null);
  assert.equal(compareState.parseCompareRouteState(new URLSearchParams("compareFrom=v3&compareTo=v4")), null);
});

test("writes and clears comparison link state without changing other URL state", () => {
  assert.equal(typeof compareState.updateCompareRouteUrl, "function");
  const originalUrl = "http://localhost:3000/handoff?versionId=v1&keep=1#screen=frame-7";
  const compareUrl = compareState.updateCompareRouteUrl(originalUrl, {
    fromVersionId: "v3",
    toVersionId: "v4",
    frameId: "frame:7",
    mode: "pixel-diff",
  });
  const opened = new URL(compareUrl);
  assert.equal(opened.searchParams.get("versionId"), "v4");
  assert.equal(opened.searchParams.get("keep"), "1");
  assert.deepEqual(compareState.parseCompareRouteState(opened.searchParams), {
    fromVersionId: "v3",
    toVersionId: "v4",
    frameId: "frame:7",
    mode: "pixel-diff",
  });
  assert.equal(opened.hash, "#screen=frame-7");

  const closed = new URL(compareState.updateCompareRouteUrl(compareUrl, null));
  assert.equal(closed.searchParams.has("compare"), false);
  assert.equal(closed.searchParams.has("compareFrom"), false);
  assert.equal(closed.searchParams.has("compareTo"), false);
  assert.equal(closed.searchParams.has("compareFrame"), false);
  assert.equal(closed.searchParams.has("compareMode"), false);
  assert.equal(closed.searchParams.get("versionId"), "v4");
  assert.equal(closed.searchParams.get("keep"), "1");
  assert.equal(closed.hash, "#screen=frame-7");
});
