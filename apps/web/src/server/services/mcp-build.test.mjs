import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { codeStyle, cssColor, cssText, snap, tokenCssVar } from "./mcp-css.ts";
import { compareImplementation, cropLayer } from "./mcp-visual.ts";
import { screenTasks, taskId } from "./mcp-tasks.ts";
import { screenAssets } from "../mcp/dev-tools.ts";

const m = (value, unit = "px") => ({ value, unit, provenance: "source", sourceProperty: "x" });
const node = (id, parent, extra = {}) => ({
  sourceNodeId: id,
  parentSourceNodeId: parent,
  sourceFrameId: "frame",
  name: id,
  type: "FRAME",
  visible: true,
  layoutBounds: { x: m(0), y: m(0), width: m(100), height: m(40) },
  bounds: { x: m(0), y: m(0), width: m(100), height: m(40) },
  layout: { mode: "NONE", direction: null, primaryAxisAlign: null, counterAxisAlign: null, wrap: null, constraints: {} },
  padding: { top: m(0), right: m(0), bottom: m(0), left: m(0) },
  margins: { top: m(0), right: m(0), bottom: m(0), left: m(0) },
  spacing: { rowGap: m(null), columnGap: m(null), itemGap: m(null) },
  fills: [],
  strokes: [],
  styleReferences: [],
  typography: null,
  tokens: [],
  sourcePayload: {},
  ...extra,
});

test("auto layout becomes flexbox with snapped padding, gap, radius, border and shadow", () => {
  const button = node("button", "screen", {
    layout: { mode: "HORIZONTAL", direction: null, primaryAxisAlign: "CENTER", counterAxisAlign: "CENTER", wrap: false, constraints: {} },
    padding: { top: m(12), right: m(10.0069), bottom: m(12), left: m(9.9983) },
    sourcePayload: {
      itemSpacing: 8, cornerRadius: 9999, topLeftRadius: 9999, topRightRadius: 9999, bottomLeftRadius: 9999, bottomRightRadius: 9999,
      layoutSizingHorizontal: "HUG", layoutSizingVertical: "FIXED",
      fillPaintDetails: [{ type: "SOLID", visible: true, opacity: 1, color: { r: 0.3098, g: 0.2745, b: 0.898 } }],
      strokePaintDetails: [{ type: "SOLID", visible: true, opacity: 1, color: { r: 0.82, g: 0.82, b: 0.84 } }], strokeWeight: 1, strokeAlign: "INSIDE",
      effects: [{ type: "DROP_SHADOW", visible: true, color: { r: 0.976, g: 0.451, b: 0.086, a: 0.3 }, offset: { x: 0, y: 2 }, radius: 12, spread: 0 }],
    },
    tokens: [{ sourceId: "v", bindingPath: "fills[0]", category: "color", name: "color/primary", collectionId: null, collectionName: null, mode: null, value: { r: 0.3098, g: 0.2745, b: 0.898, a: 1 } }],
  });
  const screen = node("screen", null, { layout: { mode: "VERTICAL", direction: null, primaryAxisAlign: null, counterAxisAlign: null, wrap: false, constraints: {} } });
  const style = codeStyle(button, screen);
  assert.equal(style.css.display, "flex");
  assert.equal(style.css["justify-content"], "center");
  assert.equal(style.css.gap, "8px");
  assert.equal(style.css.padding, "12px 10px");
  assert.equal(style.css["border-radius"], "9999px");
  assert.equal(style.css.width, undefined, "hug width is left to content");
  assert.equal(style.css.border, "1px solid #D1D1D6");
  assert.equal(style.css["box-shadow"], "0px 2px 12px 0px rgba(249, 115, 22, 0.3)");
  assert.equal(style.tokens["background-color"].cssVar, "--color-primary");
  assert.match(cssText(style), /background-color: var\(--color-primary, #4F46E5\);/);
});

test("a fill child stretches, an absolutely placed child gets left and top", () => {
  const row = node("row", null, { layout: { mode: "HORIZONTAL", direction: null, primaryAxisAlign: null, counterAxisAlign: null, wrap: false, constraints: {} } });
  assert.equal(codeStyle(node("a", "row", { sourcePayload: { layoutSizingHorizontal: "FILL" } }), row).css.flex, "1 1 0");
  const free = node("free", null);
  const placed = codeStyle(node("b", "free", { layoutBounds: { x: m(24), y: m(112), width: m(345), height: m(36) } }), free);
  assert.deepEqual([placed.css.position, placed.css.left, placed.css.top], ["absolute", "24px", "112px"]);
});

test("text: auto line height is normal, percent letter spacing is em, mixed runs are listed", () => {
  const segment = (characters, weight, color) => ({ characters, fontSize: 12, fontName: { family: "Geist", style: weight === 600 ? "SemiBold" : "Regular" }, fontWeight: weight, lineHeight: { unit: "AUTO" }, letterSpacing: { unit: "PERCENT", value: -4 }, textCase: "ORIGINAL", textDecoration: "NONE", fills: [{ type: "SOLID", visible: true, opacity: 0.5, color }] });
  const text = node("t", null, { type: "TEXT", typography: { textAlign: "CENTER" }, sourcePayload: { textSegments: [segment("By continuing, you agree to our ", 400, { r: 1, g: 1, b: 1 }), segment("Terms", 600, { r: 1, g: 1, b: 1 })] } });
  const style = codeStyle(text);
  assert.equal(style.css["line-height"], "normal");
  assert.equal(style.css["letter-spacing"], "-0.04em");
  assert.equal(style.css.color, "rgba(255, 255, 255, 0.5)");
  assert.equal(style.css["text-align"], "center");
  assert.equal(style.textRuns.length, 2);
  assert.equal(style.textRuns[1].css["font-weight"], "600");
});

test("linear gradients get the CSS angle; colour helpers and tokens read cleanly", () => {
  const overlay = node("o", null, { sourcePayload: { fillPaintDetails: [{ type: "GRADIENT_LINEAR", visible: true, opacity: 1, gradientStops: [{ color: { r: 0, g: 0, b: 0, a: 0.75 }, position: 0 }, { color: { r: 0, g: 0, b: 0, a: 0 }, position: 1 }], gradientTransform: [[0, -1, 1], [1, 0, 0]] }] } });
  assert.equal(codeStyle(overlay).css.background, "linear-gradient(0deg, rgba(0, 0, 0, 0.75) 0%, rgba(0, 0, 0, 0) 100%)");
  const topToBottom = node("g", null, { sourcePayload: { fillPaintDetails: [{ type: "GRADIENT_LINEAR", visible: true, opacity: 1, gradientStops: [{ color: { r: 1, g: 0, b: 0 }, position: 0 }, { color: { r: 0, g: 0, b: 1 }, position: 1 }], gradientTransform: [[0, 1, 0], [-1, 0, 1]] }] } });
  assert.match(codeStyle(topToBottom).css.background, /^linear-gradient\(180deg/);
  assert.equal(cssColor({ r: 1, g: 1, b: 1 }), "#FFFFFF");
  assert.equal(snap(9.9983), 10);
  assert.equal(tokenCssVar("Spacing / 4"), "--spacing-4");
});

async function solid(width, height, color, box) {
  const base = sharp({ create: { width, height, channels: 3, background: "#ffffff" } });
  if (!box) return base.png().toBuffer();
  const overlay = await sharp({ create: { width: box.width, height: box.height, channels: 3, background: color } }).png().toBuffer();
  return base.composite([{ input: overlay, left: box.x, top: box.y }]).png().toBuffer();
}

test("an identical build matches; a wrong colour is boxed with the layer that sits there", async () => {
  const layers = [{ id: "card", name: "Card", type: "FRAME", visible: true, x: 40, y: 100, width: 120, height: 80 }];
  const design = await solid(200, 300, "#4F46E5", { x: 40, y: 100, width: 120, height: 80 });
  const same = await compareImplementation({ designRender: design, built: design, frameWidth: 200, frameHeight: 300, layers });
  assert.equal(same.regions.length, 0);
  assert.ok(same.matchPercent > 99.5);
  const wrong = await solid(400, 600, "#18181B", { x: 80, y: 200, width: 240, height: 160 }); // 2× screenshot, other colour
  const check = await compareImplementation({ designRender: design, built: wrong, frameWidth: 200, frameHeight: 300, layers });
  assert.equal(check.regions.length, 1);
  assert.equal(check.regions[0].layers[0].name, "Card");
  assert.ok(check.regions[0].x <= 40 && check.regions[0].x + check.regions[0].width >= 160);
  assert.ok((await sharp(check.overlay).metadata()).width > 200);
});

test("a build shifted down by a taller header is lined up before comparing", async () => {
  const design = await solid(200, 300, "#111111", { x: 20, y: 120, width: 160, height: 40 });
  const shifted = await solid(200, 320, "#111111", { x: 20, y: 140, width: 160, height: 40 });
  const check = await compareImplementation({ designRender: design, built: shifted, frameWidth: 200, frameHeight: 300, layers: [] });
  assert.equal(check.verticalShift, 20);
  assert.equal(check.regions.length, 0);
});

test("a layer crop scales design px to the render's resolution", async () => {
  const render = await solid(400, 600, "#ff0000", { x: 80, y: 200, width: 240, height: 160 });
  const crop = await cropLayer(render, 200, { x: 40, y: 100, width: 120, height: 80 });
  assert.deepEqual([crop.width, crop.height, crop.scale], [240, 160, 2]);
});

test("icons are listed once with their vectors folded in; images are found by fill", () => {
  const nodes = [
    node("screen", null, { bounds: { x: m(0), y: m(0), width: m(390), height: m(844) } }),
    node("icon", "screen", { type: "INSTANCE", bounds: { x: m(10), y: m(10), width: m(24), height: m(24) } }),
    node("path", "icon", { type: "VECTOR", bounds: { x: m(12), y: m(12), width: m(20), height: m(20) } }),
    node("photo", "screen", { type: "RECTANGLE", sourcePayload: { fillPaintDetails: [{ type: "IMAGE", visible: true }] } }),
  ];
  const assets = screenAssets(nodes);
  assert.deepEqual(assets.map((asset) => [asset.id, asset.kind]), [["icon", "icon"], ["photo", "image"]]);
});

test("design changes become tasks with stable ids, css and saved progress", () => {
  const after = [node("screen", null), node("badge", "screen", { type: "TEXT", sourcePayload: { textSegments: [{ characters: "+4.2%", fontSize: 13, fontName: { family: "Inter", style: "Medium" }, fontWeight: 500, lineHeight: { unit: "PIXELS", value: 18 }, letterSpacing: { unit: "PIXELS", value: 0 }, fills: [] }] } })];
  const summary = {
    counts: { removed: 1, added: 0, moved: 0, edited: 1, screenOnly: 0 },
    removed: [{ id: "chat", name: "Support chat", type: "FRAME", bounds: {}, text: null, childCount: 3 }],
    added: [],
    moved: [],
    edited: [{ id: "badge", name: "Badge", type: "TEXT", changes: [{ field: "text", from: "+2.1%", to: "+4.2%", category: "content" }] }],
    screen: [],
  };
  const progress = new Map([[taskId("frame", "remove", "chat"), { taskId: "frame|remove|chat", status: "done", codePath: "src/Chat.tsx", note: null, updatedAt: "2026-11-26" }]]);
  const links = [{ id: "l", targetKind: "element", targetId: "badge", targetName: "Badge", codeComponent: "TrendBadge", codePath: "src/TrendBadge.tsx", notes: null, updatedAt: "" }];
  const tasks = screenTasks({ frameId: "frame", name: "Home", status: "changed", summary, beforeNodes: [], afterNodes: after, links, progress });
  assert.deepEqual(tasks.map((task) => [task.taskId, task.kind, task.status]), [["frame|remove|chat", "remove", "done"], ["frame|update|badge", "update", "todo"]]);
  assert.match(tasks[1].summary, /text "\+2\.1%" → "\+4\.2%"/);
  assert.match(tasks[1].css, /font-size: 13px;/);
  assert.equal(tasks[1].code[0].codePath, "src/TrendBadge.tsx");
});
