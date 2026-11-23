import assert from "node:assert/strict";
import test from "node:test";
import { captureFigmaCanvas, outermostSelectedSections, sectionFillHex } from "../src/capture.ts";
import { filterCaptureToFrameIds } from "../src/capture-selection.ts";

function png() {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  new DataView(bytes.buffer).setUint32(16, 100, false);
  new DataView(bytes.buffer).setUint32(20, 100, false);
  return bytes;
}

function frameNode(id, x, parent) {
  const node = {
    id,
    type: "FRAME",
    name: id,
    visible: true,
    absoluteBoundingBox: { x, y: 100, width: 100, height: 100 },
    fills: [],
    strokes: [],
    children: [],
    parent,
    async exportAsync(settings) {
      if (settings.format === "SVG_STRING") return '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" />';
      return png();
    },
  };
  parent.children.push(node);
  return node;
}

function sectionNode(id, bounds, parent, fills = [{ type: "SOLID", visible: true, opacity: 1, color: { r: 1, g: 1, b: 1 } }]) {
  const node = { id, type: "SECTION", name: id, visible: true, absoluteBoundingBox: bounds, fills, children: [], parent };
  parent.children.push(node);
  return node;
}

/** A page with an "Onboarding" section (two frames and a nested section with one), and a loose frame. */
function installSectionFixture(selectionIds) {
  const page = { id: "page-1", name: "Flows", type: "PAGE", children: [], async loadAsync() {} };
  const onboarding = sectionNode("Onboarding", { x: 0, y: 0, width: 800, height: 300 }, page);
  frameNode("welcome", 20, onboarding);
  frameNode("permissions", 140, onboarding);
  const nested = sectionNode("Variants", { x: 300, y: 50, width: 300, height: 200 }, onboarding, []);
  frameNode("permissions-denied", 320, nested);
  frameNode("loose", 1000, page);
  const byId = new Map();
  const walk = (node) => { byId.set(node.id, node); for (const child of node.children ?? []) walk(child); };
  walk(page);
  page.selection = selectionIds.map((id) => byId.get(id));
  globalThis.figma = {
    fileKey: "figma-file-key-123",
    currentPage: page,
    root: { id: "document-1", name: "Section fixture", children: [page] },
    variables: {},
    mixed: Symbol("mixed"),
  };
  return { page, byId };
}

test("selecting a section captures every top-level frame inside it and records the section", async () => {
  installSectionFixture(["Onboarding"]);
  const result = await captureFigmaCanvas("selected", () => {});

  assert.deepEqual(result.payload.frames.map((frame) => frame.sourceFrameId), ["welcome", "permissions", "permissions-denied"]);
  assert.equal(result.payload.sourceMetadata.captureScope, "selected sections");
  assert.deepEqual(result.payload.sourceMetadata.sections, [{
    sourceSectionId: "Onboarding",
    sourcePageId: "page-1",
    name: "Onboarding",
    x: 0,
    y: 0,
    width: 800,
    height: 300,
    fill: "#FFFFFF",
    frameIds: ["welcome", "permissions", "permissions-denied"],
  }]);
});

test("a section selected with a loose frame captures both; a nested section selected with its parent is folded in", async () => {
  installSectionFixture(["Onboarding", "Variants", "loose"]);
  const result = await captureFigmaCanvas("selected", () => {});

  assert.deepEqual(result.payload.frames.map((frame) => frame.sourceFrameId), ["welcome", "permissions", "permissions-denied", "loose"]);
  assert.equal(result.payload.sourceMetadata.captureScope, "selected sections and frames");
  assert.deepEqual(result.payload.sourceMetadata.sections.map((section) => section.sourceSectionId), ["Onboarding"]);
});

test("selecting frames inside a section stays a plain additive frame capture", async () => {
  installSectionFixture(["welcome"]);
  const result = await captureFigmaCanvas("selected", () => {});

  assert.equal(result.payload.sourceMetadata.captureScope, "selected frames and components");
  assert.equal(result.payload.sourceMetadata.sections, undefined);
});

test("page captures record the page's top-level sections", async () => {
  installSectionFixture([]);
  const result = await captureFigmaCanvas("page", () => {});

  assert.deepEqual(result.payload.frames.map((frame) => frame.sourceFrameId), ["welcome", "permissions", "permissions-denied", "loose"]);
  assert.deepEqual(result.payload.sourceMetadata.sections.map((section) => [section.sourceSectionId, section.frameIds]), [
    ["Onboarding", ["welcome", "permissions", "permissions-denied"]],
  ]);
});

test("an empty selected section explains there is nothing to capture", async () => {
  const { page } = installSectionFixture([]);
  const empty = sectionNode("Empty", { x: 2000, y: 0, width: 100, height: 100 }, page);
  page.selection = [empty];
  await assert.rejects(captureFigmaCanvas("selected", () => {}), /The selected section has no frames/);
});

test("outermost sections and section fills", () => {
  const { byId } = installSectionFixture([]);
  assert.deepEqual(outermostSelectedSections([byId.get("Variants"), byId.get("Onboarding"), byId.get("welcome")]).map((node) => node.id), ["Onboarding"]);
  assert.deepEqual(outermostSelectedSections([byId.get("Variants")]).map((node) => node.id), ["Variants"]);
  assert.equal(sectionFillHex({ fills: [{ type: "SOLID", visible: false, color: { r: 0, g: 0, b: 0 } }, { type: "SOLID", opacity: 0.5, color: { r: 1, g: 0, b: 0 } }] }), "#FF000080");
  assert.equal(sectionFillHex({ fills: [] }), null);
});

test("screens unticked in the frame list are kept as skipped section members", () => {
  const capture = {
    payload: {
      frames: [{ sourceFrameId: "a", renderAssetKey: "ra", nodes: [] }, { sourceFrameId: "b", renderAssetKey: "rb", nodes: [] }],
      sourceMetadata: { sections: [{ sourceSectionId: "s", frameIds: ["a", "b"] }] },
    },
    renders: [],
    vectorRenders: [],
    layerRenders: [],
    warnings: [],
    layerAssetReport: { mode: "recommended", limit: 256, frames: [] },
  };
  const filtered = filterCaptureToFrameIds(capture, new Set(["a"]));
  assert.deepEqual(filtered.payload.sourceMetadata.sections, [{ sourceSectionId: "s", frameIds: ["a"], skippedFrameIds: ["b"] }]);
});
