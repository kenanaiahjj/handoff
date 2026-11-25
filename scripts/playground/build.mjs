// Builds the Handoff Playground capture: renders scripts/playground/screens.mjs in headless Chrome
// (one PNG per screen at 2x, plus each screen's layers read from the page) and writes snapshots that
// match the Figma capture format to apps/web/playground/. The app creates the Playground from those
// files the first time someone opens it, so rerun this after changing a screen and commit the output.
//
// Run from the repo root (needs Google Chrome installed):
//   node scripts/playground/build.mjs
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { comments, screens, versions } from "./screens.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const outDir = path.join(root, "apps/web/playground");
const chromePath = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const css = await readFile(path.join(import.meta.dirname, "styles.css"), "utf8");
const SCALE = 2;
const GAP = 120;

// --- Chrome over the DevTools protocol -------------------------------------------------------

const work = await mkdtemp(path.join(os.tmpdir(), "asbir-playground-"));
const chrome = spawn(chromePath, [
  "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${path.join(work, "profile")}`,
  "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "--font-render-hinting=none",
], { stdio: ["ignore", "ignore", "pipe"] });
const browserUrl = await new Promise((resolve, reject) => {
  let buffer = "";
  chrome.stderr.on("data", (chunk) => {
    buffer += chunk;
    const match = buffer.match(/DevTools listening on (ws:\/\/\S+)/);
    if (match) resolve(match[1]);
  });
  chrome.on("exit", (code) => reject(new Error(`Chrome exited (${code}) before it was ready.`)));
});

const socket = new WebSocket(browserUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let nextId = 0;
const pending = new Map();
const listeners = new Set();
socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  } else {
    for (const listener of listeners) listener(message);
  }
};
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params, sessionId }));
});

const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
const page = (method, params) => send(method, params, sessionId);
await page("Page.enable");
await page("Runtime.enable");

async function load(html, width, height) {
  const file = path.join(work, `page-${nextId}.html`);
  await writeFile(file, `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${html}</body></html>`);
  await page("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: SCALE, mobile: false });
  const loaded = new Promise((resolve) => {
    const listener = (message) => {
      if (message.sessionId === sessionId && message.method === "Page.loadEventFired") {
        listeners.delete(listener);
        resolve();
      }
    };
    listeners.add(listener);
  });
  await page("Page.navigate", { url: pathToFileURL(file).href });
  await loaded;
  await page("Runtime.evaluate", { expression: "document.fonts.ready.then(() => document.fonts.size)", awaitPromise: true });
  const family = await page("Runtime.evaluate", { expression: "document.fonts.check('600 16px Inter')", returnByValue: true });
  if (!family.result.value) throw new Error("Inter did not load. Check the network connection and rerun.");
}

async function screenshot(width, height) {
  const { data } = await page("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width, height, scale: 1 }, captureBeyondViewport: false });
  return Buffer.from(data, "base64");
}

// --- Reading layers from the page ------------------------------------------------------------

// Runs in the page: every element worth a layer, in document order, with its computed style.
function readLayers() {
  const rootElement = document.body.firstElementChild;
  const origin = rootElement.getBoundingClientRect();
  const tokens = {};
  const rootStyle = getComputedStyle(document.documentElement);
  for (const name of ["background", "foreground", "muted", "muted-foreground", "border", "primary", "primary-foreground", "accent", "accent-soft", "success", "success-soft", "destructive", "ring"]) {
    tokens[name] = rootStyle.getPropertyValue(`--${name}`).trim();
  }
  const layers = [];
  const box = (rect) => ({ x: rect.left - origin.left, y: rect.top - origin.top, width: rect.width, height: rect.height });
  const visible = (style) => {
    const background = style.backgroundColor;
    const hasFill = background && !/rgba\(.*,\s*0\)$/.test(background) && background !== "transparent";
    const hasBorder = parseFloat(style.borderTopWidth) > 0 && style.borderTopStyle !== "none";
    return hasFill || hasBorder || (style.boxShadow && style.boxShadow !== "none");
  };
  const styleOf = (style) => ({
    display: style.display, flexDirection: style.flexDirection, justifyContent: style.justifyContent, alignItems: style.alignItems,
    flexWrap: style.flexWrap, flexGrow: style.flexGrow, rowGap: style.rowGap, columnGap: style.columnGap,
    paddingTop: style.paddingTop, paddingRight: style.paddingRight, paddingBottom: style.paddingBottom, paddingLeft: style.paddingLeft,
    backgroundColor: style.backgroundColor, borderColor: style.borderTopColor, borderWidth: style.borderTopWidth, borderStyle: style.borderTopStyle,
    radii: [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius],
    boxShadow: style.boxShadow, opacity: style.opacity, color: style.color,
    fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight, lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing, textAlign: style.textAlign, textTransform: style.textTransform,
  });

  function walk(element, parent) {
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const named = element.getAttribute("data-name");
    const isSvg = element.tagName.toLowerCase() === "svg";
    const elementChildren = [...element.children];
    const textNodes = [...element.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
    const isTextLeaf = !isSvg && elementChildren.length === 0 && textNodes.length > 0;

    let index = parent;
    if (isSvg) {
      layers.push({ kind: "vector", name: named ?? "Icon", parent, box: box(rect), style: styleOf(style), stroke: element.getAttribute("stroke"), fill: element.getAttribute("fill") });
      return;
    }
    if (isTextLeaf) {
      const text = element.textContent.replace(/\s+/g, " ").trim();
      layers.push({ kind: "text", name: named ?? text.slice(0, 48), parent, box: box(rect), style: styleOf(style), text });
      return;
    }
    if (named || visible(style) || element === rootElement) {
      layers.push({ kind: "box", name: named ?? "Rectangle", parent, box: box(rect), style: styleOf(style) });
      index = layers.length - 1;
    }
    // Text sitting next to elements (a button's label beside its icon) becomes its own text layer.
    for (const node of element.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent.trim() && !isTextLeaf) {
        const range = document.createRange();
        range.selectNodeContents(node);
        const text = node.textContent.replace(/\s+/g, " ").trim();
        layers.push({ kind: "text", name: text.slice(0, 48), parent: index, box: box(range.getBoundingClientRect()), style: styleOf(style), text });
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        walk(node, index);
      }
    }
  }
  walk(rootElement, null);
  return { layers, tokens };
}

const px = (value) => {
  const number = parseFloat(value);
  return Number.isFinite(number) ? number : null;
};
const round = (value) => Math.round(value * 100) / 100;
const measure = (value, sourceProperty, unit = "px") => value === null || value === undefined
  ? { value: null, unit, provenance: "unavailable", sourceProperty: null }
  : { value: round(value), unit, provenance: "source", sourceProperty };
const measured = (value, sourceProperty) => ({ value: round(value), unit: "px", provenance: "measured", sourceProperty });

function parseColor(value) {
  const match = value?.match(/rgba?\(([^)]+)\)/);
  if (!match) return null;
  const [r, g, b, a = "1"] = match[1].split(/[\s,/]+/).filter(Boolean);
  return { r: Number(r), g: Number(g), b: Number(b), a: Number(a) };
}
const hex = ({ r, g, b }) => "#" + [r, g, b].map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("").toUpperCase();
const unit = ({ r, g, b, a }) => ({ r: r / 255, g: g / 255, b: b / 255, a });

function paint(color, property) {
  return { color: hex(color), opacity: measure(color.a, `${property}[0].opacity`, "ratio"), sourceStyleId: null };
}

function shadows(value) {
  if (!value || value === "none") return [];
  return value.split(/,(?![^(]*\))/).map((entry) => {
    const color = parseColor(entry) ?? { r: 0, g: 0, b: 0, a: 0.25 };
    const lengths = entry.replace(/rgba?\([^)]*\)/, "").trim().split(/\s+/).map(px).filter((number) => number !== null);
    const [x = 0, y = 0, blur = 0, spread = 0] = lengths;
    return {
      type: entry.includes("inset") ? "INNER_SHADOW" : "DROP_SHADOW", visible: true, radius: blur, spread, offset: { x, y },
      color: unit(color), blendMode: "NORMAL", showShadowBehindNode: false,
    };
  });
}

const justify = { normal: "MIN", "flex-start": "MIN", start: "MIN", center: "CENTER", "flex-end": "MAX", end: "MAX", "space-between": "SPACE_BETWEEN" };
const align = { normal: "MIN", stretch: "MIN", "flex-start": "MIN", start: "MIN", center: "CENTER", "flex-end": "MAX", end: "MAX", baseline: "BASELINE" };
const textAlign = { left: "LEFT", start: "LEFT", center: "CENTER", right: "RIGHT", end: "RIGHT", justify: "JUSTIFIED" };
const unavailable = () => measure(null);
const sides = (values) => ({ top: values[0], right: values[1], bottom: values[2], left: values[3] });

function toNodes(frameId, { layers, tokens }) {
  const tokenByHex = new Map(Object.entries(tokens).map(([name, value]) => [value.toUpperCase(), name]));
  const ids = [];
  const childCounts = new Map();
  const paths = [];
  return layers.map((layer, index) => {
    // Stable ids: the layer's name path, so unchanged layers keep their id between versions.
    const parentPath = layer.parent === null ? "" : paths[layer.parent];
    const key = `${parentPath}/${layer.name}`;
    const seen = childCounts.get(key) ?? 0;
    childCounts.set(key, seen + 1);
    paths[index] = `${key}#${seen}`;
    const id = layer.parent === null ? frameId : `${frameId}:${createHash("sha1").update(paths[index]).digest("hex").slice(0, 10)}`;
    ids[index] = id;

    const { style, box } = layer;
    const parent = layer.parent === null ? null : layers[layer.parent];
    const isText = layer.kind === "text";
    const isFlex = layer.kind === "box" && (style.display === "flex" || style.display === "inline-flex");
    const row = isFlex && style.flexDirection.startsWith("row");
    const background = parseColor(style.backgroundColor);
    const border = parseColor(style.borderColor);
    const textColor = parseColor(style.color);
    const fills = [];
    const strokes = [];
    const tokenBindings = [];
    const bind = (color, bindingPath) => {
      const name = tokenByHex.get(hex(color));
      if (name && color.a === 1) {
        tokenBindings.push({
          sourceId: `VariableID:penny/${name}`, bindingPath, category: "color", name: `color/${name}`,
          collectionId: "VariableCollectionId:penny", collectionName: "Penny tokens", mode: "Light", value: unit(color),
        });
      }
    };
    if (isText && textColor) { fills.push(paint(textColor, "fills")); bind(textColor, "fills[0]"); }
    if (layer.kind === "vector") {
      const stroke = layer.stroke && layer.stroke !== "none" ? (layer.stroke === "currentColor" ? textColor : parseColor(layer.stroke) ?? hexToColor(layer.stroke)) : null;
      if (stroke) { strokes.push(paint(stroke, "strokes")); bind(stroke, "strokes[0]"); }
      const fill = layer.fill && layer.fill !== "none" ? (layer.fill === "currentColor" ? textColor : hexToColor(layer.fill)) : null;
      if (fill) { fills.push(paint(fill, "fills")); bind(fill, "fills[0]"); }
    }
    if (layer.kind === "box" && background && background.a > 0) { fills.push(paint(background, "fills")); bind(background, "fills[0]"); }
    const borderWidth = px(style.borderWidth) ?? 0;
    if (layer.kind === "box" && border && borderWidth > 0 && style.borderStyle !== "none") { strokes.push(paint(border, "strokes")); bind(border, "strokes[0]"); }

    const radii = style.radii.map((value) => Math.min(px(value) ?? 0, box.height / 2, box.width / 2));
    const grows = parent && parent.style.display.includes("flex") && Number(style.flexGrow) > 0;
    const parentRow = parent?.style.flexDirection.startsWith("row");
    const fontSize = px(style.fontSize);
    const lineHeight = style.lineHeight === "normal" ? fontSize * 1.2 : px(style.lineHeight);
    const letterSpacing = style.letterSpacing === "normal" ? 0 : px(style.letterSpacing) ?? 0;
    const text = layer.text && style.textTransform === "uppercase" ? layer.text.toUpperCase() : layer.text;
    const family = style.fontFamily.split(",")[0].replaceAll('"', "").trim();
    const weight = Number(style.fontWeight);
    const styleName = { 400: "Regular", 500: "Medium", 600: "Semi Bold", 700: "Bold" }[weight] ?? "Regular";
    const parentBox = parent?.box;
    const sizingHorizontal = isText ? "HUG" : grows && parentRow ? "FILL" : "FIXED";

    return {
      sourceNodeId: id,
      parentSourceNodeId: layer.parent === null ? null : ids[layer.parent],
      sourceFrameId: frameId,
      name: layer.name,
      type: isText ? "TEXT" : layer.kind === "vector" ? "VECTOR" : layers.some((other) => other.parent === index) || layer.parent === null ? "FRAME" : "RECTANGLE",
      visible: true,
      layoutBounds: {
        x: measure(parentBox ? box.x - parentBox.x : 0, "x"), y: measure(parentBox ? box.y - parentBox.y : 0, "y"),
        width: measure(box.width, "width"), height: measure(box.height, "height"),
      },
      bounds: {
        x: measured(box.x, "absoluteBoundingBox.x - frame.absoluteBoundingBox.x"), y: measured(box.y, "absoluteBoundingBox.y - frame.absoluteBoundingBox.y"),
        width: measure(box.width, "absoluteBoundingBox.width"), height: measure(box.height, "absoluteBoundingBox.height"),
      },
      layout: {
        mode: isFlex ? (row ? "HORIZONTAL" : "VERTICAL") : layer.kind === "box" ? "NONE" : null,
        direction: null,
        primaryAxisAlign: isFlex ? justify[style.justifyContent] ?? "MIN" : null,
        counterAxisAlign: isFlex ? align[style.alignItems] ?? "MIN" : null,
        wrap: isFlex ? style.flexWrap === "wrap" : null,
        constraints: { constraints: { horizontal: "MIN", vertical: "MIN" }, layoutSizingHorizontal: sizingHorizontal, layoutSizingVertical: isText ? "HUG" : "FIXED", layoutGrow: grows ? 1 : 0 },
      },
      padding: isFlex
        ? sides([style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].map((value, side) => measure(px(value), ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"][side])))
        : sides([unavailable(), unavailable(), unavailable(), unavailable()]),
      margins: parentBox
        ? sides([
            measured(box.y - parentBox.y, "absoluteBoundingBox.y - parent.absoluteBoundingBox.y"),
            measured(parentBox.x + parentBox.width - box.x - box.width, "parent.absoluteBoundingBox.right - absoluteBoundingBox.right"),
            measured(parentBox.y + parentBox.height - box.y - box.height, "parent.absoluteBoundingBox.bottom - absoluteBoundingBox.bottom"),
            measured(box.x - parentBox.x, "absoluteBoundingBox.x - parent.absoluteBoundingBox.x"),
          ])
        : sides([unavailable(), unavailable(), unavailable(), unavailable()]),
      spacing: {
        rowGap: isFlex && px(style.rowGap) !== null ? measure(px(style.rowGap), "counterAxisSpacing") : unavailable(),
        columnGap: isFlex && px(style.columnGap) !== null ? measure(px(style.columnGap), "itemSpacing") : unavailable(),
        itemGap: isFlex ? measure(px(row ? style.columnGap : style.rowGap) ?? 0, "itemSpacing") : unavailable(),
      },
      fills,
      strokes,
      styleReferences: [],
      typography: isText
        ? {
            fontFamily: family,
            fontSize: measure(fontSize, "fontSize"),
            fontWeight: weight,
            lineHeight: measure(round(lineHeight), "lineHeight", "pixels"),
            letterSpacing: measure(letterSpacing, "letterSpacing", "pixels"),
            textAlign: textAlign[style.textAlign] ?? "LEFT",
            content: text,
          }
        : null,
      tokens: tokenBindings,
      sourcePayload: {
        rotation: 0,
        opacity: Number(style.opacity),
        blendMode: "PASS_THROUGH",
        ...(layer.kind === "box" ? {
          cornerRadius: radii.every((value) => value === radii[0]) ? radii[0] : 0,
          topLeftRadius: radii[0], topRightRadius: radii[1], bottomRightRadius: radii[2], bottomLeftRadius: radii[3],
          clipsContent: layer.parent === null,
        } : {}),
        layoutSizingHorizontal: sizingHorizontal,
        layoutSizingVertical: isText ? "HUG" : "FIXED",
        layoutGrow: grows ? 1 : 0,
        strokeWeight: layer.kind === "vector" ? 1.75 : borderWidth,
        strokeAlign: layer.kind === "vector" ? "CENTER" : "INSIDE",
        effects: layer.kind === "box" ? shadows(style.boxShadow) : [],
        ...(isText ? {
          characters: text,
          textAutoResize: "WIDTH_AND_HEIGHT",
          textSegments: [{
            characters: text, start: 0, end: text.length, fontSize,
            fontName: { family, style: styleName }, fontWeight: weight,
            textDecoration: "NONE", textCase: style.textTransform === "uppercase" ? "UPPER" : "ORIGINAL",
            lineHeight: { unit: "PIXELS", value: round(lineHeight) }, letterSpacing: { unit: "PIXELS", value: letterSpacing },
            fills: textColor ? [{ type: "SOLID", visible: true, opacity: textColor.a, blendMode: "NORMAL", color: { r: textColor.r / 255, g: textColor.g / 255, b: textColor.b / 255 } }] : [],
            textStyleId: "", fillStyleId: "", listOptions: { type: "NONE" }, indentation: 0, boundVariables: {},
          }],
        } : {}),
      },
    };
  });
}

function hexToColor(value) {
  const match = value?.match(/^#([0-9a-f]{6})$/i);
  if (!match) return null;
  const number = parseInt(match[1], 16);
  return { r: number >> 16, g: (number >> 8) & 255, b: number & 255, a: 1 };
}

// --- Build ------------------------------------------------------------------------------------

function pngSize(bytes) {
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

await rm(outDir, { recursive: true, force: true });
await mkdir(path.join(outDir, "assets"), { recursive: true });
const manifest = { generatedBy: "scripts/playground/build.mjs", versions: [], comments };
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const writtenAssets = new Set();
let latestShots = [];

for (const version of versions) {
  const frames = [];
  const assets = [];
  let x = 0;
  const shots = [];
  for (const screen of screens) {
    if (screen.versions && !screen.versions.includes(version.label)) continue;
    await load(screen.render(version.label === "1.1"), screen.width, screen.height);
    const read = await page("Runtime.evaluate", { expression: `(${readLayers.toString()})()`, returnByValue: true });
    if (read.exceptionDetails) throw new Error(read.exceptionDetails.exception?.description ?? "Reading layers failed.");
    const png = await screenshot(screen.width, screen.height);
    const hash = sha(png);
    const key = `${screen.id}-${hash.slice(0, 12)}`;
    const fileName = `${key}.png`;
    if (!writtenAssets.has(fileName)) {
      await writeFile(path.join(outDir, "assets", fileName), png);
      writtenAssets.add(fileName);
    }
    assets.push({ key, fileName, contentType: "image/png", sizeBytes: png.length, sha256: hash, ...pngSize(png) });
    const bounds = {
      x: measure(x, "absoluteBoundingBox.x"), y: measure(0, "absoluteBoundingBox.y"),
      width: measure(screen.width, "absoluteBoundingBox.width"), height: measure(screen.height, "absoluteBoundingBox.height"),
    };
    frames.push({
      sourceFrameId: screen.id, sourcePageId: "penny-page", name: screen.name, bounds, renderBounds: bounds,
      renderAssetKey: key, nodes: toNodes(screen.id, read.result.value),
    });
    shots.push({ x, width: screen.width, height: screen.height, png });
    x += screen.width + GAP;
  }

  latestShots = shots.map((shot, index) => ({ ...shot, id: frames[index].sourceFrameId }));
  // Overview: every screen side by side, small.
  const width = x - GAP;
  const height = Math.max(...shots.map((shot) => shot.height));
  const overviewScale = Math.min(1, 1600 / width);
  await page("Emulation.setDeviceMetricsOverride", { width: Math.ceil(width * overviewScale), height: Math.ceil(height * overviewScale), deviceScaleFactor: 1, mobile: false });
  const overviewHtml = `<div style="position:relative;width:${width * overviewScale}px;height:${height * overviewScale}px">${shots.map((shot) =>
    `<img src="data:image/png;base64,${shot.png.toString("base64")}" style="position:absolute;left:${shot.x * overviewScale}px;top:0;width:${shot.width * overviewScale}px;height:${shot.height * overviewScale}px">`).join("")}</div>`;
  const overviewFile = path.join(work, `overview-${version.label}.html`);
  await writeFile(overviewFile, `<!doctype html><html><body style="margin:0;background:transparent">${overviewHtml}</body></html>`);
  await page("Page.navigate", { url: pathToFileURL(overviewFile).href });
  await new Promise((resolve) => setTimeout(resolve, 600));
  const { data } = await page("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: Math.ceil(width * overviewScale), height: Math.ceil(height * overviewScale), scale: 1 } });
  const overview = Buffer.from(data, "base64");
  const overviewHash = sha(overview);
  const overviewKey = `penny-overview-${overviewHash.slice(0, 12)}`;
  await writeFile(path.join(outDir, "assets", `${overviewKey}.png`), overview);
  assets.unshift({ key: overviewKey, fileName: `${overviewKey}.png`, contentType: "image/png", sizeBytes: overview.length, sha256: overviewHash, ...pngSize(overview) });

  const snapshot = {
    schemaVersion: 1,
    source: "figma",
    sourceFileId: "asbir-playground-penny",
    sourceRevisionId: null,
    sourceFileName: "Penny (Playground)",
    capturedAt: version.capturedAt,
    overviewAssetKey: overviewKey,
    canvasBounds: { x: measured(0, "capture.x"), y: measured(0, "capture.y"), width: measured(width, "capture.width"), height: measured(height, "capture.height") },
    frames,
    assets,
    sourceMetadata: {
      sourceTool: "figma",
      sourceFileId: "asbir-playground-penny",
      sourcePageId: "penny-page",
      sourcePageName: "Penny app",
      captureScope: "all top-level frames on current page",
      adapter: "asbir-playground",
      adapterVersion: "1.0.0",
      renderFormat: "image/png",
      renderScale: SCALE,
      playground: true,
      layoutNote: "Built from HTML for the Handoff Playground. Padding and gaps are the page's CSS values.",
    },
  };
  const file = `snapshot-${version.label}.json`;
  await writeFile(path.join(outDir, file), JSON.stringify(snapshot));
  manifest.versions.push({ label: version.label, note: version.note, file });
  console.log(`v${version.label}: ${frames.length} screens, ${frames.reduce((sum, frame) => sum + frame.nodes.length, 0)} layers`);
}

await writeFile(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

// The Playground card on the projects page: three phone screens on a soft backdrop, 16:9.
{
  const picks = ["penny-home", "penny-send-money", "penny-insights"].map((id) => latestShots.find((shot) => shot.id === id));
  const preview = `<div style="width:960px;height:540px;display:flex;align-items:center;justify-content:center;gap:28px;background:linear-gradient(135deg,#2a2a2e,#1c1c1f)">${picks.map((shot, index) =>
    `<img src="data:image/png;base64,${shot.png.toString("base64")}" style="width:230px;height:498px;border-radius:26px;box-shadow:0 18px 40px rgba(0,0,0,.45);transform:translateY(${index === 1 ? -14 : 26}px)">`).join("")}</div>`;
  const file = path.join(work, "preview.html");
  await writeFile(file, `<!doctype html><html><body style="margin:0">${preview}</body></html>`);
  await page("Emulation.setDeviceMetricsOverride", { width: 960, height: 540, deviceScaleFactor: 1, mobile: false });
  await page("Page.navigate", { url: pathToFileURL(file).href });
  await new Promise((resolve) => setTimeout(resolve, 600));
  const { data } = await page("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 960, height: 540, scale: 1 } });
  await writeFile(path.join(root, "apps/web/public/playground-preview.png"), Buffer.from(data, "base64"));
}
socket.close();
await new Promise((resolve) => { chrome.once("exit", resolve); chrome.kill(); });
await rm(work, { recursive: true, force: true, maxRetries: 5 }).catch(() => undefined);
console.log(`Wrote ${path.relative(root, outDir)}/`);
