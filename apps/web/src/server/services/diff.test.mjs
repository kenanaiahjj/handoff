import assert from "node:assert/strict";
import test from "node:test";
import * as diffService from "./diff.ts";

const { diffSnapshots } = diffService;

function styleIds(prefix) {
  return {
    styleId: `S:${prefix}`,
    textStyleId: `T:${prefix}`,
    textFillStyleId: `TF:${prefix}`,
    fillStyleId: `F:${prefix}`,
    strokeStyleId: `ST:${prefix}`,
    fillPaintStyleId: `FP:${prefix}`,
    strokePaintStyleId: `SP:${prefix}`,
  };
}

function snapshot(sourceFileId, frameId, { styleId, textStyleId, textFillStyleId, fillStyleId, strokeStyleId, fillPaintStyleId, strokePaintStyleId, styleName = "Text/Body", text = "Review the booking" }) {
  return {
    sourceFileId,
    frames: [
      {
        sourceFrameId: frameId,
        sourcePageId: "page-1",
        name: "Review",
        renderAssetKey: "render",
        nodes: [
          {
            sourceNodeId: "node-title",
            name: "Title",
            type: "TEXT",
            fills: [{ color: "#ffffff", sourceStyleId: fillStyleId }],
            strokes: [{ color: "#111111", sourceStyleId: strokeStyleId }],
            styleReferences: [{ kind: "typography", sourceStyleId: styleId, name: styleName }],
            tokens: [],
            sourcePayload: {
              textSegments: [{ textStyleId, fillStyleId: textFillStyleId, characters: text }],
              fillPaintDetails: [{ styleId: fillPaintStyleId, color: "#ffffff" }],
              strokePaintDetails: [{ styleId: strokePaintStyleId, color: "#111111" }],
            },
          },
        ],
      },
    ],
    assets: [{ key: "render", sha256: "same-render" }],
  };
}

function compare(before, after, frameMatches, nodeMatches) {
  return diffSnapshots(
    { versionId: "before", snapshot: before },
    { versionId: "after", snapshot: after },
    { frameMatches, nodeMatches },
  );
}

function figmaSnapshot(scope, frameId = "frame") {
  const value = snapshot("same-file", frameId, styleIds("shared"));
  return {
    ...value,
    source: "figma",
    sourceMetadata: scope === undefined
      ? {}
      : { captureScope: scope, sourcePageId: scope === "file" ? null : "page-1" },
  };
}

function figmaSnapshotWithFrames(scope, frameIds, pageId = "page-1") {
  const base = figmaSnapshot(scope, frameIds[0] ?? "empty");
  return {
    ...base,
    sourceMetadata: {
      ...base.sourceMetadata,
      sourcePageId: scope === "file" ? null : pageId,
    },
    frames: frameIds.map((frameId) => ({
      ...structuredClone(base.frames[0]),
      sourceFrameId: frameId,
      sourcePageId: scope === "file" ? `page-${frameId}` : pageId,
      name: frameId,
    })),
  };
}

test("does not report a visual change when a render asset key changes but its bytes do not", () => {
  const before = snapshot("same-file", "frame", styleIds("shared"));
  const after = snapshot("same-file", "frame", styleIds("shared"));
  before.frames[0].renderAssetKey = "render-before";
  before.assets[0].key = "render-before";
  after.frames[0].renderAssetKey = "render-after";
  after.assets[0].key = "render-after";

  const result = compare(before, after);

  assert.deepEqual(result.changes, []);
  assert.equal(result.frames[0].status, "unchanged");
});

test("reports when Figma versions were captured with different scopes", () => {
  const result = compare(
    figmaSnapshot("all top-level frames and components on current page"),
    figmaSnapshot("selected frames and components"),
  );

  assert.deepEqual(result.captureScopeComparison, {
    status: "different",
    before: "All top-level frames and components on the current page",
    after: "Selected frames and components",
  });
  assert.equal(result.frames[0].status, "unchanged");
});

test("normalizes equivalent Figma scope values before comparing them", () => {
  const result = compare(
    figmaSnapshot("selected"),
    figmaSnapshot("selected frames and components"),
  );

  assert.equal(result.captureScopeComparison, null);
});

test("marks Figma scope as unrecorded when either version lacks it", () => {
  const result = compare(figmaSnapshot(undefined), figmaSnapshot("file"));

  assert.deepEqual(result.captureScopeComparison, {
    status: "unrecorded",
    before: null,
    after: "All top-level frames and components across all pages",
  });
});

test("does not apply Figma scope warnings to other snapshot sources", () => {
  const before = { ...figmaSnapshot("selected"), source: "paper" };
  const after = { ...figmaSnapshot("file"), source: "paper" };

  assert.equal(compare(before, after).captureScopeComparison, null);
});

test("treats regenerated Figma style IDs as unchanged across copied files", () => {
  const result = compare(
    snapshot("file-copy-a", "frame-a", styleIds("old")),
    snapshot("file-copy-b", "frame-b", styleIds("new")),
    [{ beforeFrameId: "frame-a", afterFrameId: "frame-b" }],
  );

  assert.deepEqual(result.changes, []);
  assert.equal(result.frames[0].status, "unchanged");
});

test("keeps visible text and style-name changes across copied files", () => {
  const result = compare(
    snapshot("file-copy-a", "frame-a", {
      ...styleIds("old"),
      styleName: "Text/Body",
      text: "Review the booking",
    }),
    snapshot("file-copy-b", "frame-b", {
      ...styleIds("new"),
      styleName: "Text/Heading",
      text: "Review your booking",
    }),
    [{ beforeFrameId: "frame-a", afterFrameId: "frame-b" }],
  );

  assert.deepEqual(
    result.changes.map((change) => change.path),
    ["sourcePayload.textSegments[0].characters", "styleReferences[0].name"],
  );
  assert.equal(result.changes[0].sourceNodeName, "Title");
});

test("matches a legacy Figma source ID to a file-keyed capture when the file name and frame ID agree", () => {
  const before = {
    ...snapshot("0:0", "frame-1", { ...styleIds("shared"), text: "Review the booking" }),
    sourceFileName: "Tripket.ph",
  };
  const after = {
    ...snapshot("nzHr6oM1X4eZj41Wg9cqQM", "frame-1", { ...styleIds("shared"), text: "Review your booking" }),
    sourceFileName: "Tripket.ph",
  };

  const result = compare(before, after);

  assert.equal(result.frames.length, 1);
  assert.equal(result.frames[0].status, "changed");
  assert.equal(result.frames[0].sourceFileId, "nzHr6oM1X4eZj41Wg9cqQM");
  assert.equal(result.sourceIdentity, "inferred");
  assert.ok(result.changes.some((change) => change.path === "sourcePayload.textSegments[0].characters"));
});

test("keeps matching legacy Figma frames when the file was renamed", () => {
  const before = {
    ...snapshot("0:0", "frame-1", { ...styleIds("shared"), text: "Review the booking" }),
    sourceFileName: "Tripket.ph",
  };
  const after = {
    ...snapshot("nzHr6oM1X4eZj41Wg9cqQM", "frame-1", { ...styleIds("shared"), text: "Review your booking" }),
    sourceFileName: "Tripket Mobile App",
  };

  const result = compare(before, after);

  assert.equal(result.frames.length, 1);
  assert.equal(result.frames[0].status, "changed");
  assert.equal(result.sourceIdentity, "inferred");
});

test("does not infer a legacy source match when file names differ", () => {
  const before = {
    ...snapshot("0:0", "frame-1", styleIds("shared")),
    sourceFileName: "Tripket.ph",
  };
  const after = {
    ...snapshot("another-file-key", "frame-2", styleIds("shared")),
    sourceFileName: "Tripket.ph Copy",
  };

  const result = compare(before, after);

  assert.equal(result.sourceIdentity, "different");
  assert.deepEqual(result.frames.map((frame) => frame.status).sort(), ["only-in-after-capture", "only-in-before-capture"]);
});

test("classifies unmatched screens in selected Figma captures as capture-only", () => {
  const result = compare(
    figmaSnapshotWithFrames("selected", ["screen-before"]),
    figmaSnapshotWithFrames("selected", ["screen-after"]),
  );

  assert.deepEqual(
    result.frames.map((frame) => frame.status).sort(),
    ["only-in-after-capture", "only-in-before-capture"],
  );
  assert.deepEqual(result.changes, []);
});

test("keeps true additions for complete captures of the same Figma page", () => {
  const result = compare(
    figmaSnapshotWithFrames("page", ["screen-existing"]),
    figmaSnapshotWithFrames("page", ["screen-existing", "screen-new"]),
  );

  assert.equal(result.frames.find((frame) => frame.frameId === "screen-new")?.status, "added");
  assert.equal(result.changes.filter((change) => change.path === "frame").length, 1);
});

test("classifies screens from different Figma pages as capture-only", () => {
  const result = compare(
    figmaSnapshotWithFrames("page", ["screen-before"], "page-before"),
    figmaSnapshotWithFrames("page", ["screen-after"], "page-after"),
  );

  assert.deepEqual(
    result.frames.map((frame) => frame.status).sort(),
    ["only-in-after-capture", "only-in-before-capture"],
  );
  assert.deepEqual(result.changes, []);
});

test("treats a missing Figma capture scope as insufficient evidence for screen additions", () => {
  const before = figmaSnapshotWithFrames(undefined, ["screen-before"]);
  const after = figmaSnapshotWithFrames("page", ["screen-after"]);

  const result = compare(before, after);

  assert.equal(result.captureScopeComparison?.status, "unrecorded");
  assert.deepEqual(
    result.frames.map((frame) => frame.status).sort(),
    ["only-in-after-capture", "only-in-before-capture"],
  );
});

test("treats regenerated style IDs as unchanged within the same Figma file", () => {
  const result = compare(
    snapshot("same-file", "frame", styleIds("old")),
    snapshot("same-file", "frame", styleIds("new")),
    [{ beforeFrameId: "frame", afterFrameId: "frame" }],
  );

  assert.deepEqual(result.changes, []);
  assert.equal(result.frames[0].status, "unchanged");
});

test("keeps text and style-name changes when IDs regenerate within the same file", () => {
  const result = compare(
    snapshot("same-file", "frame", {
      ...styleIds("old"),
      styleName: "Text/Body",
      text: "Review the booking",
    }),
    snapshot("same-file", "frame", {
      ...styleIds("new"),
      styleName: "Text/Heading",
      text: "Review your booking",
    }),
    [{ beforeFrameId: "frame", afterFrameId: "frame" }],
  );

  assert.deepEqual(
    result.changes.map((change) => change.path),
    ["sourcePayload.textSegments[0].characters", "styleReferences[0].name"],
  );
});

test("keeps a same-name screen separate until an explicit frame match is supplied", () => {
  const before = snapshot("same-file", "review-before", styleIds("same"));
  const after = snapshot("same-file", "review-after", styleIds("same"));

  const unmatched = compare(before, after);
  assert.equal(unmatched.frames.filter((frame) => frame.status === "removed").length, 1);
  assert.equal(unmatched.frames.filter((frame) => frame.status === "added").length, 1);
  assert.equal(unmatched.unmatchedFrameCandidates.length, 1);
  assert.equal(unmatched.unmatchedFrameCandidates[0].beforeFrameId, "review-before");
  assert.equal(unmatched.unmatchedFrameCandidates[0].afterCandidates[0].frameId, "review-after");

  const matched = compare(before, after, [
    { beforeFrameId: "review-before", afterFrameId: "review-after" },
  ]);
  assert.equal(matched.frames.length, 1);
  assert.equal(matched.frames[0].status, "unchanged");
  assert.equal(matched.frames[0].beforeFrameId, "review-before");
  assert.equal(matched.frames[0].afterFrameId, "review-after");
  assert.equal(matched.unmatchedFrameCandidates.length, 0);
});

test("bounds duplicate screen suggestions while keeping every after screen matchable", () => {
  const before = snapshot("same-file", "before-000", styleIds("same"));
  before.frames[0].name = "Screen";
  before.frames = Array.from({ length: 210 }, (_, index) => ({
    ...structuredClone(before.frames[0]),
    sourceFrameId: `before-${String(index).padStart(3, "0")}`,
  }));
  const after = structuredClone(before);
  after.frames = Array.from({ length: 210 }, (_, index) => ({
    ...structuredClone(before.frames[0]),
    sourceFrameId: `after-${String(index).padStart(2, "0")}`,
  }));

  const unmatched = compare(before, after);
  const suggestion = unmatched.unmatchedFrameCandidates.find((candidate) => candidate.beforeFrameId === "before-000");

  assert.equal(unmatched.unmatchedFrameCandidates.length, 210);
  assert.ok(unmatched.unmatchedFrameCandidates.every((candidate) => candidate.totalCandidates === 210 && candidate.candidatesTruncated));
  assert.ok(suggestion);
  assert.equal(suggestion.totalCandidates, 210);
  assert.equal(suggestion.candidatesTruncated, true);
  assert.equal(suggestion.afterCandidates.length, 10);
  assert.deepEqual(
    suggestion.afterCandidates.map((candidate) => candidate.frameId),
    after.frames.slice(0, 10).map((frame) => frame.sourceFrameId),
  );
  const availableAfterFrames = unmatched.frames.filter((frame) => frame.beforeFrameId === null && frame.afterFrameId !== null);
  assert.equal(availableAfterFrames.length, 210);
  assert.ok(availableAfterFrames.some((frame) => frame.afterFrameId === "after-209"));

  const matched = compare(before, after, [{ beforeFrameId: "before-209", afterFrameId: "after-209" }]);
  assert.ok(matched.frames.some((frame) => frame.beforeFrameId === "before-209" && frame.afterFrameId === "after-209"));
  assert.equal(matched.unmatchedFrameCandidates.length, 209);
});

test("keeps unmatched frame change payloads compact instead of embedding their layer trees", () => {
  const before = snapshot("same-file", "review-before", styleIds("shared"));
  const after = snapshot("same-file", "review-after", styleIds("shared"));
  after.frames[0].nodes = Array.from({ length: 100 }, (_, index) => ({
    sourceNodeId: `node-${index}`,
    name: `Layer ${index}`,
    type: "RECTANGLE",
    fills: [],
    strokes: [],
    styleReferences: [],
    tokens: [],
    sourcePayload: { metadata: "large payload" },
  }));

  const result = compare(before, after);
  const addedFrameChange = result.changes.find((change) => change.path === "frame" && change.after !== undefined);

  assert.deepEqual(addedFrameChange?.after, { name: "Review" });
  assert.equal(JSON.stringify(result).includes("large payload"), false);
});

function fiveScreenSnapshot(revision) {
  const screens = [
    { id: "untouched", name: "Unchanged screen", change: null },
    { id: "geometry", name: "Resized screen", change: "geometry" },
    { id: "layout", name: "Layout screen", change: "layout" },
    { id: "style", name: "Style screen", change: "style" },
    { id: "content", name: "Content screen", change: "content" },
  ];

  return {
    sourceFileId: "tripket-test-file",
    frames: screens.map((screen) => {
      const changed = revision === "after" && screen.change !== null;
      return {
        sourceFrameId: `frame-${screen.id}`,
        sourcePageId: "booking-flow",
        name: screen.name,
        renderAssetKey: `render-${screen.id}`,
        nodes: [
          {
            sourceNodeId: `node-${screen.id}`,
            name: "Primary action",
            type: "RECTANGLE",
            bounds: {
              x: 0,
              y: 0,
              width: changed && screen.change === "geometry" ? 400 : 392,
              height: 56,
            },
            layout: { itemSpacing: changed && screen.change === "layout" ? 12 : 8 },
            fills: [{ color: changed && screen.change === "style" ? "#aaff00" : "#ff6600" }],
            strokes: [],
            styleReferences: [],
            tokens: [
              {
                sourceId: "color.action",
                name: "Action color",
                collection: "Semantic",
                mode: "Light",
                value: changed && screen.change === "style" ? "#aaff00" : "#ff6600",
              },
            ],
            sourcePayload: {
              textSegments: [
                { characters: changed && screen.change === "content" ? "Continue booking" : "Continue" },
              ],
            },
          },
        ],
      };
    }),
    assets: screens.map((screen) => ({
      key: `render-${screen.id}`,
      sha256: revision === "after" && screen.change !== null ? `after-${screen.id}` : `same-${screen.id}`,
    })),
  };
}

test("detects changes across five screens and keeps an untouched screen unchanged", () => {
  const diff = diffSnapshots(
    { versionId: "before", snapshot: fiveScreenSnapshot("before") },
    { versionId: "after", snapshot: fiveScreenSnapshot("after") },
  );

  assert.equal(diff.frames.length, 5);
  assert.equal(diff.frames.filter((frame) => frame.status === "changed").length, 4);
  assert.equal(diff.frames.filter((frame) => frame.status === "unchanged").length, 1);
  assert.equal(diff.frames.find((frame) => frame.name === "Unchanged screen")?.status, "unchanged");
  assert.deepEqual(
    [...new Set(diff.changes.map((change) => change.category))].sort(),
    ["geometry", "layout", "style", "text", "token", "visual"],
  );
  assert.ok(diff.changes.some((change) =>
    change.frameId === "frame-geometry" && change.path === "bounds.width" && change.before === 392 && change.after === 400));
  assert.ok(diff.changes.some((change) =>
    change.frameId === "frame-layout" && change.path === "layout.itemSpacing" && change.before === 8 && change.after === 12));
  assert.ok(diff.changes.some((change) =>
    change.frameId === "frame-style" && change.category === "token"));
  assert.ok(diff.changes.some((change) =>
    change.frameId === "frame-content" &&
    change.path === "sourcePayload.textSegments[0].characters" &&
    change.category === "text"));
});

test("reports frame size once while preserving root layout changes", () => {
  const frameSnapshot = (width, leftPadding) => {
    const result = snapshot("same-file", "frame", styleIds("same"));
    const measurement = (value, sourceProperty) => ({
      value,
      unit: "px",
      provenance: "source",
      sourceProperty,
    });
    const frame = result.frames[0];
    frame.bounds = {
      x: measurement(100, "absoluteBoundingBox.x"),
      y: measurement(200, "absoluteBoundingBox.y"),
      width: measurement(width, "absoluteBoundingBox.width"),
      height: measurement(253, "absoluteBoundingBox.height"),
    };
    frame.nodes[0] = {
      ...frame.nodes[0],
      sourceNodeId: "frame",
      sourceFrameId: "frame",
      name: "Review",
      type: "FRAME",
      bounds: {
        x: measurement(0, "absoluteBoundingBox.x - frame.absoluteBoundingBox.x"),
        y: measurement(0, "absoluteBoundingBox.y - frame.absoluteBoundingBox.y"),
        width: measurement(width, "absoluteBoundingBox.width"),
        height: measurement(253, "absoluteBoundingBox.height"),
      },
      padding: { left: measurement(leftPadding, "paddingLeft") },
    };
    return result;
  };

  const result = compare(frameSnapshot(345, 16), frameSnapshot(349, 20));
  const widthChanges = result.changes.filter((change) => change.path === "bounds.width.value");

  assert.equal(widthChanges.length, 1);
  assert.equal(widthChanges[0].sourceNodeId, null);
  assert.ok(result.changes.some((change) =>
    change.sourceNodeId === "frame" && change.path === "padding.left.value" && change.before === 16 && change.after === 20));
});

test("ignores legacy margins on a frame root because they describe canvas placement", () => {
  const withRootMargins = (margins) => {
    const value = snapshot("same-file", "frame", styleIds("same"));
    value.frames[0].nodes[0].sourceNodeId = "frame";
    value.frames[0].nodes[0].margins = margins;
    return value;
  };
  const measurement = (value) => ({ value, unit: "px", provenance: "measured", sourceProperty: "parent bounds" });
  const margins = (right) => ({
    top: measurement(20),
    right: measurement(right),
    bottom: measurement(20),
    left: measurement(20),
  });

  const result = compare(
    withRootMargins(margins(3511)),
    withRootMargins(margins(3519)),
    [{ beforeFrameId: "frame", afterFrameId: "frame" }],
  );

  assert.deepEqual(result.changes, []);
});

function clonedFrameSnapshot(frameId, content, addedNode = false) {
  const measurement = (value) => ({ value, unit: "px", provenance: "source", sourceProperty: "absoluteBoundingBox" });
  const bounds = { x: measurement(0), y: measurement(0), width: measurement(320), height: measurement(56) };
  const node = (sourceNodeId, parentSourceNodeId, name, type, text = null) => ({
    sourceNodeId,
    parentSourceNodeId,
    sourceFrameId: frameId,
    name,
    type,
    visible: true,
    bounds,
    layout: { mode: null, direction: null, primaryAxisAlign: null, counterAxisAlign: null, wrap: null, constraints: {} },
    padding: {},
    margins: {},
    spacing: {},
    fills: [],
    strokes: [],
    styleReferences: [],
    typography: null,
    tokens: [],
    sourcePayload: text === null ? {} : { textSegments: [{ characters: text }] },
  });
  const layoutId = `${frameId}-layout`;
  const contentId = `${frameId}-content`;
  const actionId = `${frameId}-action`;
  const labelId = `${frameId}-label`;
  const nodes = [
    node(frameId, null, "Review", "FRAME"),
    node(layoutId, frameId, "Layout", "FRAME"),
    node(contentId, layoutId, "Main Content", "FRAME"),
    node(actionId, contentId, "Primary action", "FRAME"),
    node(labelId, actionId, "Label", "TEXT", content),
  ];
  if (addedNode) nodes.push(node(`${frameId}-icon`, actionId, "Status icon", "VECTOR"));
  return {
    sourceFileId: "figma-file",
    frames: [{
      sourceFrameId: frameId,
      sourcePageId: "page-1",
      name: "Review",
      bounds,
      renderAssetKey: "render",
      nodes,
    }],
    assets: [{ key: "render", sha256: "same-render" }],
  };
}

function regeneratedLayerSnapshot(frameId, layers) {
  const measurement = (value, sourceProperty) => ({
    value,
    unit: "px",
    provenance: "source",
    sourceProperty,
  });
  const rootBounds = {
    x: measurement(0, "absoluteBoundingBox.x"),
    y: measurement(0, "absoluteBoundingBox.y"),
    width: measurement(320, "absoluteBoundingBox.width"),
    height: measurement(56, "absoluteBoundingBox.height"),
  };
  const nodes = [{
    sourceNodeId: frameId,
    sourceFrameId: frameId,
    parentSourceNodeId: null,
    name: "Review",
    type: "FRAME",
    visible: true,
    bounds: rootBounds,
    layout: {},
    padding: {},
    margins: {},
    spacing: {},
    fills: [],
    strokes: [],
    styleReferences: [],
    typography: null,
    tokens: [],
    sourcePayload: {},
  }, ...layers.map(({ sourceNodeId, name, type, x, text }) => ({
    sourceNodeId,
    sourceFrameId: frameId,
    parentSourceNodeId: frameId,
    name,
    type,
    visible: true,
    bounds: {
      x: measurement(x, "absoluteBoundingBox.x"),
      y: measurement(0, "absoluteBoundingBox.y"),
      width: measurement(120, "absoluteBoundingBox.width"),
      height: measurement(40, "absoluteBoundingBox.height"),
    },
    layout: {},
    padding: {},
    margins: {},
    spacing: {},
    fills: [],
    strokes: [],
    styleReferences: [],
    typography: null,
    tokens: [],
    sourcePayload: text === undefined ? {} : { textSegments: [{ characters: text }] },
  }))];

  return {
    sourceFileId: "figma-file",
    frames: [{
      sourceFrameId: frameId,
      sourcePageId: "page-1",
      name: "Review",
      bounds: rootBounds,
      renderAssetKey: "render",
      nodes,
    }],
    assets: [{ key: "render", sha256: "same-render" }],
  };
}

test("matches cloned Figma layers by their hierarchy when source IDs regenerate", () => {
  const result = compare(
    clonedFrameSnapshot("frame-before", "Continue"),
    clonedFrameSnapshot("frame-after", "Continue"),
    [{ beforeFrameId: "frame-before", afterFrameId: "frame-after" }],
  );

  assert.equal(result.frames[0].status, "unchanged");
  assert.deepEqual(result.changes, []);
});

test("reports content edits and added layers after matching cloned Figma IDs", () => {
  const result = compare(
    clonedFrameSnapshot("frame-before", "Continue"),
    clonedFrameSnapshot("frame-after", "Continue booking", true),
    [{ beforeFrameId: "frame-before", afterFrameId: "frame-after" }],
  );

  assert.equal(result.frames[0].status, "changed");
  assert.ok(result.changes.some((change) =>
    change.path === "sourcePayload.textSegments[0].characters" &&
    change.before === "Continue" &&
    change.after === "Continue booking" &&
    change.category === "text"));
  assert.equal(result.changes.filter((change) => change.path === "node" && change.after?.name === "Status icon").length, 1);
  assert.equal(result.changes.filter((change) => change.path === "node" && change.before?.name === "Review").length, 0);
});

test("leaves duplicate regenerated layers unmatched instead of pairing by traversal order", () => {
  const result = compare(
    regeneratedLayerSnapshot("frame-before", [
      { sourceNodeId: "before-a", name: "Action", type: "TEXT", x: 24, text: "Back" },
      { sourceNodeId: "before-b", name: "Action", type: "TEXT", x: 180, text: "Next" },
    ]),
    regeneratedLayerSnapshot("frame-after", [
      { sourceNodeId: "after-b", name: "Action", type: "TEXT", x: 180, text: "Next" },
      { sourceNodeId: "after-a", name: "Action", type: "TEXT", x: 24, text: "Back" },
    ]),
    [{ beforeFrameId: "frame-before", afterFrameId: "frame-after" }],
  );

  assert.equal(result.changes.filter((change) => change.path === "node").length, 4);
  assert.equal(result.changes.some((change) => change.category === "geometry" || change.category === "text"), false);
  assert.equal(result.unmatchedNodeCandidates.length, 2);
  assert.ok(result.unmatchedNodeCandidates.every((candidate) => candidate.afterCandidates.length === 2));
});

test("leaves renamed regenerated layers as candidates instead of matching by type alone", () => {
  const result = compare(
    regeneratedLayerSnapshot("frame-before", [
      { sourceNodeId: "before-title", name: "Heading", type: "TEXT", x: 24, text: "Review" },
    ]),
    regeneratedLayerSnapshot("frame-after", [
      { sourceNodeId: "after-title", name: "Page title", type: "TEXT", x: 24, text: "Review" },
    ]),
    [{ beforeFrameId: "frame-before", afterFrameId: "frame-after" }],
  );

  assert.equal(result.changes.filter((change) => change.path === "node").length, 2);
  assert.equal(result.changes.some((change) => change.path === "name"), false);
  assert.equal(result.unmatchedNodeCandidates.length, 1);
  assert.equal(result.unmatchedNodeCandidates[0].afterCandidates[0].sourceNodeId, "after-title");
});

test("uses a reviewer-confirmed layer match to compare renamed regenerated IDs", () => {
  const result = compare(
    regeneratedLayerSnapshot("frame-before", [
      { sourceNodeId: "before-title", name: "Heading", type: "TEXT", x: 24, text: "Review" },
    ]),
    regeneratedLayerSnapshot("frame-after", [
      { sourceNodeId: "after-title", name: "Page title", type: "TEXT", x: 32, text: "Review" },
    ]),
    [{ beforeFrameId: "frame-before", afterFrameId: "frame-after" }],
    [{
      beforeFrameId: "frame-before",
      afterFrameId: "frame-after",
      beforeNodeId: "before-title",
      afterNodeId: "after-title",
    }],
  );

  assert.equal(result.changes.some((change) => change.path === "node"), false);
  assert.equal(result.changes.some((change) => change.path === "name" && change.before === "Heading" && change.after === "Page title"), true);
  assert.equal(result.changes.some((change) => change.path === "bounds.x.value" && change.before === 24 && change.after === 32), true);
  assert.equal(result.unmatchedNodeCandidates.length, 0);
});

function tokenSnapshot(token, sourceFileId = "same-file") {
  const result = snapshot(sourceFileId, "frame", styleIds("same"));
  result.frames[0].nodes[0].tokens = [token];
  return result;
}

test("ignores variable and collection ID churn across copied files when a binding keeps the same meaning", () => {
  const token = (sourceId, collectionId) => ({
    sourceId,
    bindingPath: "fills[0]",
    category: "color",
    name: "text/primary",
    collectionId,
    collectionName: "Semantic Colors",
    mode: "Light",
    value: "#222222",
  });

  const result = compare(
    tokenSnapshot(token("VariableID:old", "Collection:old"), "file-copy-before"),
    tokenSnapshot(token("VariableID:new", "Collection:new"), "file-copy-after"),
    [{ beforeFrameId: "frame", afterFrameId: "frame" }],
  );

  assert.deepEqual(result.changes, []);
});

test("reports bound variable and collection ID changes within the same source file", () => {
  const token = (sourceId, collectionId) => ({
    sourceId,
    bindingPath: "fills[0]",
    category: "color",
    name: "text/primary",
    collectionId,
    collectionName: "Semantic Colors",
    mode: "Light",
    value: "#222222",
  });

  const result = compare(
    tokenSnapshot(token("VariableID:old", "Collection:old")),
    tokenSnapshot(token("VariableID:new", "Collection:new")),
  );

  assert.deepEqual(
    result.changes.map(({ path, category }) => [path, category]),
    [
      ['tokens["color:fills[0]"].collectionId', "token"],
      ['tokens["color:fills[0]"].sourceId', "token"],
    ],
  );
});

test("reports semantic token edits under the stable property binding", () => {
  const result = compare(
    tokenSnapshot({
      sourceId: "VariableID:shared",
      bindingPath: "fills[0]",
      category: "color",
      name: "text/primary",
      collectionId: "Collection:shared",
      collectionName: "Semantic Colors",
      mode: "Light",
      value: { r: 0.13, g: 0.13, b: 0.13, a: 1 },
    }),
    tokenSnapshot({
      sourceId: "VariableID:shared",
      bindingPath: "fills[0]",
      category: "color",
      name: "text/placeholder",
      collectionId: "Collection:shared",
      collectionName: "Brand Colors",
      mode: "Dark",
      value: { r: 0.55, g: 0.55, b: 0.58, a: 1 },
    }),
  );

  assert.deepEqual(
    result.changes.map(({ path, category }) => [path, category]),
    [
      ['tokens["color:fills[0]"].collectionName', "token"],
      ['tokens["color:fills[0]"].mode', "token"],
      ['tokens["color:fills[0]"].name', "token"],
      ['tokens["color:fills[0]"].value', "token"],
    ],
  );
});

test("reports a normalized layout edit once when its raw Figma field also changes", () => {
  const layoutSnapshot = (layoutAlign) => {
    const result = snapshot("same-file", "frame", styleIds("same"));
    const node = result.frames[0].nodes[0];
    node.layout = {
      mode: "HORIZONTAL",
      direction: "HORIZONTAL",
      primaryAxisAlign: "MIN",
      counterAxisAlign: "CENTER",
      wrap: false,
      constraints: {
        constraints: null,
        primaryAxisSizingMode: null,
        counterAxisSizingMode: null,
        layoutPositioning: null,
        layoutAlign,
        layoutGrow: null,
        layoutSizingHorizontal: null,
        layoutSizingVertical: null,
        counterAxisAlignContent: null,
        gridRowCount: null,
        gridColumnCount: null,
      },
    };
    node.sourcePayload = { layoutAlign };
    return result;
  };

  const result = compare(layoutSnapshot("INHERIT"), layoutSnapshot("STRETCH"));

  assert.deepEqual(
    result.changes.map(({ path, category }) => [path, category]),
    [["layout.constraints.layoutAlign", "layout"]],
  );
});

test("keeps text and paint changes while ignoring raw variable IDs and text offsets", () => {
  const payloadSnapshot = (variableId, characters, end, red) => {
    const result = snapshot("same-file", "frame", styleIds("same"));
    result.frames[0].nodes[0].sourcePayload = {
      boundVariables: { fills: [{ id: variableId }] },
      textSegments: [{ start: 0, end, characters }],
      fillPaintDetails: [{
        type: "SOLID",
        styleId: `S:${variableId}`,
        boundVariables: { color: { id: variableId } },
        color: { r: red, g: 0, b: 0, a: 1 },
      }],
    };
    return result;
  };

  const result = compare(
    payloadSnapshot("VariableID:old", "Review", 6, 0.2),
    payloadSnapshot("VariableID:new", "Review!", 7, 0.4),
  );

  assert.deepEqual(
    result.changes.map(({ path, category }) => [path, category]),
    [
      ["sourcePayload.fillPaintDetails[0].color.r", "style"],
      ["sourcePayload.textSegments[0].characters", "text"],
    ],
  );
});

function highVolumeSnapshot(revision) {
  const screenCount = 5;
  const nodesPerScreen = 2000;
  return {
    sourceFileId: "high-volume-file",
    frames: Array.from({ length: screenCount }, (_, screenIndex) => {
      const frameId = `frame-${screenIndex}`;
      return {
        sourceFrameId: frameId,
        sourcePageId: "page-1",
        name: `Screen ${screenIndex + 1}`,
        renderAssetKey: `render-${screenIndex}`,
        nodes: Array.from({ length: nodesPerScreen }, (_, nodeIndex) => ({
          sourceNodeId: `${revision}-${frameId}-node-${nodeIndex}`,
          parentSourceNodeId: null,
          sourceFrameId: frameId,
          name: `Layer ${nodeIndex}`,
          type: "RECTANGLE",
          bounds: { x: nodeIndex, y: nodeIndex * 2, width: revision === "after" ? 101 : 100, height: 40 },
          layout: { itemSpacing: revision === "after" ? 9 : 8 },
          fills: [{ color: revision === "after" ? "#22aa88" : "#ff6600" }],
          strokes: [],
          styleReferences: [],
          tokens: [{
            bindingPath: "fills[0]",
            category: "color",
            name: "Action",
            collectionName: "Semantic",
            mode: "Light",
            value: revision === "after" ? "#22aa88" : "#ff6600",
          }],
          sourcePayload: {
            textSegments: [{ characters: revision === "after" ? `Updated ${nodeIndex}` : `Original ${nodeIndex}` }],
          },
        })),
      };
    }),
    assets: Array.from({ length: screenCount }, (_, screenIndex) => ({
      key: `render-${screenIndex}`,
      sha256: `${revision}-${screenIndex}`,
    })),
  };
}

function largeCanvasSnapshot() {
  const frameCount = 210;
  const nodesPerFrame = 150;
  const measurement = (value, sourceProperty) => ({
    value,
    unit: "px",
    provenance: "source",
    sourceProperty,
  });
  const frames = Array.from({ length: frameCount }, (_, frameIndex) => {
    const frameId = `full-page-frame-${frameIndex}`;
    const nodes = Array.from({ length: nodesPerFrame }, (_, nodeIndex) => {
      const isRoot = nodeIndex === 0;
      const isText = nodeIndex === 2;
      return {
        sourceNodeId: isRoot ? frameId : `${frameId}-node-${nodeIndex}`,
        parentSourceNodeId: isRoot ? null : frameId,
        sourceFrameId: frameId,
        name: isRoot ? `Screen ${frameIndex}` : isText ? "Title" : `Layer ${nodeIndex}`,
        type: isRoot ? "FRAME" : isText ? "TEXT" : "RECTANGLE",
        bounds: {
          x: measurement(isRoot ? 0 : nodeIndex * 2, "absoluteBoundingBox.x"),
          y: measurement(isRoot ? 0 : nodeIndex * 3, "absoluteBoundingBox.y"),
          width: measurement(isRoot ? 393 : 100, "absoluteBoundingBox.width"),
          height: measurement(isRoot ? 852 : 40, "absoluteBoundingBox.height"),
        },
        layout: { itemSpacing: measurement(8, "itemSpacing") },
        padding: { left: measurement(12, "paddingLeft") },
        fills: [{ color: "#ffffff" }],
        strokes: [],
        styleReferences: [],
        tokens: [],
        sourcePayload: isText ? { textSegments: [{ characters: "Continue" }] } : {},
      };
    });

    return {
      sourceFrameId: frameId,
      sourcePageId: "full-page",
      name: `Screen ${frameIndex}`,
      renderAssetKey: `render-${frameIndex}`,
      nodes,
    };
  });

  return {
    sourceFileId: "large-figma-file",
    frames,
    assets: frames.map((frame, index) => ({ key: frame.renderAssetKey, sha256: `render-${index}` })),
  };
}

test("preserves 50,000 structured changes across five screens when every layer ID regenerates", () => {
  const result = compare(highVolumeSnapshot("before"), highVolumeSnapshot("after"));
  const categoryCounts = result.changes.reduce((counts, change) => {
    counts[change.category] = (counts[change.category] ?? 0) + 1;
    return counts;
  }, {});
  const changedNodeIds = new Set(result.changes.flatMap((change) => change.sourceNodeId ? [change.sourceNodeId] : []));

  assert.equal(result.frames.length, 5);
  assert.equal(result.frames.filter((frame) => frame.status === "changed").length, 5);
  assert.equal(changedNodeIds.size, 10_000);
  assert.equal(result.changes.length, 50_005);
  assert.deepEqual(categoryCounts, {
    geometry: 10_000,
    layout: 10_000,
    style: 10_000,
    text: 10_000,
    token: 10_000,
    visual: 5,
  });
  assert.equal(result.unmatchedNodeCandidates.length, 0);
});

test("detects precise edits across five of 210 screens in a 31,500-node canvas", () => {
  const before = largeCanvasSnapshot();
  const after = structuredClone(before);

  after.frames[0].nodes[1].bounds.x.value += 3.25;
  after.frames[1].nodes[1].fills[0].color = "#123456";
  after.frames[2].nodes[2].sourcePayload.textSegments[0].characters += " booking";
  after.frames[2].nodes.push({
    ...structuredClone(after.frames[2].nodes[3]),
    sourceNodeId: `${after.frames[2].sourceFrameId}-new-layer`,
    name: "New checkout action",
  });
  after.frames[3].nodes[4].padding.left.value += 4.5;
  after.frames[3].nodes.splice(5, 1);
  after.assets[4].sha256 = "updated-render-4";

  const result = compare(before, after);
  const categories = result.changes.reduce((counts, change) => {
    counts[change.category] = (counts[change.category] ?? 0) + 1;
    return counts;
  }, {});

  assert.equal(before.frames.length, 210);
  assert.equal(before.frames.reduce((count, frame) => count + frame.nodes.length, 0), 31_500);
  assert.equal(result.frames.length, 210);
  assert.equal(result.frames.filter((frame) => frame.status === "changed").length, 5);
  assert.equal(result.frames.filter((frame) => frame.status === "unchanged").length, 205);
  assert.equal(result.changes.length, 7);
  assert.deepEqual(categories, {
    geometry: 1,
    style: 1,
    text: 1,
    structure: 2,
    layout: 1,
    visual: 1,
  });
  assert.ok(result.changes.some((change) => change.path === "bounds.x.value" && change.before === 2 && change.after === 5.25));
  assert.ok(result.changes.some((change) => change.path === "padding.left.value" && change.before === 12 && change.after === 16.5));
  assert.ok(result.changes.some((change) => change.path === "renderAsset"));
  assert.equal(result.unmatchedFrameCandidates.length, 0);
  assert.equal(result.unmatchedNodeCandidates.length, 0);
});

test("bounds a million ambiguous node pairs to ten suggestions per removed layer", () => {
  const before = {
    sourceFileId: "replacement-file",
    frames: [{
      sourceFrameId: "frame",
      sourcePageId: "page-1",
      name: "Screen",
      renderAssetKey: "render",
      nodes: Array.from({ length: 1000 }, (_, index) => ({
        sourceNodeId: `removed-layer-${index}`,
        sourceFrameId: "frame",
        parentSourceNodeId: null,
        name: `Removed layer ${index}`,
        type: "RECTANGLE",
      })),
    }],
    assets: [{ key: "render", sha256: "same" }],
  };
  const after = {
    sourceFileId: "replacement-file",
    frames: [{
      sourceFrameId: "frame",
      sourcePageId: "page-1",
      name: "Screen",
      renderAssetKey: "render",
      nodes: Array.from({ length: 1000 }, (_, index) => ({
        sourceNodeId: `added-layer-${index}`,
        sourceFrameId: "frame",
        parentSourceNodeId: null,
        name: `Added layer ${index}`,
        type: "RECTANGLE",
      })),
    }],
    assets: [{ key: "render", sha256: "same" }],
  };

  const result = compare(before, after);
  assert.equal(result.changes.length, 2000);
  assert.equal(result.unmatchedNodeCandidates.length, 1000);
  const [suggestion] = result.unmatchedNodeCandidates;
  assert.equal(suggestion.afterCandidates.length, 10);
  assert.equal(suggestion.totalCandidates, 1000);
  assert.equal(suggestion.candidatesTruncated, true);
  assert.ok(result.unmatchedNodeCandidates.every((item) =>
    item.afterCandidates.length === 10 && item.totalCandidates === 1000 && item.candidatesTruncated));
});

test("searches unmatched after layers beyond the first ten suggestions", () => {
  const before = regeneratedLayerSnapshot("frame-before", [
    { sourceNodeId: "before-title", name: "Heading", type: "TEXT", x: 24, text: "Review" },
  ]);
  const after = regeneratedLayerSnapshot("frame-after", Array.from({ length: 12 }, (_, index) => ({
    sourceNodeId: `after-title-${index.toString().padStart(2, "0")}`,
    name: "Heading",
    type: "TEXT",
    x: 24,
    text: "Review",
  })));
  const result = compare(before, after, [{ beforeFrameId: "frame-before", afterFrameId: "frame-after" }]);
  const initialCandidates = result.unmatchedNodeCandidates[0].afterCandidates;

  assert.equal(typeof diffService.searchUnmatchedNodeCandidates, "function");
  assert.equal(initialCandidates.some((candidate) => candidate.sourceNodeId === "after-title-11"), false);
  assert.deepEqual(diffService.searchUnmatchedNodeCandidates(result, {
    frameId: "frame-after",
    sourceFileId: "figma-file",
    beforeFrameId: "frame-before",
    beforeNodeId: "before-title",
    query: "after-title-11",
  }), {
    candidates: [{ sourceNodeId: "after-title-11", name: "Heading", type: "TEXT", score: 1 }],
    totalCandidates: 1,
    candidatesTruncated: false,
  });
});

test("ignores Figma canvas movement while retaining screen size changes", () => {
  const frameAt = (x, y, width) => {
    const result = snapshot("same-file", "frame", styleIds("same"));
    const measurement = (value) => ({ value, unit: "px", provenance: "source", sourceProperty: "absoluteBoundingBox" });
    result.frames[0].bounds = {
      x: measurement(x),
      y: measurement(y),
      width: measurement(width),
      height: measurement(640),
    };
    return result;
  };

  const result = compare(frameAt(100, 200, 320), frameAt(900, 500, 400));

  assert.deepEqual(result.changes.map(({ path, before, after }) => [path, before, after]), [
    ["bounds.width.value", 320, 400],
  ]);
});

test("ignores subpixel floating-point noise in captured measurements", () => {
  const withMeasurement = (value) => {
    const result = snapshot("same-file", "frame", styleIds("same"));
    result.frames[0].nodes[0].bounds = {
      x: { value: 0, unit: "px", provenance: "source", sourceProperty: "x" },
      y: { value, unit: "px", provenance: "source", sourceProperty: "y" },
      width: { value: 320, unit: "px", provenance: "source", sourceProperty: "width" },
      height: { value: 56, unit: "px", provenance: "source", sourceProperty: "height" },
    };
    return result;
  };

  const result = compare(withMeasurement(0), withMeasurement(0.00000762939453125));

  assert.deepEqual(result.changes, []);
});
