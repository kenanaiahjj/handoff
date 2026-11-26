import assert from "node:assert/strict";
import test from "node:test";
import { componentIdentity, filterElements, friendlyField, focusedElement, pickElementFields, plainValue, screenWarnings, summarizeScreenChanges } from "./mcp-dev.ts";

const m = (value) => ({ value, unit: "px", provenance: "source", sourceProperty: "x" });
const node = (id, parent, name, extra = {}) => ({
  sourceNodeId: id,
  parentSourceNodeId: parent,
  sourceFrameId: "frame",
  name,
  type: "FRAME",
  visible: true,
  bounds: { x: m(0), y: m(0), width: m(100), height: m(40) },
  layout: { mode: "VERTICAL", direction: null, primaryAxisAlign: null, counterAxisAlign: null, wrap: null, constraints: {} },
  padding: { top: m(8), right: m(8), bottom: m(8), left: m(8) },
  margins: { top: m(0), right: m(0), bottom: m(0), left: m(0) },
  spacing: { rowGap: m(0), columnGap: m(0), itemGap: m(12) },
  fills: [],
  strokes: [],
  styleReferences: [],
  typography: null,
  tokens: [],
  sourcePayload: {},
  ...extra,
});

test("a removed subtree is one entry with its children counted", () => {
  const chat = node("chat", "frame", "Support chat");
  const children = [node("c1", "chat", "Header"), node("c2", "c1", "Title"), node("c3", "chat", "Input")];
  const changes = [chat, ...children].map((n) => ({ frameId: "frame", sourceFileId: "f", sourceNodeId: n.sourceNodeId, sourceNodeName: n.name, path: "node", before: n, after: undefined, category: "structure" }));
  const summary = summarizeScreenChanges(changes, [chat, ...children], []);
  assert.equal(summary.removed.length, 1);
  assert.equal(summary.removed[0].name, "Support chat");
  assert.equal(summary.removed[0].childCount, 3);
});

test("edits are grouped per layer as field: before → after with plain values", () => {
  const button = node("b", "frame", "Button");
  const changes = [
    { frameId: "frame", sourceFileId: "f", sourceNodeId: "b", path: "bounds.width", before: m(54), after: m(60), category: "geometry" },
    { frameId: "frame", sourceFileId: "f", sourceNodeId: "b", path: "fills[0].color", before: "#000000", after: "#111111", category: "style" },
    { frameId: "frame", sourceFileId: "f", sourceNodeId: "b", path: "padding.top", before: m(8), after: undefined, category: "layout" },
    { frameId: "frame", sourceFileId: "f", sourceNodeId: null, path: "renderAsset", before: { key: "a" }, after: { key: "b" }, category: "visual" },
  ];
  const summary = summarizeScreenChanges(changes, [button], [button]);
  assert.equal(summary.edited.length, 1);
  assert.deepEqual(summary.edited[0].changes[0], { field: "screen width", from: 54, to: 60, category: "geometry" });
  assert.equal(summary.edited[0].changes[2].to, "removed");
  assert.equal(summary.screen.length, 1);
});

test("elements can be searched by name or text, type, parent and ids, with chosen fields", () => {
  const nodes = [
    node("a", null, "Sign up button", { type: "INSTANCE", sourcePayload: { mainComponentId: "cmp-1", mainComponentName: "Button/Primary" } }),
    node("b", "a", "Label", { type: "TEXT", typography: { fontFamily: "Inter", fontSize: m(16), fontWeight: 600, lineHeight: m(24), letterSpacing: m(0), textAlign: "CENTER", content: "Create account" } }),
    node("c", null, "Hero"),
  ];
  assert.deepEqual(filterElements(nodes, { query: "create" }).map((n) => n.sourceNodeId), ["b"]);
  assert.deepEqual(filterElements(nodes, { type: "instance" }).map((n) => n.sourceNodeId), ["a"]);
  assert.deepEqual(filterElements(nodes, { parentId: "a" }).map((n) => n.sourceNodeId), ["b"]);
  const picked = pickElementFields(nodes[0], ["component"]);
  assert.deepEqual(picked.component, { componentId: "cmp-1", componentName: "Button/Primary", kind: "instance" });
  assert.equal(picked.bounds, undefined);
});

test("a focused element includes typography, tokens and the parent chain", () => {
  const nodes = [
    node("card", null, "Card", { layout: { mode: "HORIZONTAL", direction: null, primaryAxisAlign: "CENTER", counterAxisAlign: null, wrap: false, constraints: {} } }),
    node("t", "card", "Price", { type: "TEXT", typography: { fontFamily: "Inter", fontSize: m(14), fontWeight: 500, lineHeight: m(20), letterSpacing: m(0), textAlign: "LEFT", content: "$12" }, tokens: [{ sourceId: "v1", name: "text/primary", category: "color", collectionId: null, collectionName: "Colors", mode: "Light", value: "#111" }] }),
  ];
  const element = focusedElement(nodes, nodes[1]);
  assert.equal(element.typography.fontSize, 14);
  assert.equal(element.tokens[0].name, "text/primary");
  assert.equal(element.ancestors[0].name, "Card");
  assert.equal(element.ancestors[0].layout.mode, "HORIZONTAL");
  assert.equal(element.ancestors[0].gap.itemGap, 12);
});

test("warns about screens sharing a name and screenshots that don't match the screen size", () => {
  const bounds = (w, h) => ({ x: m(0), y: m(0), width: m(w), height: m(h) });
  const frames = [
    { sourceFrameId: "f1", name: "Home", bounds: bounds(390, 844), renderAssetKey: "r1" },
    { sourceFrameId: "f2", name: "Home", bounds: bounds(390, 844), renderAssetKey: "r2" },
    { sourceFrameId: "f3", name: "Chat", bounds: bounds(390, 844), renderAssetKey: "r3" },
  ];
  const assets = [
    { assetKey: "r1", width: 780, height: 1688 },
    { assetKey: "r2", width: 780, height: 1688 },
    { assetKey: "r3", width: 780, height: 1689 },
  ];
  const warnings = screenWarnings(frames, assets);
  assert.deepEqual(warnings.map((w) => w.kind).sort(), ["duplicate-name", "render-size-mismatch"]);
  assert.deepEqual(warnings.find((w) => w.kind === "duplicate-name").frameIds, ["f1", "f2"]);
  assert.equal(warnings.find((w) => w.kind === "render-size-mismatch").frameId, "f3");
});

test("components map through their main component; plain layers have none", () => {
  assert.equal(componentIdentity(node("x", null, "Box")), null);
  assert.equal(componentIdentity(node("k", null, "Button", { type: "COMPONENT" })).componentId, "k");
  assert.equal(plainValue(m(12)), 12);
  assert.equal(plainValue({ value: 1.5, unit: "em" }), "1.5em");
});

test("diff paths read in a builder's words", () => {
  assert.equal(friendlyField("layoutBounds.y.value"), "y");
  assert.equal(friendlyField("sourcePayload.characters"), "text");
  assert.equal(friendlyField("bounds.width.value"), "screen width");
  assert.equal(friendlyField("fills[0].color"), "fills[0].color");
});
