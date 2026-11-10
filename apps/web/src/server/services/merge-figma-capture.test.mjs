import assert from "node:assert/strict";
import test from "node:test";
import { diffSnapshots } from "./diff.ts";
import { createFigmaCaptureMergePlan, getFigmaCaptureOverviewClearRects, mergeFigmaCaptureSnapshots } from "../../../../../packages/snapshot-contract/src/capture-merge.ts";

function measurement(value) {
  return { value, unit: "px", provenance: "source", sourceProperty: "absoluteBoundingBox" };
}

function frame(sourceFrameId, sourcePageId, renderAssetKey, x = 0) {
  const rect = {
    x: measurement(x),
    y: measurement(0),
    width: measurement(100),
    height: measurement(200),
  };
  return {
    sourceFrameId,
    sourcePageId,
    name: sourceFrameId,
    bounds: rect,
    renderAssetKey,
    nodes: [],
  };
}

function asset(key, fileName = `${key}.png`) {
  return {
    key,
    fileName,
    contentType: "image/png",
    sizeBytes: 10,
    sha256: "a".repeat(64),
    width: 100,
    height: 200,
  };
}

function snapshot(frames, captureScope, pageLayout = []) {
  return {
    schemaVersion: 1,
    source: "figma",
    sourceFileId: "file-1",
    sourceRevisionId: "revision-2",
    sourceFileName: "Tripket",
    capturedAt: "2026-11-09T02:00:00.000Z",
    contentHash: "b".repeat(64),
    overviewAssetKey: "overview",
    canvasBounds: {
      x: measurement(0),
      y: measurement(0),
      width: measurement(1000),
      height: measurement(2000),
    },
    frames,
    assets: [asset("overview"), ...frames.map((item) => asset(item.renderAssetKey))],
    sourceMetadata: { sourceTool: "figma", captureScope, pageLayout },
  };
}

test("selected captures replace captured frames and retain every untouched frame", () => {
  const baseline = snapshot([
    frame("home", "page-1", "home-render", 0),
    frame("checkout", "page-1", "checkout-render", 120),
    frame("profile", "page-1", "profile-render", 240),
  ], "all top-level frames and components on current page");
  const incoming = snapshot([
    frame("checkout", "page-1", "frame-001-checkout", 120),
    frame("settings", "page-1", "frame-002-settings", 360),
  ], "selected frames and components");
  incoming.assets.find((item) => item.key === "frame-001-checkout").sha256 = "updated-checkout-render";

  const merged = mergeFigmaCaptureSnapshots({
    baseline,
    incoming,
    baselineVersionId: "version-1",
    assetPrefix: "capture-test",
    frameMatches: [],
  });

  assert.ok(merged, "selected captures must merge into the full baseline");
  assert.deepEqual(merged.snapshot.frames.map((item) => item.sourceFrameId), ["home", "checkout", "profile", "settings"]);
  assert.equal(merged.snapshot.frames[1].renderAssetKey, merged.incomingAssetKeyMap.get("frame-001-checkout"));
  assert.equal(merged.snapshot.frames[1].name, "checkout");
  assert.equal(merged.snapshot.frames[2].renderAssetKey, "profile-render");
  assert.equal(merged.snapshot.overviewAssetKey, merged.incomingAssetKeyMap.get("overview"));
  assert.equal(merged.snapshot.assets.some((item) => item.key === "overview"), false);
  assert.equal(merged.inheritedAssetKeys.includes("profile-render"), true);
  assert.equal(merged.snapshot.sourceMetadata.mergedFromVersionId, "version-1");
  assert.equal(merged.snapshot.sourceMetadata.captureScope, baseline.sourceMetadata.captureScope);
  assert.equal(merged.snapshot.sourceMetadata.lastCaptureScope, "selected frames and components");

  const diff = diffSnapshots(
    { versionId: "version-1", snapshot: baseline },
    { versionId: "version-2", snapshot: merged.snapshot },
  );
  assert.deepEqual(Object.fromEntries(diff.frames.map((item) => [item.frameId, item.status])), {
    checkout: "changed",
    home: "unchanged",
    profile: "unchanged",
    settings: "added",
  });
  assert.equal(diff.captureScopeComparison, null);
  assert.ok(diff.changes.some((change) => change.frameId === "checkout" && change.path === "renderAsset"));
});

test("page captures replace that page while preserving frames from other pages", () => {
  const baseline = snapshot([
    frame("home", "page-1", "home-render"),
    frame("old-modal", "page-1", "modal-render"),
    frame("admin", "page-2", "admin-render", 500),
  ], "all top-level frames and components across all pages", [
    { sourcePageId: "page-1", sourcePageName: "Tripket", offsetX: 0, offsetY: 0, frameCount: 2 },
    { sourcePageId: "page-2", sourcePageName: "Admin", offsetX: 600, offsetY: 0, frameCount: 1 },
  ]);
  const incoming = snapshot([
    frame("home", "page-1", "new-home-render"),
    frame("new-modal", "page-1", "new-modal-render", 200),
  ], "all top-level frames and components on current page", [
    { sourcePageId: "page-1", sourcePageName: "Tripket", offsetX: 0, offsetY: 0, frameCount: 2 },
  ]);

  const merged = mergeFigmaCaptureSnapshots({
    baseline,
    incoming,
    baselineVersionId: "version-1",
    assetPrefix: "capture-test",
    frameMatches: [],
  });

  assert.ok(merged, "page captures must merge with the rest of the file");
  assert.deepEqual(merged.snapshot.frames.map((item) => item.sourceFrameId), ["home", "new-modal", "admin"]);
  assert.equal(merged.snapshot.frames[2].renderAssetKey, "admin-render");
  assert.equal(merged.snapshot.sourceMetadata.pageLayout[1].offsetX, 600);
  assert.equal(merged.snapshot.sourceMetadata.pageLayout[0].frameCount, 2);
});

test("version diff reports frame and layer additions, removals, and edits after a page merge", () => {
  const homeBefore = frame("home", "page-1", "home-render");
  homeBefore.nodes = [
    {
      sourceNodeId: "home-title",
      sourceFrameId: "home",
      parentSourceNodeId: null,
      name: "Title",
      type: "TEXT",
      tokens: [],
      sourcePayload: { textSegments: [{ characters: "Old title" }] },
    },
    {
      sourceNodeId: "old-icon",
      sourceFrameId: "home",
      parentSourceNodeId: null,
      name: "Old icon",
      type: "VECTOR",
      tokens: [],
      sourcePayload: {},
    },
  ];
  const baseline = snapshot([
    homeBefore,
    frame("removed-modal", "page-1", "removed-modal-render", 120),
    frame("admin", "page-2", "admin-render", 500),
  ], "all top-level frames and components across all pages", [
    { sourcePageId: "page-1", sourcePageName: "Tripket", offsetX: 0, offsetY: 0, frameCount: 2 },
    { sourcePageId: "page-2", sourcePageName: "Admin", offsetX: 600, offsetY: 0, frameCount: 1 },
  ]);

  const homeAfter = frame("home", "page-1", "updated-home-render");
  homeAfter.nodes = [
    {
      sourceNodeId: "home-title",
      sourceFrameId: "home",
      parentSourceNodeId: null,
      name: "Title",
      type: "TEXT",
      tokens: [],
      sourcePayload: { textSegments: [{ characters: "Updated title" }] },
    },
    {
      sourceNodeId: "new-icon",
      sourceFrameId: "home",
      parentSourceNodeId: null,
      name: "New icon",
      type: "VECTOR",
      tokens: [],
      sourcePayload: {},
    },
  ];
  const incoming = snapshot([
    homeAfter,
    frame("new-modal", "page-1", "new-modal-render", 120),
  ], "all top-level frames and components on current page", [
    { sourcePageId: "page-1", sourcePageName: "Tripket", offsetX: 0, offsetY: 0, frameCount: 2 },
  ]);
  incoming.assets.find((item) => item.key === "updated-home-render").sha256 = "updated-home-bytes";
  incoming.assets.find((item) => item.key === "new-modal-render").sha256 = "new-modal-bytes";

  const merged = mergeFigmaCaptureSnapshots({
    baseline,
    incoming,
    baselineVersionId: "version-1",
    assetPrefix: "capture-test",
  });
  assert.ok(merged);

  const diff = diffSnapshots(
    { versionId: "version-1", snapshot: baseline },
    { versionId: "version-2", snapshot: merged.snapshot },
  );
  assert.deepEqual(Object.fromEntries(diff.frames.map((item) => [item.frameId, item.status])), {
    admin: "unchanged",
    home: "changed",
    "new-modal": "added",
    "removed-modal": "removed",
  });
  assert.equal(diff.captureScopeComparison, null);
  assert.ok(diff.changes.some((change) => change.frameId === "home" && change.path === "renderAsset"));
  assert.ok(diff.changes.some((change) => change.sourceNodeId === "home-title" && change.category === "text"));
  assert.ok(diff.changes.some((change) => change.sourceNodeId === "old-icon" && change.path === "node" && change.after === undefined));
  assert.ok(diff.changes.some((change) => change.sourceNodeId === "new-icon" && change.path === "node" && change.before === undefined));
});

test("confirmed name matches replace old IDs and file captures remain complete replacements", () => {
  const baseline = snapshot([
    frame("old-screen", "page-1", "old-render"),
    frame("untouched", "page-1", "untouched-render", 120),
  ], "all top-level frames and components on current page");
  const selected = snapshot([
    frame("new-screen", "page-1", "new-render"),
  ], "selected frames and components");
  selected.assets.find((item) => item.key === "new-render").sha256 = "new-screen-render";

  const merged = mergeFigmaCaptureSnapshots({
    baseline,
    incoming: selected,
    baselineVersionId: "version-1",
    assetPrefix: "capture-test",
    frameMatches: [{ beforeFrameId: "old-screen", afterFrameId: "new-screen" }],
  });

  assert.ok(merged, "confirmed frame matches must merge into the baseline");
  assert.deepEqual(merged.snapshot.frames.map((item) => item.sourceFrameId), ["new-screen", "untouched"]);
  const plan = createFigmaCaptureMergePlan({
    baseline,
    incoming: selected,
    frameMatches: [{ beforeFrameId: "old-screen", afterFrameId: "new-screen" }],
  });
  assert.ok(plan);
  assert.deepEqual(plan.frames.map((item) => item.sourceFrameId), ["new-screen", "untouched"]);
  assert.deepEqual(getFigmaCaptureOverviewClearRects(baseline.frames, plan.replacedFrameIds, plan.pageOffsets), [
    { x: 0, y: 0, width: 100, height: 200 },
  ]);
  const replacementDiff = diffSnapshots(
    { versionId: "version-1", snapshot: baseline },
    { versionId: "version-2", snapshot: merged.snapshot },
    { frameMatches: [{ beforeFrameId: "old-screen", afterFrameId: "new-screen" }] },
  );
  assert.deepEqual(Object.fromEntries(replacementDiff.frames.map((item) => [item.frameId, item.status])), {
    "new-screen": "changed",
    untouched: "unchanged",
  });
  assert.ok(replacementDiff.changes.some((change) => change.frameId === "new-screen" && change.path === "renderAsset"));
  const fileCapture = snapshot([frame("only-frame", "page-1", "only-render")], "all top-level frames and components across all pages");
  assert.equal(mergeFigmaCaptureSnapshots({
    baseline,
    incoming: fileCapture,
    baselineVersionId: "version-1",
    assetPrefix: "capture-test",
    frameMatches: [],
  }), null);
});

test("selected frames keep their original Figma page offset in a multi-page canvas", () => {
  const baseline = snapshot([
    frame("home", "page-1", "home-render"),
    frame("checkout", "page-2", "checkout-render", 40),
  ], "all top-level frames and components across all pages", [
    { sourcePageId: "page-1", sourcePageName: "Home", offsetX: 0, offsetY: 0, frameCount: 1 },
    { sourcePageId: "page-2", sourcePageName: "Checkout", offsetX: 600, offsetY: 0, frameCount: 1 },
  ]);
  const incoming = snapshot([
    frame("checkout", "page-2", "new-checkout-render", 40),
  ], "selected frames and components", [
    { sourcePageId: "page-2", sourcePageName: "Checkout", offsetX: 0, offsetY: 0, frameCount: 1 },
  ]);

  const plan = createFigmaCaptureMergePlan({ baseline, incoming });

  assert.equal(plan.incomingOffsetDeltas.get("page-2").x, 600);
  assert.equal(plan.pageOffsets.get("page-2").offsetX, 600);
  assert.deepEqual(plan.replacedFrameIds, ["checkout"]);
});

test("merged captures retain layer export assets and remap incoming layer references", () => {
  const oldFrame = frame("home", "page-1", "home-render");
  oldFrame.nodes = [{ sourcePayload: { layerExportAssetKey: "home-icon" } }];
  const baseline = snapshot([oldFrame, frame("checkout", "page-1", "checkout-render", 120)], "all top-level frames and components on current page");
  baseline.assets.push(asset("home-icon", "home-icon.svg"));

  const nextFrame = frame("home", "page-1", "frame-001-home");
  nextFrame.nodes = [{ sourcePayload: { layerExportAssetKey: "home-icon-new" } }];
  const incoming = snapshot([nextFrame], "selected frames and components");
  incoming.assets.push(asset("home-icon-new", "home-icon.svg"));

  const merged = mergeFigmaCaptureSnapshots({
    baseline,
    incoming,
    baselineVersionId: "version-1",
    assetPrefix: "capture-test",
  });

  assert.ok(merged);
  assert.equal(merged.snapshot.assets.some((item) => item.key === "home-icon"), false);
  assert.equal(merged.snapshot.assets.some((item) => item.key === merged.incomingAssetKeyMap.get("home-icon-new")), true);
  assert.equal(merged.snapshot.frames[0].nodes[0].sourcePayload.layerExportAssetKey, merged.incomingAssetKeyMap.get("home-icon-new"));
});
