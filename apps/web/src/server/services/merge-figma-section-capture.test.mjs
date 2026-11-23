import assert from "node:assert/strict";
import test from "node:test";
import { diffSnapshots } from "./diff.ts";
import {
  createFigmaCaptureMergePlan,
  getFigmaCaptureOverviewKeepRects,
  mergeFigmaCaptureSnapshots,
  normalizeFigmaCaptureScope,
  removeFramesFromSnapshot,
} from "../../../../../packages/snapshot-contract/src/capture-merge.ts";
import { captureSectionRecords } from "../../../../../packages/snapshot-contract/src/capture-sections.ts";
import { formatFigmaCaptureScope } from "../../../../../packages/snapshot-contract/src/figma-capture-scope.ts";

function measurement(value) {
  return { value, unit: "px", provenance: "source", sourceProperty: "absoluteBoundingBox" };
}

function frame(sourceFrameId, renderAssetKey = `${sourceFrameId}-render`, x = 0, sourcePageId = "page-1") {
  return {
    sourceFrameId,
    sourcePageId,
    name: sourceFrameId,
    bounds: { x: measurement(x), y: measurement(0), width: measurement(100), height: measurement(200) },
    renderAssetKey,
    nodes: [],
  };
}

function asset(key) {
  return { key, fileName: `${key}.png`, contentType: "image/png", sizeBytes: 10, sha256: "a".repeat(64), width: 100, height: 200 };
}

function section(sourceSectionId, frameIds, extra = {}) {
  return { sourceSectionId, sourcePageId: "page-1", name: sourceSectionId, x: -20, y: -60, width: 600, height: 300, fill: "#FFFFFF", frameIds, ...extra };
}

function snapshot(frames, captureScope, sections) {
  return {
    schemaVersion: 1,
    source: "figma",
    sourceFileId: "file-1",
    sourceRevisionId: null,
    sourceFileName: "Tripket",
    capturedAt: "2026-11-23T02:00:00.000Z",
    contentHash: "b".repeat(64),
    overviewAssetKey: "overview",
    canvasBounds: { x: measurement(0), y: measurement(0), width: measurement(1000), height: measurement(200) },
    frames,
    assets: [asset("overview"), ...frames.map((item) => asset(item.renderAssetKey))],
    sourceMetadata: {
      sourceTool: "figma",
      captureScope,
      pageLayout: [{ sourcePageId: "page-1", sourcePageName: "Flows", offsetX: 0, offsetY: 0, frameCount: frames.length }],
      ...(sections ? { sections } : {}),
    },
  };
}

function merge(baseline, incoming) {
  return mergeFigmaCaptureSnapshots({ baseline, incoming, baselineVersionId: "version-1", assetPrefix: "section", frameMatches: [] });
}

// Onboarding flow lives in a section; "loose" and the checkout section were captured separately.
function flowBaseline() {
  return snapshot([
    frame("welcome", "welcome-render", 0),
    frame("permissions", "permissions-render", 120),
    frame("done", "done-render", 240),
    frame("loose", "loose-render", 700),
    frame("cart", "cart-render", 900),
  ], "selected sections", [
    section("onboarding", ["welcome", "permissions", "done"]),
    section("checkout", ["cart"], { x: 880 }),
  ]);
}

test("section capture scopes are partial selected captures with their own label", () => {
  assert.equal(normalizeFigmaCaptureScope("selected sections"), "selected");
  assert.equal(normalizeFigmaCaptureScope("selected sections and frames"), "selected");
  assert.equal(formatFigmaCaptureScope("selected sections"), "Selected sections");
  assert.equal(formatFigmaCaptureScope("selected sections and frames"), "Selected sections and frames");
});

test("re-capturing a section replaces it: removed screens go, new ones are added, others stay", () => {
  const baseline = flowBaseline();
  const incoming = snapshot([
    frame("welcome", "frame-001-welcome", 0),
    frame("done", "frame-002-done", 240),
    frame("tour", "frame-003-tour", 360),
  ], "selected sections", [section("onboarding", ["welcome", "done", "tour"])]);
  incoming.assets.find((item) => item.key === "frame-001-welcome").sha256 = "c".repeat(64);

  const merged = merge(baseline, incoming);
  assert.ok(merged);
  assert.deepEqual(merged.snapshot.frames.map((item) => item.sourceFrameId), ["welcome", "done", "loose", "cart", "tour"]);
  assert.ok(merged.replacedFrameIds.includes("permissions"));
  assert.equal(merged.snapshot.assets.some((item) => item.key === "permissions-render"), false, "the removed screen's render is not carried over");
  assert.deepEqual(merged.snapshot.sourceMetadata.sectionRemovedFrameIds, ["permissions"]);
  assert.deepEqual(
    captureSectionRecords(merged.snapshot.sourceMetadata).map(({ sourceSectionId, frameIds }) => [sourceSectionId, frameIds]),
    [["onboarding", ["welcome", "done", "tour"]], ["checkout", ["cart"]]],
  );

  const diff = diffSnapshots({ versionId: "version-1", snapshot: baseline }, { versionId: "version-2", snapshot: merged.snapshot });
  const statuses = Object.fromEntries(diff.frames.map((item) => [item.frameId, item.status]));
  assert.equal(statuses.welcome, "changed");
  // Selected-capture versions don't claim full membership, so the diff calls these out per capture.
  assert.equal(statuses.tour, "only-in-after-capture");
  assert.equal(statuses.permissions, "only-in-before-capture");
  assert.equal(statuses.loose, "unchanged");
  assert.equal(statuses.cart, "unchanged");
});

test("the merged overview keeps no pixels from a screen removed from its section", () => {
  const baseline = flowBaseline();
  const incoming = snapshot([frame("welcome", "frame-001-welcome", 0)], "selected sections", [section("onboarding", ["welcome"])]);
  const plan = createFigmaCaptureMergePlan({ baseline, incoming });
  assert.deepEqual([...plan.removedFrameIds].sort(), ["done", "permissions"]);
  const keep = getFigmaCaptureOverviewKeepRects(baseline.frames, plan.replacedFrameIds, plan.pageOffsets);
  assert.deepEqual(keep.map((rect) => rect.x), [700, 900], "only the untouched screens are copied from the old overview");
});

test("a plain frame capture never removes screens from a section", () => {
  const baseline = flowBaseline();
  const incoming = snapshot([frame("permissions", "frame-001-permissions", 120)], "selected frames and components");
  const merged = merge(baseline, incoming);
  assert.deepEqual(merged.snapshot.frames.map((item) => item.sourceFrameId), ["welcome", "permissions", "done", "loose", "cart"]);
  assert.deepEqual(captureSectionRecords(merged.snapshot.sourceMetadata).map((item) => item.frameIds), [["welcome", "permissions", "done"], ["cart"]]);
});

test("a screen moved into the re-captured section leaves its old section", () => {
  const baseline = flowBaseline();
  const incoming = snapshot([
    frame("welcome", "frame-001-welcome"),
    frame("permissions", "frame-002-permissions", 120),
    frame("done", "frame-003-done", 240),
    frame("cart", "frame-004-cart", 360),
  ], "selected sections", [section("onboarding", ["welcome", "permissions", "done", "cart"])]);
  const merged = merge(baseline, incoming);
  assert.deepEqual(merged.snapshot.frames.map((item) => item.sourceFrameId), ["welcome", "permissions", "done", "loose", "cart"]);
  assert.deepEqual(
    captureSectionRecords(merged.snapshot.sourceMetadata).map(({ sourceSectionId, frameIds }) => [sourceSectionId, frameIds]),
    [["onboarding", ["welcome", "permissions", "done", "cart"]]],
    "the checkout section has no screens left, so it isn't drawn",
  );
});

test("screens unticked in a section capture stay, and a renamed-ID screen replaces its old copy", () => {
  const baseline = flowBaseline();
  const renamed = { ...frame("permissions-v2", "frame-002-permissions", 120), name: "permissions" };
  const incoming = snapshot([frame("welcome", "frame-001-welcome"), renamed], "selected sections", [
    section("onboarding", ["welcome", "permissions-v2"], { skippedFrameIds: ["done"] }),
  ]);
  const merged = merge(baseline, incoming);
  assert.deepEqual(merged.snapshot.frames.map((item) => item.sourceFrameId), ["welcome", "permissions-v2", "done", "loose", "cart"]);
  assert.equal(merged.snapshot.sourceMetadata.sectionRemovedFrameIds, undefined);
  const onboarding = captureSectionRecords(merged.snapshot.sourceMetadata).find((item) => item.sourceSectionId === "onboarding");
  assert.deepEqual(onboarding.frameIds, ["welcome", "permissions-v2", "done"]);
  assert.equal(onboarding.skippedFrameIds, undefined);
});

test("an emptied section that is re-captured with other screens removes its old screens", () => {
  const baseline = flowBaseline();
  const incoming = snapshot([frame("loose", "frame-001-loose", 700)], "selected sections and frames", [section("onboarding", [])]);
  const merged = merge(baseline, incoming);
  assert.deepEqual(merged.snapshot.frames.map((item) => item.sourceFrameId), ["loose", "cart"]);
  assert.deepEqual(captureSectionRecords(merged.snapshot.sourceMetadata).map((item) => item.sourceSectionId), ["checkout"]);
});

test("a page capture replaces the sections recorded on that page", () => {
  const baseline = flowBaseline();
  const incoming = snapshot([frame("welcome", "frame-001-welcome"), frame("loose", "frame-002-loose", 700)], "all top-level frames and components on current page", [
    section("onboarding", ["welcome"]),
  ]);
  const merged = merge(baseline, incoming);
  assert.deepEqual(merged.snapshot.frames.map((item) => item.sourceFrameId), ["welcome", "loose"]);
  assert.deepEqual(captureSectionRecords(merged.snapshot.sourceMetadata).map((item) => item.sourceSectionId), ["onboarding"]);
});

test("removing a screen by hand drops it from its section", () => {
  const baseline = flowBaseline();
  const { snapshot: next } = removeFramesFromSnapshot(baseline, ["cart", "done"]);
  assert.deepEqual(captureSectionRecords(next.sourceMetadata).map(({ sourceSectionId, frameIds }) => [sourceSectionId, frameIds]), [
    ["onboarding", ["welcome", "permissions"]],
  ]);
});

test("section records ignore malformed entries", () => {
  assert.deepEqual(captureSectionRecords({ sections: [null, { sourceSectionId: "a" }, { sourceSectionId: "b", x: 0, y: 0, width: 10, height: 10, fill: "red", frameIds: ["f", 3] }] }), [
    { sourceSectionId: "b", sourcePageId: null, name: "Untitled section", x: 0, y: 0, width: 10, height: 10, fill: null, frameIds: ["f"] },
  ]);
});
