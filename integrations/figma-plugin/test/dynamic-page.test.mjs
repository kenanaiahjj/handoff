import assert from "node:assert/strict";
import test from "node:test";
import * as captureModule from "../src/capture.ts";
import { captureFigmaCanvas } from "../src/capture.ts";
import { frameRenderCrop } from "../src/render-crop.ts";

function installCaptureFixture({ failHighResolution = false, failPaintRead = false } = {}) {
  let loaded = false;
  const exportSettings = [];
  const png = new Uint8Array(24);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  png.set([0x49, 0x48, 0x44, 0x52], 12);
  new DataView(png.buffer).setUint32(16, 100, false);
  new DataView(png.buffer).setUint32(20, 100, false);

  const page = {
    id: "page-1",
    name: "Capture fixture",
    type: "PAGE",
    async loadAsync() {
      loaded = true;
    },
    get selection() {
      assert.equal(loaded, true, "Figma requires the page to load before reading its selection");
      return [frame];
    },
    get children() {
      assert.equal(loaded, true, "Figma requires the page to load before reading its children");
      return [frame];
    },
  };
  const frame = {
    id: "frame-1",
    type: "FRAME",
    name: "Paywall Membership",
    visible: true,
    absoluteBoundingBox: { x: 10, y: 20, width: 100, height: 100 },
    get fills() {
      if (failPaintRead) throw new Error("Paint data unavailable");
      return [];
    },
    strokes: [],
    children: [],
    parent: page,
    async exportAsync(settings) {
      exportSettings.push(settings);
      if (settings.format === "SVG_STRING") return '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" />';
      if (settings.constraint.value === 2 && failHighResolution) throw new Error("High resolution render unavailable");
      return png;
    },
  };

  globalThis.figma = {
    fileKey: "figma-file-key-123",
    currentPage: page,
    root: { id: "document-1", name: "Capture fixture" },
    variables: {
      async getLocalVariablesAsync() {
        return [];
      },
      async getLocalVariableCollectionsAsync() { return []; },
    },
    mixed: Symbol("mixed"),
  };
  return { page, frame, png, exportSettings, isLoaded: () => loaded };
}

test("reports duplicate captured screen names with counts", () => {
  const findDuplicateFrameNames = captureModule.findDuplicateFrameNames;

  assert.equal(typeof findDuplicateFrameNames, "function");
  if (typeof findDuplicateFrameNames !== "function") return;

  assert.deepEqual(findDuplicateFrameNames([
    { name: "Screen - Wallet - Profile" },
    { name: "Screen - Store - Home" },
    { name: "Screen - Wallet - Profile" },
    { name: "Screen - Wallet - Profile" },
  ]), [{ name: "Screen - Wallet - Profile", count: 3 }]);
});

test("does not report unique captured screen names", () => {
  const findDuplicateFrameNames = captureModule.findDuplicateFrameNames;

  assert.equal(typeof findDuplicateFrameNames, "function");
  if (typeof findDuplicateFrameNames !== "function") return;

  assert.deepEqual(findDuplicateFrameNames([
    { name: "Screen - Wallet - Profile" },
    { name: "Screen - Store - Home" },
  ]), []);
});

test("page capture loads the active page before reading its children", async () => {
  let loaded = false;
  const page = {
    id: "page-1",
    name: "Capture fixture",
    selection: [],
    async loadAsync() {
      loaded = true;
    },
    get children() {
      assert.equal(loaded, true, "Figma requires the page to load before reading children");
      return [];
    },
  };

  globalThis.figma = {
    fileKey: "figma-file-key-123",
    currentPage: page,
    root: { id: "document-1", name: "Capture fixture" },
    variables: {},
    mixed: Symbol("mixed"),
  };

  await assert.rejects(
    captureFigmaCanvas("page", () => {}),
    /This page has no top-level frames, components, or instances to capture\./,
  );
});

test("reports an active-page load failure before reading the selection", async () => {
  let selectionRead = false;
  globalThis.figma = {
    fileKey: "figma-file-key-123",
    currentPage: {
      id: "unavailable-page",
      type: "PAGE",
      async loadAsync() { throw new Error("Page data unavailable"); },
      get selection() { selectionRead = true; return []; },
    },
    root: { id: "document-1", name: "Capture fixture" },
    variables: {},
    mixed: Symbol("mixed"),
  };

  await assert.rejects(
    captureFigmaCanvas("selected", () => {}),
    /Figma could not load the current page for capture\. Page data unavailable/,
  );
  assert.equal(selectionRead, false);
});

test("uses the Figma file key as the snapshot source identity", async () => {
  installCaptureFixture();
  globalThis.figma.fileKey = "figma-file-key-123";

  const result = await captureFigmaCanvas("selected", () => {});

  assert.equal(result.payload.sourceFileId, "figma-file-key-123");
});

test("rejects capture when Figma does not provide a unique file key", async () => {
  installCaptureFixture();
  globalThis.figma.fileKey = undefined;

  await assert.rejects(
    captureFigmaCanvas("selected", () => {}),
    /Figma did not provide a unique file key for this capture/,
  );
});

test("selected capture loads the active page and retries a failed 2x render at 1x", async () => {
  const fixture = installCaptureFixture({ failHighResolution: true });
  const result = await captureFigmaCanvas("selected", () => {});

  assert.equal(fixture.isLoaded(), true);
  assert.equal(result.payload.frames.length, 1);
  assert.equal(result.payload.frames[0].nodes.length, 1);
  assert.deepEqual(result.payload.sourceMetadata.renderScaleFallbackFrameIds, [fixture.frame.id]);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.renders[0].bytes, fixture.png);
  assert.deepEqual(fixture.exportSettings.filter((settings) => settings.format === "PNG").map((settings) => settings.constraint.value), [2, 1]);
  assert.ok(fixture.exportSettings.filter((settings) => settings.format === "PNG").every((settings) => settings.contentsOnly === true));
});

test("captures visible Figma layout grids on the root screen and preserves automatic counts", async () => {
  const fixture = installCaptureFixture();
  fixture.frame.layoutGrids = [
    {
      pattern: "COLUMNS",
      visible: true,
      color: { r: 0.2, g: 0.4, b: 0.8, a: 0.2 },
      alignment: "MIN",
      sectionSize: 72,
      gutterSize: 16,
      offset: 12,
      count: Infinity,
    },
    {
      pattern: "GRID",
      visible: false,
      sectionSize: 8,
      count: 1,
    },
  ];

  const result = await captureFigmaCanvas("selected", () => {});
  const root = result.payload.frames[0].nodes[0];

  assert.equal(root.sourceNodeId, fixture.frame.id);
  assert.deepEqual(root.sourcePayload.layoutGrids, [
    {
      pattern: "COLUMNS",
      visible: true,
      color: { r: 0.2, g: 0.4, b: 0.8, a: 0.2 },
      alignment: "MIN",
      sectionSize: 72,
      gutterSize: 16,
      offset: 12,
      count: "AUTO",
    },
    { pattern: "GRID", visible: false, sectionSize: 8, count: 1 },
  ]);
});

test("captures exact auto-layout padding and wrap spacing with measured child margins", async () => {
  const fixture = installCaptureFixture();
  Object.assign(fixture.frame, {
    layoutMode: "VERTICAL",
    layoutDirection: "VERTICAL",
    layoutWrap: "WRAP",
    paddingTop: 8.5,
    paddingRight: 12,
    paddingBottom: 10.25,
    paddingLeft: 14.75,
    itemSpacing: 6.5,
    counterAxisSpacing: 4.5,
  });
  const child = {
    id: "child-1",
    type: "RECTANGLE",
    name: "Card",
    visible: true,
    absoluteBoundingBox: { x: 24.5, y: 38.25, width: 50.5, height: 41.5 },
    fills: [],
    strokes: [],
    children: [],
    parent: fixture.frame,
    async exportAsync(settings) {
      if (settings.format === "SVG_STRING") return '<svg xmlns="http://www.w3.org/2000/svg" width="50" height="41" />';
      return fixture.png;
    },
  };
  fixture.frame.children = [child];

  const result = await captureFigmaCanvas("selected", () => {});
  const [root, capturedChild] = result.payload.frames[0].nodes;

  assert.deepEqual(root.padding, {
    top: { value: 8.5, unit: "px", provenance: "source", sourceProperty: "paddingTop" },
    right: { value: 12, unit: "px", provenance: "source", sourceProperty: "paddingRight" },
    bottom: { value: 10.25, unit: "px", provenance: "source", sourceProperty: "paddingBottom" },
    left: { value: 14.75, unit: "px", provenance: "source", sourceProperty: "paddingLeft" },
  });
  assert.deepEqual(root.spacing, {
    rowGap: { value: 6.5, unit: "px", provenance: "source", sourceProperty: "itemSpacing" },
    columnGap: { value: 4.5, unit: "px", provenance: "source", sourceProperty: "counterAxisSpacing" },
    itemGap: { value: 6.5, unit: "px", provenance: "source", sourceProperty: "itemSpacing" },
  });
  assert.deepEqual(capturedChild.bounds, {
    x: { value: 14.5, unit: "px", provenance: "measured", sourceProperty: "absoluteBoundingBox.x - frame.absoluteBoundingBox.x" },
    y: { value: 18.25, unit: "px", provenance: "measured", sourceProperty: "absoluteBoundingBox.y - frame.absoluteBoundingBox.y" },
    width: { value: 50.5, unit: "px", provenance: "source", sourceProperty: "absoluteBoundingBox.width" },
    height: { value: 41.5, unit: "px", provenance: "source", sourceProperty: "absoluteBoundingBox.height" },
  });
  assert.deepEqual(capturedChild.margins, {
    top: { value: 18.25, unit: "px", provenance: "measured", sourceProperty: "absoluteBoundingBox.y - parent.absoluteBoundingBox.y" },
    right: { value: 35, unit: "px", provenance: "measured", sourceProperty: "parent.absoluteBoundingBox.right - absoluteBoundingBox.right" },
    bottom: { value: 40.25, unit: "px", provenance: "measured", sourceProperty: "parent.absoluteBoundingBox.bottom - absoluteBoundingBox.bottom" },
    left: { value: 14.5, unit: "px", provenance: "measured", sourceProperty: "absoluteBoundingBox.x - parent.absoluteBoundingBox.x" },
  });
});

test("captures grid counts, tracks, gaps, and child placement from Figma source fields", async () => {
  const fixture = installCaptureFixture();
  Object.assign(fixture.frame, {
    layoutMode: "GRID",
    gridRowCount: 2,
    gridColumnCount: 3,
    gridRowGap: 11.5,
    gridColumnGap: 8.5,
    gridRowSizes: [
      { type: "FIXED", value: 120 },
      { type: "FLEX", value: 1 },
    ],
    gridColumnSizes: [
      { type: "FLEX", value: 1 },
      { type: "FIXED", value: 240 },
      { type: "FLEX", value: 2 },
    ],
  });
  const child = {
    id: "grid-child-1",
    type: "RECTANGLE",
    name: "Grid card",
    visible: true,
    absoluteBoundingBox: { x: 20, y: 30, width: 40, height: 50 },
    gridRowAnchorIndex: 1,
    gridColumnAnchorIndex: 2,
    gridRowSpan: 1,
    gridColumnSpan: 1,
    gridChildHorizontalAlign: "CENTER",
    gridChildVerticalAlign: "MIN",
    fills: [],
    strokes: [],
    children: [],
    parent: fixture.frame,
    async exportAsync(settings) {
      if (settings.format === "SVG_STRING") return '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="50" />';
      return fixture.png;
    },
  };
  fixture.frame.children = [child];

  const result = await captureFigmaCanvas("selected", () => {});
  const [grid, capturedChild] = result.payload.frames[0].nodes;

  assert.equal(grid.layout.mode, "GRID");
  assert.equal(grid.layout.constraints.gridRowCount, 2);
  assert.equal(grid.layout.constraints.gridColumnCount, 3);
  assert.deepEqual(grid.spacing.rowGap, { value: 11.5, unit: "px", provenance: "source", sourceProperty: "gridRowGap" });
  assert.deepEqual(grid.spacing.columnGap, { value: 8.5, unit: "px", provenance: "source", sourceProperty: "gridColumnGap" });
  assert.deepEqual(grid.sourcePayload.gridRowSizes, [
    { type: "FIXED", value: 120 },
    { type: "FLEX", value: 1 },
  ]);
  assert.deepEqual(grid.sourcePayload.gridColumnSizes, [
    { type: "FLEX", value: 1 },
    { type: "FIXED", value: 240 },
    { type: "FLEX", value: 2 },
  ]);
  assert.equal(capturedChild.sourcePayload.gridRowAnchorIndex, 1);
  assert.equal(capturedChild.sourcePayload.gridColumnAnchorIndex, 2);
  assert.equal(capturedChild.sourcePayload.gridRowSpan, 1);
  assert.equal(capturedChild.sourcePayload.gridColumnSpan, 1);
  assert.equal(capturedChild.sourcePayload.gridChildHorizontalAlign, "CENTER");
  assert.equal(capturedChild.sourcePayload.gridChildVerticalAlign, "MIN");
});

test("preserves out-of-frame Figma render bounds for exact canvas placement", async () => {
  const fixture = installCaptureFixture();
  fixture.frame.absoluteRenderBounds = { x: 5, y: 10, width: 150, height: 125 };

  const result = await captureFigmaCanvas("selected", () => {});

  assert.deepEqual(result.renders[0].renderBounds, fixture.frame.absoluteRenderBounds);
  assert.equal(result.payload.canvasBounds.x.value, 5);
  assert.equal(result.payload.canvasBounds.y.value, 10);
  assert.equal(result.payload.canvasBounds.width.value, 150);
  assert.equal(result.payload.canvasBounds.height.value, 125);
});

test("does not report a Figma section's canvas placement as frame margins", async () => {
  const fixture = installCaptureFixture();
  fixture.frame.parent = {
    id: "section-1",
    type: "SECTION",
    absoluteBoundingBox: { x: -3500, y: -3500, width: 4000, height: 4000 },
  };

  const result = await captureFigmaCanvas("selected", () => {});
  const frameNode = result.payload.frames[0].nodes[0];

  assert.equal(frameNode.margins.top.provenance, "unavailable");
  assert.equal(frameNode.margins.right.provenance, "unavailable");
  assert.equal(frameNode.margins.bottom.provenance, "unavailable");
  assert.equal(frameNode.margins.left.provenance, "unavailable");
});

test("retries a malformed 2x Figma PNG at 1x", async () => {
  const fixture = installCaptureFixture();
  const originalExport = fixture.frame.exportAsync.bind(fixture.frame);
  fixture.frame.exportAsync = async (settings) => {
    if (settings.format === "PNG" && settings.constraint.value === 2) return new Uint8Array(24);
    return originalExport(settings);
  };

  const result = await captureFigmaCanvas("selected", () => {});

  assert.deepEqual(result.payload.sourceMetadata.renderScaleFallbackFrameIds, [fixture.frame.id]);
  assert.equal(result.payload.frames[0].nodes[0].sourceNodeId, fixture.frame.id);
  assert.deepEqual(fixture.exportSettings.filter((settings) => settings.format === "PNG").map((settings) => settings.constraint.value), [1]);
});

test("fails clearly when Figma cannot render at either scale", async () => {
  const fixture = installCaptureFixture();
  fixture.frame.exportAsync = async (settings) => {
    if (settings.format === "PNG") throw new Error(`Export ${settings.constraint.value} failed`);
    return '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" />';
  };

  await assert.rejects(
    captureFigmaCanvas("selected", () => {}),
    /Figma could not render “Paywall Membership” at 2× or 1×/,
  );
});

test("warns when a bound variable cannot be resolved without dropping the capture", async () => {
  const fixture = installCaptureFixture();
  fixture.frame.boundVariables = { fills: [{ type: "VARIABLE_ALIAS", id: "variable-missing" }] };
  globalThis.figma.variables.getVariableByIdAsync = async () => { throw new Error("Variable service unavailable"); };
  const result = await captureFigmaCanvas("selected", () => {});

  assert.equal(result.renders.length, 1);
  assert.equal(result.payload.frames[0].nodes.length, 1);
  assert.match(result.warnings[0], /1 Figma variable binding could not be resolved/);
  assert.deepEqual(result.payload.sourceMetadata.captureWarnings, result.warnings);
});

test("one unreadable property keeps the layer identity, geometry, and hierarchy", async () => {
  installCaptureFixture({ failPaintRead: true });
  const result = await captureFigmaCanvas("selected", () => {});
  const capturedLayer = result.payload.frames[0].nodes[0];

  assert.equal(result.renders.length, 1);
  assert.equal(capturedLayer.sourceNodeId, "frame-1");
  assert.equal(capturedLayer.name, "Paywall Membership");
  assert.equal(capturedLayer.bounds.width.value, 100);
  assert.equal(capturedLayer.sourcePayload.captureWarning, "Figma did not expose every property for this layer.");
  assert.match(result.warnings[0], /some Figma properties were unavailable/);
});

test("captures deep page and layer trees without recursive stack growth", async () => {
  const fixture = installCaptureFixture();
  const appendChain = (parent, depth, prefix) => {
    let current = parent;
    for (let index = 0; index < depth; index += 1) {
      const child = {
        id: `${prefix}-${index}`,
        type: "GROUP",
        name: `Group ${index}`,
        visible: true,
        children: [],
        parent: current,
      };
      current.children.push(child);
      current = child;
    }
    return current;
  };

  const pageRoot = { id: "page-wrapper", type: "GROUP", name: "Page wrapper", children: [], parent: fixture.page };
  const pageLeaf = appendChain(pageRoot, 7_000, "page-group");
  pageLeaf.children.push(fixture.frame);
  fixture.frame.parent = pageLeaf;
  Object.defineProperty(fixture.page, "children", {
    get() {
      assert.equal(fixture.isLoaded(), true, "Figma requires the page to load before reading children");
      return [pageRoot];
    },
  });

  appendChain(fixture.frame, 7_000, "frame-group");
  const result = await captureFigmaCanvas("page", () => {});

  assert.equal(result.payload.frames.length, 1);
  assert.equal(result.payload.frames[0].nodes.length, 7_001);
  assert.equal(result.payload.frames[0].nodes.at(-1).name, "Group 6999");
});

test("captures a frame with more than 20,000 layers when it fits the snapshot budget", async () => {
  const fixture = installCaptureFixture();
  let childPropertyReads = 0;
  fixture.frame.children = Array.from({ length: 20_100 }, (_, index) => {
    const child = {
      id: `layer-${index}`,
      type: "RECTANGLE",
      name: `Layer ${index}`,
      visible: true,
      parent: fixture.frame,
    };
    Object.defineProperty(child, "children", {
      get() {
        childPropertyReads += 1;
        return [];
      },
    });
    return child;
  });

  const result = await captureFigmaCanvas("selected", () => {});

  assert.equal(result.payload.frames[0].nodes.length, 20_101);
  assert.equal(childPropertyReads, 20_100);
});

test("resolves only the variables used by the captured layers", async () => {
  const fixture = installCaptureFixture();
  let allVariablesRead = 0;
  let allCollectionsRead = 0;
  const variableLookups = [];
  const collectionLookups = [];
  fixture.frame.boundVariables = {
    fills: [{ type: "VARIABLE_ALIAS", id: "variable-used" }],
  };
  globalThis.figma.variables.getLocalVariablesAsync = async () => {
    allVariablesRead += 1;
    return [];
  };
  globalThis.figma.variables.getLocalVariableCollectionsAsync = async () => {
    allCollectionsRead += 1;
    return [];
  };
  globalThis.figma.variables.getVariableByIdAsync = async (id) => {
    variableLookups.push(id);
    return {
      id,
      name: "color/surface",
      resolvedType: "COLOR",
      variableCollectionId: "collection-used",
      valuesByMode: { "mode-1": { r: 1, g: 1, b: 1 } },
      resolveForConsumer: () => ({ value: { r: 1, g: 1, b: 1 } }),
    };
  };
  globalThis.figma.variables.getVariableCollectionByIdAsync = async (id) => {
    collectionLookups.push(id);
    return {
      id,
      name: "Tripket",
      defaultModeId: "mode-1",
      modes: [{ modeId: "mode-1", name: "Light" }],
    };
  };

  const result = await captureFigmaCanvas("selected", () => {});

  assert.equal(allVariablesRead, 0);
  assert.equal(allCollectionsRead, 0);
  assert.deepEqual(variableLookups, ["variable-used"]);
  assert.deepEqual(collectionLookups, ["collection-used"]);
  assert.equal(result.payload.frames[0].nodes[0].tokens[0].name, "color/surface");
});

test("releases one frame's capture tree before traversing the next frame", async () => {
  const fixture = installCaptureFixture();
  const variableLookups = [];
  const events = [];
  fixture.frame.boundVariables = {
    fills: [{ type: "VARIABLE_ALIAS", id: "variable-first-frame" }],
  };
  const secondFrame = {
    ...fixture.frame,
    id: "frame-2",
    name: "Second frame",
    absoluteBoundingBox: { x: 140, y: 20, width: 100, height: 100 },
    parent: fixture.page,
  };
  secondFrame.boundVariables = {
    fills: [{ type: "VARIABLE_ALIAS", id: "variable-second-frame" }],
  };
  Object.defineProperty(secondFrame, "children", {
    get() {
      events.push("traverse-second-frame");
      assert.ok(
        variableLookups.includes("variable-first-frame"),
        "the first frame's metadata should be resolved before traversing the next frame",
      );
      return [];
    },
  });
  Object.defineProperty(fixture.page, "children", {
    get() {
      assert.equal(fixture.isLoaded(), true);
      return [fixture.frame, secondFrame];
    },
  });
  globalThis.figma.variables.getVariableByIdAsync = async (id) => {
    variableLookups.push(id);
    events.push(`lookup-${id}`);
    return {
      id,
      name: id,
      resolvedType: "COLOR",
      variableCollectionId: "",
      valuesByMode: {},
      resolveForConsumer: () => ({ value: { r: 1, g: 1, b: 1 } }),
    };
  };

  const result = await captureFigmaCanvas("page", () => {});

  assert.deepEqual(result.payload.frames.map((captured) => captured.sourceFrameId), ["frame-1", "frame-2"]);
  assert.deepEqual(variableLookups, ["variable-first-frame", "variable-second-frame"]);
  assert.deepEqual(events.slice(0, 2), ["lookup-variable-first-frame", "traverse-second-frame"]);
});

test("bounds concurrent style lookups for large frames", async () => {
  const fixture = installCaptureFixture();
  let activeLookups = 0;
  let peakLookups = 0;
  let lookupCount = 0;
  globalThis.figma.getStyleByIdAsync = async () => {
    activeLookups += 1;
    peakLookups = Math.max(peakLookups, activeLookups);
    await new Promise((resolve) => setTimeout(resolve, 0));
    activeLookups -= 1;
    lookupCount += 1;
    return null;
  };
  fixture.frame.children = Array.from({ length: 120 }, (_, index) => ({
    id: `styled-layer-${index}`,
    type: "RECTANGLE",
    name: `Styled layer ${index}`,
    visible: true,
    fillStyleId: `style-${index}`,
    children: [],
    parent: fixture.frame,
  }));

  const result = await captureFigmaCanvas("selected", () => {});

  assert.equal(result.payload.frames[0].nodes.length, 121);
  assert.equal(lookupCount, 120);
  assert.ok(peakLookups <= 50, `expected at most 50 concurrent lookups, saw ${peakLookups}`);
});

test("captures frame, component, instance, and component-set roots from a page", async () => {
  const fixture = installCaptureFixture();
  const roots = ["FRAME", "COMPONENT", "INSTANCE", "COMPONENT_SET"].map((type, index) => ({
    ...fixture.frame,
    id: `root-${index}`,
    type,
    name: `${type} root`,
    absoluteBoundingBox: { x: index * 120, y: 0, width: 100, height: 100 },
    children: [],
    parent: fixture.page,
  }));
  Object.defineProperty(fixture.page, "children", {
    get() {
      assert.equal(fixture.isLoaded(), true, "Figma requires the page to load before reading children");
      return roots;
    },
  });

  const result = await captureFigmaCanvas("page", () => {});

  assert.deepEqual(result.payload.frames.map((frame) => frame.sourceFrameId), ["root-0", "root-1", "root-2", "root-3"]);
  assert.deepEqual(result.renders.map((render) => render.key), result.payload.frames.map((frame) => frame.renderAssetKey));
});

test("renders page frames with bounded concurrency while preserving their order", async () => {
  const fixture = installCaptureFixture();
  let activeExports = 0;
  let peakExports = 0;
  const roots = Array.from({ length: 6 }, (_, index) => ({
    ...fixture.frame,
    id: `frame-${index + 1}`,
    name: `Frame ${index + 1}`,
    absoluteBoundingBox: { x: index * 120, y: 20, width: 100, height: 100 },
    children: [],
    parent: fixture.page,
    async exportAsync(settings) {
      activeExports += 1;
      peakExports = Math.max(peakExports, activeExports);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeExports -= 1;
      if (settings.format === "SVG_STRING") return '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" />';
      return fixture.png;
    },
  }));
  Object.defineProperty(fixture.page, "children", { get: () => roots });

  const result = await captureFigmaCanvas("page", () => {});

  assert.ok(peakExports > 1, `expected concurrent frame exports, saw a peak of ${peakExports}`);
  assert.ok(peakExports <= 2, `expected no more than 2 concurrent frame exports, saw ${peakExports}`);
  assert.deepEqual(result.payload.frames.map((frame) => frame.sourceFrameId), roots.map((frame) => frame.id));
});

test("captures the containing frame when a child layer is selected", async () => {
  const fixture = installCaptureFixture();
  const child = {
    id: "selected-child",
    type: "RECTANGLE",
    name: "Selected child",
    visible: true,
    children: [],
    parent: fixture.frame,
  };
  fixture.frame.children = [child];
  Object.defineProperty(fixture.page, "selection", { get: () => [child] });

  const result = await captureFigmaCanvas("selected", () => {});

  assert.equal(result.payload.frames.length, 1);
  assert.equal(result.payload.frames[0].sourceFrameId, fixture.frame.id);
  assert.equal(result.payload.frames[0].nodes[1].sourceNodeId, child.id);
  assert.equal(result.payload.frames[0].nodes[1].parentSourceNodeId, fixture.frame.id);
});

test("retains downloadable SVG and PNG assets for selected vector and image layers", async () => {
  const fixture = installCaptureFixture();
  const vector = {
    id: "vector-layer",
    type: "VECTOR",
    name: "Passenger icon",
    visible: true,
    absoluteBoundingBox: { x: 20, y: 30, width: 18, height: 18 },
    fills: [],
    strokes: [],
    children: [],
    parent: fixture.frame,
    async exportAsync(settings) {
      assert.equal(settings.format, "SVG_STRING");
      return '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18"><path d="M0 0h18v18H0z" /></svg>';
    },
  };
  const image = {
    id: "image-layer",
    type: "RECTANGLE",
    name: "Hero image",
    visible: true,
    absoluteBoundingBox: { x: 30, y: 40, width: 100, height: 60 },
    fills: [{ type: "IMAGE", imageHash: "image-hash" }],
    strokes: [],
    children: [],
    parent: fixture.frame,
    async exportAsync(settings) {
      assert.equal(settings.format, "PNG");
      return fixture.png;
    },
  };
  fixture.frame.children = [vector, image];

  const result = await captureFigmaCanvas("selected", () => {});
  const vectorAsset = result.layerRenders.find((asset) => asset.sourceNodeId === vector.id);
  const imageAsset = result.layerRenders.find((asset) => asset.sourceNodeId === image.id);
  const nodes = new Map(result.payload.frames[0].nodes.map((node) => [node.sourceNodeId, node]));

  assert.equal(vectorAsset?.contentType, "image/svg+xml");
  assert.equal(imageAsset?.contentType, "image/png");
  assert.equal(nodes.get(vector.id)?.sourcePayload.layerExportAssetKey, vectorAsset?.key);
  assert.equal(nodes.get(image.id)?.sourcePayload.layerExportAssetKey, imageAsset?.key);
});

test("keeps the frame capture when an individual layer export fails", async () => {
  const fixture = installCaptureFixture();
  fixture.frame.children = [{
    id: "unavailable-vector",
    type: "VECTOR",
    name: "Unavailable icon",
    visible: true,
    absoluteBoundingBox: { x: 20, y: 30, width: 18, height: 18 },
    fills: [],
    strokes: [],
    children: [],
    parent: fixture.frame,
    async exportAsync() { throw new Error("Layer export unavailable"); },
  }];

  const result = await captureFigmaCanvas("selected", () => {});

  assert.equal(result.renders.length, 1);
  assert.equal(result.payload.frames[0].nodes.length, 2);
  assert.equal(result.layerRenders.length, 0);
  assert.match(result.warnings.join(" "), /individual layer export was unavailable/);
});

test("uses 2x renders for multiple small frames even when their combined area is large", async () => {
  const fixture = installCaptureFixture();
  const roots = [0, 1].map((index) => ({
    ...fixture.frame,
    id: `small-frame-${index}`,
    name: `Small frame ${index}`,
    absoluteBoundingBox: { x: index * 1_500, y: 0, width: 1_400, height: 1_200 },
    children: [],
    parent: fixture.page,
  }));
  Object.defineProperty(fixture.page, "children", { get: () => roots });

  const result = await captureFigmaCanvas("page", () => {});
  const pngScales = fixture.exportSettings
    .filter((settings) => settings.format === "PNG")
    .map((settings) => settings.constraint.value);

  assert.deepEqual(pngScales, [2, 2]);
  assert.deepEqual(result.payload.sourceMetadata.renderScaleFallbackFrameIds, []);
});

test("captures five top-level frames in page order without changing the Figma selection", async () => {
  const fixture = installCaptureFixture();
  await fixture.page.loadAsync();
  const originalSelection = fixture.page.selection;
  const roots = Array.from({ length: 5 }, (_, index) => ({
    ...fixture.frame,
    id: `flow-frame-${index + 1}`,
    name: `Flow screen ${index + 1}`,
    absoluteBoundingBox: {
      x: 10 + index * 120,
      y: 20 + (index % 2) * 140,
      width: 100,
      height: 100,
    },
    children: [],
    parent: fixture.page,
  }));
  Object.defineProperty(fixture.page, "children", { get: () => roots });

  const result = await captureFigmaCanvas("page", () => {});

  assert.deepEqual(result.payload.frames.map((frame) => frame.sourceFrameId), roots.map((root) => root.id));
  assert.deepEqual(result.payload.frames.map((frame) => frame.name), roots.map((root) => root.name));
  assert.equal(new Set(result.payload.frames.map((frame) => frame.renderAssetKey)).size, 5);
  assert.deepEqual(result.renders.map((render) => render.key), result.payload.frames.map((frame) => frame.renderAssetKey));
  assert.deepEqual(
    result.renders.map((render) => [render.sourceX, render.sourceY, render.sourceWidth, render.sourceHeight]),
    roots.map((root) => [root.absoluteBoundingBox.x, root.absoluteBoundingBox.y, 100, 100]),
  );
  assert.deepEqual(
    [result.payload.canvasBounds.x.value, result.payload.canvasBounds.y.value, result.payload.canvasBounds.width.value, result.payload.canvasBounds.height.value],
    [10, 20, 580, 240],
  );
  assert.deepEqual(fixture.page.selection, originalSelection);
});

test("rejects an oversized layer payload before exporting frame images", async () => {
  const fixture = installCaptureFixture();
  let encodedLargeStructuredPayload = false;
  const originalEncodeURIComponent = globalThis.encodeURIComponent;
  globalThis.encodeURIComponent = (value) => {
    if (value.length > 1024 * 1024) encodedLargeStructuredPayload = true;
    return originalEncodeURIComponent(value);
  };
  let exportCount = 0;
  const originalExport = fixture.frame.exportAsync.bind(fixture.frame);
  fixture.frame.exportAsync = async (settings) => {
    exportCount += 1;
    return originalExport(settings);
  };
  fixture.frame.children = [{
    id: "large-text",
    type: "TEXT",
    name: "Large text layer",
    visible: true,
    characters: "x".repeat(129 * 1024 * 1024),
    getStyledTextSegments() { return []; },
    parent: fixture.frame,
  }];

  try {
    await assert.rejects(
      captureFigmaCanvas("selected", () => {}),
      /structured layer data is .* above Handoff’s 128 MiB limit/,
    );
  } finally {
    globalThis.encodeURIComponent = originalEncodeURIComponent;
  }
  assert.equal(encodedLargeStructuredPayload, false, "the capture must enforce its JSON budget without allocating a huge UTF-8 copy");
  assert.equal(exportCount, 0);
});

test("captures structured layer data larger than the former 64 MiB ceiling", async () => {
  const fixture = installCaptureFixture();
  const characters = "x".repeat(65 * 1024 * 1024);
  fixture.frame.children = [{
    id: "large-text",
    type: "TEXT",
    name: "Large text layer",
    visible: true,
    characters,
    getStyledTextSegments() { return []; },
    parent: fixture.frame,
  }];

  const result = await captureFigmaCanvas("selected", () => {});

  assert.equal(result.payload.frames[0].nodes[1].typography.content.length, characters.length);
  assert.equal(result.renders.length, 1);
});

test("captures every frame on a page when the canvas contains more than 120 frames", async () => {
  const fixture = installCaptureFixture();
  const frames = Array.from({ length: 200 }, (_, index) => ({
    ...fixture.frame,
    id: `page-frame-${index}`,
    name: `Page frame ${index}`,
    parent: fixture.page,
  }));
  Object.defineProperty(fixture.page, "children", {
    get: () => frames,
  });

  const result = await captureFigmaCanvas("page", () => {});

  assert.equal(result.payload.frames.length, 200);
});

test("captures frames from every page in the Figma file", async () => {
  const fixture = installCaptureFixture();
  let loadedPageCount = 0;
  const pages = Array.from({ length: 3 }, (_, pageIndex) => {
    let loaded = false;
    const page = {
      id: `file-page-${pageIndex}`,
      name: `File page ${pageIndex + 1}`,
      type: "PAGE",
      async loadAsync() {
        loaded = true;
        loadedPageCount += 1;
      },
      get children() {
        assert.equal(loaded, true, `page ${pageIndex + 1} must load before its children are read`);
        return Array.from({ length: pageIndex === 0 ? 101 : 50 }, (_, frameIndex) => ({
          ...fixture.frame,
          id: `file-frame-${pageIndex}-${frameIndex}`,
          name: `File frame ${pageIndex}-${frameIndex}`,
          absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
          ...(pageIndex === 1 && frameIndex === 0
            ? { absoluteRenderBounds: { x: -10, y: -20, width: 125, height: 130 } }
            : {}),
          children: [],
          parent: page,
        }));
      },
    };
    return page;
  });
  globalThis.figma.root.children = pages;
  globalThis.figma.currentPage = pages[0];

  const result = await captureFigmaCanvas("file", () => {});

  assert.equal(loadedPageCount, 3);
  assert.equal(result.payload.frames.length, 201);
  assert.ok(result.renders.length + result.vectorRenders.length + 1 > 300, "full-file assets can exceed the former server count limit");
  assert.deepEqual(
    [...new Set(result.payload.frames.map((frame) => frame.sourcePageId))].sort(),
    ["file-page-0", "file-page-1", "file-page-2"],
  );
  assert.equal(result.payload.sourceMetadata.captureScope, "all top-level frames and components across all pages");
  assert.equal(result.payload.sourceMetadata.sourcePageId, null);
  assert.equal(result.payload.sourceMetadata.pageLayout.length, 3);
  assert.notDeepEqual(
    [result.payload.sourceMetadata.pageLayout[0].offsetX, result.payload.sourceMetadata.pageLayout[0].offsetY],
    [result.payload.sourceMetadata.pageLayout[1].offsetX, result.payload.sourceMetadata.pageLayout[1].offsetY],
  );
  const secondPageFrame = result.payload.frames.find((frame) => frame.sourcePageId === "file-page-1");
  const secondPageRender = result.renders.find((render) => render.key === secondPageFrame.renderAssetKey);
  const secondPageLayout = result.payload.sourceMetadata.pageLayout.find((page) => page.sourcePageId === "file-page-1");
  assert.equal(secondPageRender.sourceX, secondPageFrame.bounds.x.value + secondPageLayout.offsetX);
  assert.equal(secondPageRender.sourceY, secondPageFrame.bounds.y.value + secondPageLayout.offsetY);
  assert.deepEqual(secondPageRender.renderBounds, {
    x: 340,
    y: 0,
    width: 125,
    height: 130,
  });
  assert.deepEqual(
    frameRenderCrop(
      { x: secondPageRender.sourceX, y: secondPageRender.sourceY, width: secondPageRender.sourceWidth, height: secondPageRender.sourceHeight },
      secondPageRender.renderBounds,
      250,
      260,
    ),
    { x: 20, y: 40, width: 200, height: 200 },
  );
});

test("reads text style segments once and preserves the captured typography", async () => {
  const fixture = installCaptureFixture();
  let segmentReadCount = 0;
  const text = {
    id: "text-1",
    type: "TEXT",
    name: "Headline",
    visible: true,
    characters: "A clear heading",
    fontName: { family: "Inter", style: "Medium" },
    fontSize: 24,
    fontWeight: 500,
    lineHeight: { unit: "PIXELS", value: 28 },
    letterSpacing: { unit: "PIXELS", value: 0 },
    textAlignHorizontal: "LEFT",
    children: [],
    parent: fixture.frame,
    getStyledTextSegments() {
      segmentReadCount += 1;
      return [{ start: 0, end: 15, boundVariables: null, fontName: { family: "Inter", style: "Medium" } }];
    },
  };
  fixture.frame.children = [text];

  const result = await captureFigmaCanvas("selected", () => {});

  assert.equal(segmentReadCount, 1);
  assert.equal(result.payload.frames[0].nodes[1].typography.fontFamily, "Inter");
  assert.equal(result.payload.frames[0].nodes[1].typography.fontSize.value, 24);
  assert.equal(result.payload.frames[0].nodes[1].typography.content, "A clear heading");
});
