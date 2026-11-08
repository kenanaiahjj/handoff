import assert from "node:assert/strict";
import test from "node:test";
import { diffSnapshots } from "./diff.ts";

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

function compare(before, after, frameMatches) {
  return diffSnapshots(
    { versionId: "before", snapshot: before },
    { versionId: "after", snapshot: after },
    { frameMatches },
  );
}

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
  assert.deepEqual(result.frames.map((frame) => frame.status).sort(), ["added", "removed"]);
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

function tokenSnapshot(token) {
  const result = snapshot("same-file", "frame", styleIds("same"));
  result.frames[0].nodes[0].tokens = [token];
  return result;
}

test("ignores Figma variable ID churn when a token binding keeps the same meaning", () => {
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

  assert.deepEqual(result.changes, []);
});

test("reports semantic token edits under the stable property binding", () => {
  const result = compare(
    tokenSnapshot({
      sourceId: "VariableID:old",
      bindingPath: "fills[0]",
      category: "color",
      name: "text/primary",
      collectionId: "Collection:old",
      collectionName: "Semantic Colors",
      mode: "Light",
      value: "#222222",
    }),
    tokenSnapshot({
      sourceId: "VariableID:new",
      bindingPath: "fills[0]",
      category: "color",
      name: "text/placeholder",
      collectionId: "Collection:new",
      collectionName: "Semantic Colors",
      mode: "Light",
      value: "#8e8e93",
    }),
  );

  assert.deepEqual(
    result.changes.map(({ path, category }) => [path, category]),
    [
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
