import assert from "node:assert/strict";
import test from "node:test";
import { captureFigmaCanvas } from "../src/capture.ts";

function installCaptureFixture({ failHighResolution = false, failVariableLookup = false, failPaintRead = false } = {}) {
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
        if (failVariableLookup) throw new Error("Variable service unavailable");
        return [];
      },
      async getLocalVariableCollectionsAsync() { return []; },
    },
    mixed: Symbol("mixed"),
  };
  return { page, frame, png, exportSettings, isLoaded: () => loaded };
}

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

test("variable lookup failures warn without dropping the Figma render or layer tree", async () => {
  installCaptureFixture({ failVariableLookup: true });
  const result = await captureFigmaCanvas("selected", () => {});

  assert.equal(result.renders.length, 1);
  assert.equal(result.payload.frames[0].nodes.length, 1);
  assert.match(result.warnings[0], /Variable and style lookups were unavailable/);
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

test("stops walking a frame as soon as its layer budget is exceeded", async () => {
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

  await assert.rejects(
    captureFigmaCanvas("selected", () => {}),
    /more than 20,000 layers/,
  );
  assert.ok(childPropertyReads < 20_000, `expected an early stop, read children on ${childPropertyReads} layers`);
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
    characters: "x".repeat(17 * 1024 * 1024),
    getStyledTextSegments() { return []; },
    parent: fixture.frame,
  }];

  await assert.rejects(
    captureFigmaCanvas("selected", () => {}),
    /structured layer data exceeds Handoff’s 16 MiB limit/,
  );
  assert.equal(exportCount, 0);
});

test("stops page discovery after the supported frame limit", async () => {
  const fixture = installCaptureFixture();
  let walkedFrameCount = 0;
  const frames = Array.from({ length: 200 }, (_, index) => ({
    ...fixture.frame,
    id: `page-frame-${index}`,
    name: `Page frame ${index}`,
    parent: fixture.page,
  }));
  for (const frame of frames) {
    Object.defineProperty(frame, "type", {
      get() {
        walkedFrameCount += 1;
        return "FRAME";
      },
    });
  }
  Object.defineProperty(fixture.page, "children", {
    get: () => frames,
  });

  await assert.rejects(
    captureFigmaCanvas("page", () => {}),
    /more than 120 frames/,
  );
  assert.equal(walkedFrameCount, 121);
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
