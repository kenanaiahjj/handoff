import type {
  Bounds,
  Measurement,
  SnapshotFrame,
  SnapshotNode,
} from "@asbir/snapshot-contract";
import { MAX_CAPTURE_ASSET_BYTES, MAX_SNAPSHOT_JSON_BYTES } from "../../../packages/snapshot-contract/src/limits.ts";
import { encodeUtf8 } from "../../../packages/snapshot-contract/src/utf8.ts";
import { jsonByteLength } from "./json-byte-length.ts";
import type { CaptureAssetBytes, DraftSnapshot, LayerExportAssetBytes } from "./types";

const allowedRootTypes = new Set(["FRAME", "COMPONENT", "INSTANCE", "COMPONENT_SET"]);
const maxNodes = 50_000;
const maxStructuredPayloadBytes = MAX_SNAPSHOT_JSON_BYTES;
const metadataLookupBatchSize = 50;
const maxLayerExportCount = 256;
const maxLayerExportBytes = 20 * 1024 * 1024;
const maxSingleLayerExportBytes = 5 * 1024 * 1024;
const layerExportBatchSize = 4;
const frameRenderBatchSize = 2;
const vectorAssetNodeTypes = new Set(["VECTOR", "BOOLEAN_OPERATION", "RECTANGLE", "ELLIPSE", "LINE", "POLYGON", "STAR"]);
const compositeAssetNodeTypes = new Set(["GROUP", "FRAME", "COMPONENT", "INSTANCE", "COMPONENT_SET"]);
const mebibyte = 1024 * 1024;

function renderTransferLimitError(totalBytes: number) {
  const capturedMebibytes = (totalBytes / mebibyte).toFixed(1);
  const limitMebibytes = (MAX_CAPTURE_ASSET_BYTES / mebibyte).toFixed(0);
  return new Error(`The page’s Figma renders total ${capturedMebibytes} MiB, above Handoff’s ${limitMebibytes} MiB capture asset limit.`);
}

type Rect = { x: number; y: number; width: number; height: number };
type AliasRef = { id: string; path: string };
type TextSegments = ReturnType<TextNode["getStyledTextSegments"]>;
type TextSegmentsCache = WeakMap<SceneNode, TextSegments | null>;
interface JsonObject { [key: string]: JsonValue }
type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
type RootCapture = {
  root: SceneNode;
  rect: Rect;
  renderRect: Rect;
  key: string;
  pageId: string;
  pageName: string;
  pageOffsetX: number;
  pageOffsetY: number;
};
type LayerExportCandidate = {
  entry: RootCapture;
  item: { node: SceneNode; parentId: string | null };
  order: number;
  rect: Rect;
  name: string;
  sourceNodeId: string;
  priority: number;
};
type PageCapture = {
  page: PageNode;
  roots: RootCapture[];
  sourceBounds: Rect | null;
  offsetX: number;
  offsetY: number;
};

function recordOf(value: object): Record<string, unknown> {
  return value as unknown as Record<string, unknown>;
}

function structuredPayloadLimitError(byteLength: number) {
  const size = (byteLength / (1024 * 1024)).toFixed(1);
  const limit = Math.round(maxStructuredPayloadBytes / (1024 * 1024));
  return new Error(`The structured layer data is ${size} MiB, above Handoff’s ${limit} MiB limit.`);
}

function nodeProperty(node: SceneNode, field: string) {
  try {
    return recordOf(node)[field];
  } catch {
    return undefined;
  }
}

function plainJson(value: unknown, seen = new WeakSet<object>(), depth = 0): JsonValue {
  if (depth > 64) return null;
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "object") {
    if (seen.has(value)) return null;
    seen.add(value);
    try {
      if (Array.isArray(value)) return value.map((entry) => plainJson(entry, seen, depth + 1));
      const output: Record<string, JsonValue> = {};
      for (const [key, entry] of Object.entries(value)) {
        if (entry !== undefined && typeof entry !== "function") output[key] = plainJson(entry, seen, depth + 1);
      }
      return output;
    } catch {
      return null;
    } finally {
      seen.delete(value);
    }
  }
  return null;
}

function measurement(value: number | null | undefined, unit = "px", sourceProperty: string | null = null, provenance: Measurement["provenance"] = "source"): Measurement {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { value: null, unit, provenance: "unavailable", sourceProperty: null };
  }
  return { value, unit, provenance, sourceProperty };
}

function rectOf(node: SceneNode): Rect | null {
  const rect = node.absoluteBoundingBox;
  if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) return null;
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function renderRectOf(node: SceneNode, fallback: Rect): Rect {
  const rect = nodeProperty(node, "absoluteRenderBounds") as Rect | null | undefined;
  if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) {
    return fallback;
  }
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function bounds(rect: Rect | null, frameRect?: Rect): Bounds {
  if (!rect) {
    return {
      x: measurement(null), y: measurement(null), width: measurement(null), height: measurement(null),
    };
  }
  return {
    x: frameRect
      ? measurement(rect.x - frameRect.x, "px", "absoluteBoundingBox.x - frame.absoluteBoundingBox.x", "measured")
      : measurement(rect.x, "px", "absoluteBoundingBox.x"),
    y: frameRect
      ? measurement(rect.y - frameRect.y, "px", "absoluteBoundingBox.y - frame.absoluteBoundingBox.y", "measured")
      : measurement(rect.y, "px", "absoluteBoundingBox.y"),
    width: measurement(rect.width, "px", "absoluteBoundingBox.width"),
    height: measurement(rect.height, "px", "absoluteBoundingBox.height"),
  };
}

function fourUnavailable() {
  return { top: measurement(null), right: measurement(null), bottom: measurement(null), left: measurement(null) };
}

function nodeChildren(node: SceneNode): SceneNode[] {
  const children = nodeProperty(node, "children");
  return Array.isArray(children) ? children as SceneNode[] : [];
}

function isArtboard(node: SceneNode): boolean {
  return allowedRootTypes.has(node.type);
}

function findTopLevelArtboards(node: SceneNode, result: SceneNode[]) {
  const stack = [{ node, children: null as SceneNode[] | null, index: 0, entered: false }];
  const visited = new Set<string>();
  while (stack.length) {
    const current = stack[stack.length - 1];
    if (!current.entered) {
      current.entered = true;
      if (visited.has(current.node.id)) {
        stack.pop();
        continue;
      }
      visited.add(current.node.id);
      if (isArtboard(current.node)) {
        result.push(current.node);
        stack.pop();
        continue;
      }
      current.children = nodeChildren(current.node);
    }
    if (current.index < current.children!.length) {
      const child = current.children![current.index++];
      stack.push({ node: child, children: null, index: 0, entered: false });
    } else {
      stack.pop();
    }
  }
}

function selectedArtboards(selection: readonly SceneNode[]): SceneNode[] {
  const roots = new Map<string, SceneNode>();
  for (const selected of selection) {
    let current: BaseNode | null = selected;
    const visited = new Set<string>();
    while (current && current.type !== "DOCUMENT" && current.type !== "PAGE") {
      if (visited.has(current.id)) break;
      visited.add(current.id);
      if (isArtboard(current as SceneNode)) {
        roots.set(current.id, current as SceneNode);
        break;
      }
      current = current.parent;
    }
  }
  const candidates = [...roots.values()];
  const ids = new Set(candidates.map((node) => node.id));
  return candidates.filter((node) => {
    let parent = node.parent;
    const visited = new Set<string>();
    while (parent && parent.type !== "PAGE" && parent.type !== "DOCUMENT") {
      if (visited.has(parent.id)) break;
      visited.add(parent.id);
      if (ids.has(parent.id)) return false;
      parent = parent.parent;
    }
    return true;
  });
}

function flattenNodes(root: SceneNode, nodeBudget: number): Array<{ node: SceneNode; parentId: string | null }> {
  const output: Array<{ node: SceneNode; parentId: string | null }> = [];
  const stack = [{ node: root, parentId: null as string | null, children: null as SceneNode[] | null, index: 0, entered: false }];
  const visited = new Set<string>();
  while (stack.length) {
    const current = stack[stack.length - 1];
    if (!current.entered) {
      current.entered = true;
      if (visited.has(current.node.id)) {
        stack.pop();
        continue;
      }
      if (output.length >= nodeBudget) {
        throw new Error(`This capture exceeds Handoff’s ${maxNodes.toLocaleString()} layer safety limit.`);
      }
      visited.add(current.node.id);
      output.push({ node: current.node, parentId: current.parentId });
      current.children = nodeChildren(current.node);
    }
    if (current.index < current.children!.length) {
      const child = current.children![current.index++];
      stack.push({ node: child, parentId: current.node.id, children: null, index: 0, entered: false });
    } else {
      stack.pop();
    }
  }
  return output;
}

function getAliasRefs(value: unknown, path: string, result: AliasRef[]) {
  const stack = [{ value, path, depth: 0 }];
  const visited = new WeakSet<object>();
  while (stack.length) {
    const current = stack.pop()!;
    if (!current.value || typeof current.value !== "object" || current.depth > 64) continue;
    if (visited.has(current.value)) continue;
    visited.add(current.value);
    if (Array.isArray(current.value)) {
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        stack.push({ value: current.value[index], path: `${current.path}[${index}]`, depth: current.depth + 1 });
      }
      continue;
    }
    const object = current.value as Record<string, unknown>;
    if (object.type === "VARIABLE_ALIAS" && typeof object.id === "string") {
      result.push({ id: object.id, path: current.path });
      continue;
    }
    for (const [key, entry] of Object.entries(object)) {
      stack.push({ value: entry, path: `${current.path}.${key}`, depth: current.depth + 1 });
    }
  }
}

function getAliasIds(value: unknown, result: Set<string>) {
  const stack = [value];
  const visited = new WeakSet<object>();
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    if (visited.has(current)) continue;
    visited.add(current);
    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }
    const object = current as Record<string, unknown>;
    if (object.type === "VARIABLE_ALIAS" && typeof object.id === "string") {
      result.add(object.id);
      continue;
    }
    stack.push(...Object.values(object));
  }
}

function textSegmentsFor(node: SceneNode, cache: TextSegmentsCache): TextSegments | null {
  if (node.type !== "TEXT") return null;
  if (cache.has(node)) return cache.get(node) ?? null;
  let segments: TextSegments | null = null;
  try {
    segments = (node as TextNode).getStyledTextSegments([
      "fontName", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "fills",
      "textStyleId", "fillStyleId", "boundVariables", "textDecoration", "textCase",
      "paragraphSpacing", "paragraphIndent", "indentation", "listOptions", "listSpacing",
      "textWrapStyle", "openTypeFeatures", "textStyleOverrides",
    ]) as unknown as TextSegments;
  } catch { /* Preserve the rest of the node when text segments are unavailable. */ }
  cache.set(node, segments);
  return segments;
}

async function mapInBatches<T, R>(items: readonly T[], map: (item: T) => Promise<R>, batchSize = metadataLookupBatchSize): Promise<R[]> {
  const results: R[] = [];
  for (let offset = 0; offset < items.length; offset += batchSize) {
    const batch = items.slice(offset, offset + batchSize);
    results.push(...await Promise.all(batch.map(map)));
  }
  return results;
}

function categoryForPath(path: string): "color" | "typography" | "spacing" | "effect" | "other" {
  const normalized = path.toLowerCase();
  if (/fill|stroke|color|background/.test(normalized)) return "color";
  if (/font|text|lineheight|letterspacing/.test(normalized)) return "typography";
  if (/padding|spacing|gap|radius|width|height|layoutgrids/.test(normalized)) return "spacing";
  if (/effect|shadow|blur/.test(normalized)) return "effect";
  return "other";
}

function colorHex(color: unknown): string | null {
  if (!color || typeof color !== "object") return null;
  const candidate = color as { r?: unknown; g?: unknown; b?: unknown };
  if (![candidate.r, candidate.g, candidate.b].every((channel) => typeof channel === "number" && Number.isFinite(channel))) return null;
  const hex = [candidate.r, candidate.g, candidate.b]
    .map((channel) => Math.max(0, Math.min(255, Math.round((channel as number) * 255))).toString(16).padStart(2, "0"))
    .join("");
  return `#${hex.toUpperCase()}`;
}

function colorHexFromSourceColor(color: unknown): string | null {
  if (!color || typeof color !== "object") return null;
  return colorHex(color);
}

function styleIdFor(node: SceneNode, field: string): string | null {
  const id = recordOf(node)[field];
  return typeof id === "string" && id.length > 0 ? id : null;
}

function styleReferences(node: SceneNode, styles: Map<string, BaseStyle | null>) {
  const fields = [
    ["fillStyleId", "fill"],
    ["strokeStyleId", "stroke"],
    ["textStyleId", "typography"],
    ["effectStyleId", "effect"],
    ["gridStyleId", "grid"],
  ] as const;
  return fields.flatMap(([field, kind]) => {
    const id = styleIdFor(node, field);
    if (!id) return [];
    const style = styles.get(id);
    return [{ kind, sourceStyleId: id, name: style?.name ?? null }];
  });
}

function rawMeasurement(node: SceneNode, field: string, sourceProperty = field) {
  const value = nodeProperty(node, field);
  return measurement(typeof value === "number" ? value : null, "px", sourceProperty);
}

function marginsFor(node: SceneNode, rect: Rect | null): ReturnType<typeof fourUnavailable> {
  const parent = node.parent;
  if (!parent || parent.type === "PAGE" || parent.type === "DOCUMENT") return fourUnavailable();
  const parentRect = rectOf(parent as SceneNode);
  if (!rect || !parentRect) return fourUnavailable();
  return {
    top: measurement(rect.y - parentRect.y, "px", "absoluteBoundingBox.y - parent.absoluteBoundingBox.y", "measured"),
    right: measurement(parentRect.x + parentRect.width - rect.x - rect.width, "px", "parent.absoluteBoundingBox.right - absoluteBoundingBox.right", "measured"),
    bottom: measurement(parentRect.y + parentRect.height - rect.y - rect.height, "px", "parent.absoluteBoundingBox.bottom - absoluteBoundingBox.bottom", "measured"),
    left: measurement(rect.x - parentRect.x, "px", "absoluteBoundingBox.x - parent.absoluteBoundingBox.x", "measured"),
  };
}

function layoutData(node: SceneNode) {
  const modeValue = nodeProperty(node, "layoutMode");
  const mode = typeof modeValue === "string" ? modeValue : null;
  const activeAutoLayout = mode !== null && mode !== "NONE";
  const layoutWrap = nodeProperty(node, "layoutWrap");
  const wrap = layoutWrap === "WRAP";
  const layout = {
    mode,
    direction: typeof nodeProperty(node, "layoutDirection") === "string" ? nodeProperty(node, "layoutDirection") as string : null,
    primaryAxisAlign: typeof nodeProperty(node, "primaryAxisAlignItems") === "string" ? nodeProperty(node, "primaryAxisAlignItems") as string : null,
    counterAxisAlign: typeof nodeProperty(node, "counterAxisAlignItems") === "string" ? nodeProperty(node, "counterAxisAlignItems") as string : null,
    wrap: typeof layoutWrap === "string" ? wrap : null,
    constraints: {
      constraints: plainJson(nodeProperty(node, "constraints")) ?? null,
      primaryAxisSizingMode: plainJson(nodeProperty(node, "primaryAxisSizingMode")) ?? null,
      counterAxisSizingMode: plainJson(nodeProperty(node, "counterAxisSizingMode")) ?? null,
      layoutPositioning: plainJson(nodeProperty(node, "layoutPositioning")) ?? null,
      layoutAlign: plainJson(nodeProperty(node, "layoutAlign")) ?? null,
      layoutGrow: plainJson(nodeProperty(node, "layoutGrow")) ?? null,
      layoutSizingHorizontal: plainJson(nodeProperty(node, "layoutSizingHorizontal")) ?? null,
      layoutSizingVertical: plainJson(nodeProperty(node, "layoutSizingVertical")) ?? null,
      counterAxisAlignContent: plainJson(nodeProperty(node, "counterAxisAlignContent")) ?? null,
      gridRowCount: plainJson(nodeProperty(node, "gridRowCount")) ?? null,
      gridColumnCount: plainJson(nodeProperty(node, "gridColumnCount")) ?? null,
    },
  };
  const padding = activeAutoLayout
    ? {
        top: rawMeasurement(node, "paddingTop"),
        right: rawMeasurement(node, "paddingRight"),
        bottom: rawMeasurement(node, "paddingBottom"),
        left: rawMeasurement(node, "paddingLeft"),
      }
    : fourUnavailable();
    const rawItemSpacing = nodeProperty(node, "itemSpacing");
    const rawCounterSpacing = nodeProperty(node, "counterAxisSpacing");
    const rawGridRowGap = nodeProperty(node, "gridRowGap");
    const rawGridColumnGap = nodeProperty(node, "gridColumnGap");
    const itemSpacing = typeof rawItemSpacing === "number" ? rawItemSpacing : null;
    const counterSpacing = typeof rawCounterSpacing === "number" ? rawCounterSpacing : null;
    const gridRowGap = typeof rawGridRowGap === "number" ? rawGridRowGap : null;
    const gridColumnGap = typeof rawGridColumnGap === "number" ? rawGridColumnGap : null;
  let rowGap: number | null = null;
  let columnGap: number | null = null;
  let itemGap: number | null = null;
  if (mode === "HORIZONTAL") {
    columnGap = itemSpacing;
    rowGap = wrap ? counterSpacing : null;
    itemGap = itemSpacing;
  } else if (mode === "VERTICAL") {
    rowGap = itemSpacing;
    columnGap = wrap ? counterSpacing : null;
    itemGap = itemSpacing;
  } else if (mode === "GRID") {
    rowGap = gridRowGap;
    columnGap = gridColumnGap;
  }
  const spacing = {
    rowGap: measurement(rowGap, "px", rowGap === null ? null : mode === "GRID" ? "gridRowGap" : mode === "VERTICAL" ? "itemSpacing" : "counterAxisSpacing"),
    columnGap: measurement(columnGap, "px", columnGap === null ? null : mode === "GRID" ? "gridColumnGap" : mode === "HORIZONTAL" ? "itemSpacing" : "counterAxisSpacing"),
    itemGap: measurement(itemGap, "px", itemGap === null ? null : "itemSpacing"),
  };
  return { layout, padding, spacing };
}

function paintsFor(node: SceneNode, field: "fills" | "strokes") {
  const paints = recordOf(node)[field];
  if (!Array.isArray(paints)) return [];
  return paints.map((paint, index) => {
    const item = paint as Record<string, unknown>;
    const solid = item.type === "SOLID";
    const alpha = typeof item.opacity === "number" ? item.opacity : 1;
    return {
      color: solid ? colorHexFromSourceColor(item.color) : null,
      opacity: measurement(alpha, "ratio", `${field}[${index}].opacity`),
      sourceStyleId: typeof item.styleId === "string" ? item.styleId : null,
    };
  });
}

function textTypography(node: SceneNode): SnapshotNode["typography"] {
  if (node.type !== "TEXT") return null;
  const text = node as TextNode;
  const rawFontName = text.fontName;
  const fontName = rawFontName === figma.mixed ? null : rawFontName;
  const size = typeof text.fontSize === "number" ? text.fontSize : null;
  const weight = typeof text.fontWeight === "number"
    ? text.fontWeight
    : fontName?.style ?? null;
  const lineHeight = text.lineHeight;
  const letterSpacing = text.letterSpacing;
  const lineHeightValue = lineHeight && typeof lineHeight === "object" && lineHeight.unit !== "AUTO" ? lineHeight.value : null;
  const letterSpacingValue = letterSpacing && typeof letterSpacing === "object" ? letterSpacing.value : null;
  return {
    fontFamily: fontName?.family ?? null,
    fontSize: measurement(size, "px", "fontSize"),
    fontWeight: weight,
    lineHeight: measurement(lineHeightValue, lineHeight && typeof lineHeight === "object" ? lineHeight.unit.toLowerCase() : "px", "lineHeight"),
    letterSpacing: measurement(letterSpacingValue, letterSpacing && typeof letterSpacing === "object" ? letterSpacing.unit.toLowerCase() : "px", "letterSpacing"),
    textAlign: text.textAlignHorizontal,
    content: text.characters,
  };
}

function nodeTokens(node: SceneNode, variables: Map<string, Variable | null>, collections: Map<string, VariableCollection | null>, textSegmentsCache: TextSegmentsCache) {
  const refs: AliasRef[] = [];
  getAliasRefs(recordOf(node).boundVariables, "boundVariables", refs);
  getAliasRefs(nodeProperty(node, "layoutGrids"), "layoutGrids", refs);
  for (const segment of textSegmentsFor(node, textSegmentsCache) ?? []) {
    getAliasRefs(segment.boundVariables, `textSegments[${segment.start}:${segment.end}].boundVariables`, refs);
  }
  const seen = new Set<string>();
  return refs.flatMap(({ id, path }) => {
    const variable = variables.get(id);
    if (!variable) return [];
    const category = variable.resolvedType === "COLOR" ? "color" : categoryForPath(path);
    const bindingPath = path.replace(/^boundVariables\./, "");
    const dedupeKey = `${id}:${category}:${bindingPath}`;
    if (seen.has(dedupeKey)) return [];
    seen.add(dedupeKey);
    const collection = variable.variableCollectionId
      ? collections.get(variable.variableCollectionId) ?? null
      : null;
    let resolvedValue: unknown = null;
    try {
      resolvedValue = variable.resolveForConsumer(node).value;
    } catch {
      const modeId = (node as SceneNode & { resolvedVariableModes?: Record<string, string> }).resolvedVariableModes?.[variable.variableCollectionId]
        ?? collection?.defaultModeId;
      resolvedValue = modeId ? variable.valuesByMode[modeId] : null;
    }
    const resolvedModeId = (node as SceneNode & { resolvedVariableModes?: Record<string, string> }).resolvedVariableModes?.[variable.variableCollectionId]
      ?? collection?.defaultModeId;
    return [{
      sourceId: variable.id,
      bindingPath,
      category,
      name: variable.name,
      collectionId: variable.variableCollectionId || null,
      collectionName: collection?.name ?? null,
      mode: collection?.modes.find((item) => item.modeId === resolvedModeId)?.name ?? null,
      value: plainJson(resolvedValue),
    }];
  });
}

function gridTrackSizes(node: SceneNode, field: "gridRowSizes" | "gridColumnSizes") {
  try {
    const rawTracks = nodeProperty(node, field);
    if (!Array.isArray(rawTracks)) return undefined;
    return rawTracks.flatMap((entry) => {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return [];
      const track = recordOf(entry);
      const type = track.type;
      const value = track.value;
      if (typeof type !== "string") return [];
      return [{
        type,
        value: typeof value === "number" && Number.isFinite(value) ? value : null,
      }];
    });
  } catch {
    return undefined;
  }
}

async function mainComponentsByInstanceId(nodes: readonly { node: SceneNode }[]) {
  const instances = nodes.flatMap(({ node }) => node.type === "INSTANCE" ? [node as InstanceNode] : []);
  const components = new Map<string, { id: string; name: string }>();
  const batchSize = 50;
  for (let offset = 0; offset < instances.length; offset += batchSize) {
    const batch = instances.slice(offset, offset + batchSize);
    await Promise.all(batch.map(async (instance) => {
      try {
        const component = await instance.getMainComponentAsync();
        if (component) components.set(instance.id, { id: component.id, name: component.name });
      } catch {
        // A missing component reference should not block the frame's pixels or layer data.
      }
    }));
  }
  return components;
}

function sourcePayload(node: SceneNode, componentsByInstanceId: Map<string, { id: string; name: string }>, textSegmentsCache: TextSegmentsCache) {
  const raw = recordOf(node);
  const fields = [
    "rotation", "opacity", "blendMode", "cornerRadius", "topLeftRadius", "topRightRadius",
    "bottomLeftRadius", "bottomRightRadius", "clipsContent", "layoutMode", "layoutWrap",
    "layoutDirection", "layoutPositioning", "layoutSizingHorizontal", "layoutSizingVertical",
    "layoutAlign", "layoutGrow", "primaryAxisSizingMode", "counterAxisSizingMode",
    "counterAxisAlignContent", "gridRowCount", "gridColumnCount", "gridRowGap", "gridColumnGap",
    "gridAutoTracks", "gridItemsPositioning", "gridRowAnchorIndex", "gridColumnAnchorIndex",
    "gridRowSpan", "gridColumnSpan", "gridChildHorizontalAlign", "gridChildVerticalAlign",
    "strokeWeight", "strokeAlign", "textAutoResize", "textTruncation", "maxLines", "hasMissingFont",
    "minWidth", "maxWidth", "minHeight", "maxHeight", "layoutGrids",
    "componentProperties", "componentPropertyDefinitions", "componentPropertyReferences", "variantProperties",
    "itemSpacing", "counterAxisSpacing", "itemReverseZIndex", "strokesIncludedInLayout",
  ];
  const data: Record<string, JsonValue> = { exportScale: 1 };
  if (raw.boundVariables !== undefined) data.boundVariables = plainJson(raw.boundVariables);
  const textSegments = textSegmentsFor(node, textSegmentsCache);
  if (textSegments) data.textSegments = plainJson(textSegments);
  else if (node.type === "TEXT") data.textSegments = null;
  if (node.type === "INSTANCE") {
    const component = componentsByInstanceId.get(node.id);
    if (component) {
      data.mainComponentId = component.id;
      data.mainComponentName = component.name;
    }
  }
  for (const field of fields) {
    const value = nodeProperty(node, field);
    if (value !== undefined) {
      if (field === "layoutGrids" && Array.isArray(value)) {
        data[field] = value.map((entry) => {
          const normalized = plainJson(entry);
          const sourceGrid = typeof entry === "object" && entry !== null && !Array.isArray(entry)
            ? entry as Record<string, unknown>
            : null;
          if (sourceGrid?.count === Infinity && typeof normalized === "object" && normalized !== null && !Array.isArray(normalized)) {
            return { ...normalized, count: "AUTO" };
          }
          return normalized;
        });
      } else {
        data[field] = plainJson(value);
      }
    }
  }
  const rowSizes = gridTrackSizes(node, "gridRowSizes");
  const columnSizes = gridTrackSizes(node, "gridColumnSizes");
  if (rowSizes !== undefined) data.gridRowSizes = rowSizes;
  if (columnSizes !== undefined) data.gridColumnSizes = columnSizes;
  const constraints = raw.constraints;
  if (constraints !== undefined) data.constraints = plainJson(constraints);
  const effects = raw.effects;
  if (Array.isArray(effects)) data.effects = plainJson(effects);
  const fills = raw.fills;
  if (Array.isArray(fills)) data.fillPaintDetails = plainJson(fills);
  const strokes = raw.strokes;
  if (Array.isArray(strokes)) data.strokePaintDetails = plainJson(strokes);
  return data;
}

function makeNode(
  item: { node: SceneNode; parentId: string | null },
  frameId: string,
  frameRect: Rect,
  variables: Map<string, Variable | null>,
  styles: Map<string, BaseStyle | null>,
  componentsByInstanceId: Map<string, { id: string; name: string }>,
  collections: Map<string, VariableCollection | null>,
  textSegmentsCache: TextSegmentsCache,
): SnapshotNode {
  const { node } = item;
  const nodeRect = rectOf(node);
  const { layout, padding, spacing } = layoutData(node);
  const fillBindings = paintsFor(node, "fills");
  const strokeBindings = paintsFor(node, "strokes");
  return {
    sourceNodeId: node.id,
    parentSourceNodeId: item.parentId,
    sourceFrameId: frameId,
    name: node.name,
    type: node.type,
    visible: node.visible,
    bounds: bounds(nodeRect, frameRect),
    layout,
    padding,
    margins: node.id === frameId ? fourUnavailable() : marginsFor(node, nodeRect),
    spacing,
    fills: fillBindings,
    strokes: strokeBindings,
    styleReferences: styleReferences(node, styles),
    typography: textTypography(node),
    tokens: nodeTokens(node, variables, collections, textSegmentsCache),
    sourcePayload: sourcePayload(node, componentsByInstanceId, textSegmentsCache),
  };
}

function makeMinimalNode(item: { node: SceneNode; parentId: string | null }, frameId: string, frameRect: Rect): SnapshotNode {
  const { node } = item;
  const unavailableSpacing = { rowGap: measurement(null), columnGap: measurement(null), itemGap: measurement(null) };
  const typography: SnapshotNode["typography"] = node.type === "TEXT"
    ? {
        fontFamily: null,
        fontSize: measurement(null),
        fontWeight: null,
        lineHeight: measurement(null),
        letterSpacing: measurement(null),
        textAlign: null,
        content: null,
      }
    : null;
  return {
    sourceNodeId: node.id,
    parentSourceNodeId: item.parentId,
    sourceFrameId: frameId,
    name: node.name,
    type: node.type,
    visible: node.visible,
    bounds: bounds(rectOf(node), frameRect),
    layout: {
      mode: null,
      direction: null,
      primaryAxisAlign: null,
      counterAxisAlign: null,
      wrap: null,
      constraints: {},
    },
    padding: fourUnavailable(),
    margins: fourUnavailable(),
    spacing: unavailableSpacing,
    fills: [],
    strokes: [],
    styleReferences: [],
    typography,
    tokens: [],
    sourcePayload: { captureWarning: "Figma did not expose every property for this layer." },
  };
}

function rootKey(node: SceneNode, index: number) {
  const slug = node.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 48) || "frame";
  return `frame-${String(index + 1).padStart(3, "0")}-${slug}`;
}

function isValidPng(bytes: Uint8Array) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.byteLength < 24 || signature.some((byte, index) => bytes[index] !== byte)) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return bytes[12] === 0x49 && bytes[13] === 0x48 && bytes[14] === 0x44 && bytes[15] === 0x52
    && view.getUint32(16, false) > 0 && view.getUint32(20, false) > 0;
}

async function exportPng(root: SceneNode, scale: number) {
  const bytes = await root.exportAsync({
    format: "PNG",
    constraint: { type: "SCALE", value: scale },
    contentsOnly: true,
  });
  if (!isValidPng(bytes)) throw new Error("Figma returned an invalid PNG render.");
  return bytes;
}

function hasImageFill(node: SceneNode) {
  const fills = nodeProperty(node, "fills");
  return Array.isArray(fills) && fills.some((fill) => {
    if (!fill || typeof fill !== "object") return false;
    const paint = fill as { type?: unknown; visible?: unknown };
    return paint.type === "IMAGE" && paint.visible !== false;
  });
}

function layerExportPriority(node: SceneNode) {
  try {
    const image = hasImageFill(node) || nodeProperty(node, "type") === "IMAGE";
    const settings = nodeProperty(node, "exportSettings");
    const hasExportSettings = Array.isArray(settings) && settings.length > 0;
    const name = nodeProperty(node, "name");
    const hasAssetName = typeof name === "string" && /\b(icon|logo|image|photo|avatar|illustration|asset|brand|badge)\b/i.test(name);
    const hasChildren = nodeChildren(node).length > 0;
    return (image ? 1_000 : 0) + (hasExportSettings ? 500 : 0) + (hasAssetName ? 200 : 0) + (!hasChildren ? 100 : 0);
  } catch {
    return 0;
  }
}

function canExportLayer(node: SceneNode) {
  try {
    if (nodeProperty(node, "visible") !== true) return false;
    const type = nodeProperty(node, "type");
    if (hasImageFill(node) || type === "IMAGE" || (typeof type === "string" && (vectorAssetNodeTypes.has(type) || compositeAssetNodeTypes.has(type)))) return true;
    const settings = nodeProperty(node, "exportSettings");
    return Array.isArray(settings) && settings.length > 0;
  } catch {
    return false;
  }
}

function safeRectOf(node: SceneNode): Rect | null {
  try {
    return rectOf(node);
  } catch {
    return null;
  }
}

function assetNameSlug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 36) || "layer";
}

function compareLayerExportCandidates(left: LayerExportCandidate, right: LayerExportCandidate) {
  return right.priority - left.priority || left.order - right.order;
}

function retainLayerExportCandidate(candidates: LayerExportCandidate[], candidate: LayerExportCandidate) {
  if (candidates.length < maxLayerExportCount) {
    candidates.push(candidate);
    return;
  }
  let worstIndex = 0;
  for (let index = 1; index < candidates.length; index += 1) {
    if (compareLayerExportCandidates(candidates[worstIndex], candidates[index]) < 0) worstIndex = index;
  }
  if (compareLayerExportCandidates(candidate, candidates[worstIndex]) < 0) candidates[worstIndex] = candidate;
}

function pageCanvasBounds(roots: RootCapture[]): Bounds {
  const first = roots[0].renderRect;
  const { minX, minY, maxX, maxY } = roots.reduce((bounds, entry) => ({
    minX: Math.min(bounds.minX, entry.renderRect.x),
    minY: Math.min(bounds.minY, entry.renderRect.y),
    maxX: Math.max(bounds.maxX, entry.renderRect.x + entry.renderRect.width),
    maxY: Math.max(bounds.maxY, entry.renderRect.y + entry.renderRect.height),
  }), {
    minX: first.x,
    minY: first.y,
    maxX: first.x + first.width,
    maxY: first.y + first.height,
  });
  return {
    x: measurement(minX, "px", "capturedFrames.minimum.absoluteRenderBounds.x"),
    y: measurement(minY, "px", "capturedFrames.minimum.absoluteRenderBounds.y"),
    width: measurement(maxX - minX, "px", "capturedFrames.union.absoluteRenderBounds.width"),
    height: measurement(maxY - minY, "px", "capturedFrames.union.absoluteRenderBounds.height"),
  };
}

function layoutPageCaptures(pages: PageCapture[], arrangePages: boolean) {
  const populatedPages = pages.filter((page) => page.sourceBounds);
  if (arrangePages && populatedPages.length > 1) {
    const columns = Math.ceil(Math.sqrt(populatedPages.length));
    const rows = Math.ceil(populatedPages.length / columns);
    const columnWidths = Array<number>(columns).fill(0);
    const rowHeights = Array<number>(rows).fill(0);
    populatedPages.forEach((page, index) => {
      columnWidths[index % columns] = Math.max(columnWidths[index % columns], page.sourceBounds!.width);
      const row = Math.floor(index / columns);
      rowHeights[row] = Math.max(rowHeights[row], page.sourceBounds!.height);
    });
    const gap = 240;
    const columnOffsets = columnWidths.map((_, column) =>
      columnWidths.slice(0, column).reduce((sum, width) => sum + width + gap, 0),
    );
    const rowOffsets = rowHeights.map((_, row) =>
      rowHeights.slice(0, row).reduce((sum, height) => sum + height + gap, 0),
    );

    populatedPages.forEach((page, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      page.offsetX = columnOffsets[column] - page.sourceBounds!.x;
      page.offsetY = rowOffsets[row] - page.sourceBounds!.y;
    });
  }

  for (const page of pages) {
    for (const root of page.roots) {
      root.pageOffsetX = page.offsetX;
      root.pageOffsetY = page.offsetY;
      root.renderRect = {
        ...root.renderRect,
        x: root.renderRect.x + page.offsetX,
        y: root.renderRect.y + page.offsetY,
      };
    }
  }

  return pages.map((page) => ({
    sourcePageId: page.page.id,
    sourcePageName: page.page.name || "Untitled page",
    offsetX: page.offsetX,
    offsetY: page.offsetY,
    sourceBounds: page.sourceBounds,
    frameCount: page.roots.length,
  }));
}

function unionRects(rects: readonly Rect[]): Rect | null {
  if (!rects.length) return null;
  return rects.slice(1).reduce((current, rect) => {
    const x = Math.min(current.x, rect.x);
    const y = Math.min(current.y, rect.y);
    return {
      x,
      y,
      width: Math.max(current.x + current.width, rect.x + rect.width) - x,
      height: Math.max(current.y + current.height, rect.y + rect.height) - y,
    };
  }, { ...rects[0] });
}

async function loadVariablesAndStyles(nodes: readonly { node: SceneNode }[], textSegmentsCache: TextSegmentsCache) {
  const variables = new Map<string, Variable | null>();
  const collectionsById = new Map<string, VariableCollection | null>();
  const aliasIds = new Set<string>();
  const styleIds = new Set<string>();
  const warnings: string[] = [];
  for (const { node } of nodes) {
    getAliasIds(recordOf(node).boundVariables, aliasIds);
    for (const segment of textSegmentsFor(node, textSegmentsCache) ?? []) {
      getAliasIds(segment.boundVariables, aliasIds);
    }
    for (const field of ["fillStyleId", "strokeStyleId", "textStyleId", "effectStyleId", "gridStyleId"]) {
      const id = styleIdFor(node, field);
      if (id) styleIds.add(id);
    }
  }
  const missingVariables = [...aliasIds];
  const resolvedVariables = await mapInBatches(missingVariables, (id) => figma.variables.getVariableByIdAsync(id).catch(() => null));
  for (const [index, variable] of resolvedVariables.entries()) variables.set(missingVariables[index], variable);
  const unresolvedVariableCount = resolvedVariables.filter((variable) => !variable).length;
  if (unresolvedVariableCount) warnings.push(`${unresolvedVariableCount} Figma variable binding${unresolvedVariableCount === 1 ? " could" : "s could"} not be resolved. The capture retains all layers and other readable properties.`);
  const missingCollectionIds = [...new Set(resolvedVariables.flatMap((variable) => variable?.variableCollectionId ? [variable.variableCollectionId] : []))];
  const resolvedCollections = await mapInBatches(missingCollectionIds, (id) => figma.variables.getVariableCollectionByIdAsync(id).catch(() => null));
  for (const [index, collection] of resolvedCollections.entries()) collectionsById.set(missingCollectionIds[index], collection);
  if (resolvedCollections.some((collection) => !collection)) warnings.push("Some Figma variable collections could not be resolved. The capture retains layer bindings and other readable properties.");
  const styleEntries = await mapInBatches([...styleIds], async (id) => [id, await figma.getStyleByIdAsync(id).catch(() => null)] as const);
  if (styleEntries.some(([, style]) => !style)) warnings.push("Some Figma styles could not be resolved. The capture retains style references and other readable properties.");
  return { variables, styles: new Map(styleEntries), collections: collectionsById, warnings };
}

export async function captureFigmaCanvas(scope: "selected" | "page" | "file", report: (message: string) => void) {
  const sourceFileId = figma.fileKey?.trim();
  if (!sourceFileId) {
    throw new Error("Figma did not provide a unique file key for this capture. Rebuild and reload the local development plugin, then try again.");
  }

  const pages = scope === "file" ? [...figma.root.children] : [figma.currentPage];
  const pageCaptures: PageCapture[] = [];
  const seenRootIds = new Set<string>();
  let rootIndex = 0;
  for (const [pageIndex, page] of pages.entries()) {
    const pageName = page.name || "Untitled page";
    if (scope === "file" && (pageIndex === 0 || (pageIndex + 1) % 10 === 0 || pageIndex === pages.length - 1)) {
      report(`Loading Figma page ${pageIndex + 1} of ${pages.length}: ${pageName}…`);
    }
    try {
      await page.loadAsync();
    } catch (error) {
      const detail = error instanceof Error ? ` ${error.message}` : "";
      const pageLabel = scope === "file" ? `page “${pageName}”` : "the current page";
      throw new Error(`Figma could not load ${pageLabel} for capture.${detail}`);
    }

    let artboards: SceneNode[];
    if (scope === "selected") {
      artboards = selectedArtboards(page.selection);
    } else {
      artboards = [];
      for (const child of page.children) findTopLevelArtboards(child, artboards);
    }

    const distinct = [...new Map(artboards.map((node) => [node.id, node])).values()]
      .filter((node) => !seenRootIds.has(node.id));
    const roots: RootCapture[] = [];
    for (const root of distinct) {
      seenRootIds.add(root.id);
      const rect = rectOf(root);
      if (!rect || rect.width <= 0 || rect.height <= 0) continue;
      roots.push({
        root,
        rect,
        renderRect: renderRectOf(root, rect),
        key: rootKey(root, rootIndex++),
        pageId: page.id,
        pageName,
        pageOffsetX: 0,
        pageOffsetY: 0,
      });
    }
    const sourceBounds = unionRects(roots.map((entry) => entry.renderRect));
    pageCaptures.push({ page, roots, sourceBounds, offsetX: 0, offsetY: 0 });
  }

  const roots = pageCaptures.flatMap((page) => page.roots);
  if (roots.length === 0) {
    throw new Error(scope === "selected"
      ? "Select one or more frames, components, or instances, then capture again."
      : scope === "file"
        ? "This Figma file has no top-level frames, components, or instances to capture."
        : "This page has no top-level frames, components, or instances to capture.");
  }
  const pageLayout = layoutPageCaptures(pageCaptures, scope === "file");

  let totalNodes = 0;
  const warnings: string[] = [];
  let propertyFallbackNodeCount = 0;
  const sourceFileName = figma.root.name || "Untitled Figma file";
  const snapshotFrames: SnapshotFrame[] = [];
  const layerCandidates: LayerExportCandidate[] = [];
  let layerCandidateCount = 0;
  let layerCandidateOrder = 0;
  for (const [index, entry] of roots.entries()) {
    if (index === 0 || (index + 1) % 10 === 0 || index === roots.length - 1) {
      report(`Reading layers and properties from frame ${index + 1} of ${roots.length}: ${entry.root.name || "Untitled frame"}…`);
    }
    const frameNodes = flattenNodes(entry.root, maxNodes - totalNodes);
    totalNodes += frameNodes.length;
    const textSegmentsCache: TextSegmentsCache = new WeakMap();
    const [{ variables, styles, collections, warnings: lookupWarnings }, componentsByInstanceId] = await Promise.all([
      loadVariablesAndStyles(frameNodes, textSegmentsCache).catch(() => {
        warnings.push("Variable and style lookups were unavailable. The pixel renders, layer tree, geometry, and other readable properties were retained.");
        return {
          variables: new Map<string, Variable | null>(),
          styles: new Map<string, BaseStyle | null>(),
          collections: new Map<string, VariableCollection | null>(),
          warnings: [] as string[],
        };
      }),
      mainComponentsByInstanceId(frameNodes).catch(() => {
        warnings.push("Some component source lookups were unavailable. The pixel renders and inspectable layers were retained.");
        return new Map<string, { id: string; name: string }>();
      }),
    ]);
    warnings.push(...lookupWarnings);
    const frameSnapshot: SnapshotFrame = {
      sourceFrameId: entry.root.id,
      sourcePageId: entry.pageId,
      name: entry.root.name || "Untitled frame",
      bounds: bounds(entry.rect),
      renderBounds: bounds({
        ...entry.renderRect,
        x: entry.renderRect.x - entry.pageOffsetX,
        y: entry.renderRect.y - entry.pageOffsetY,
      }),
      renderAssetKey: entry.key,
      nodes: frameNodes.map((item) => {
        try {
          return makeNode(item, entry.root.id, entry.rect, variables, styles, componentsByInstanceId, collections, textSegmentsCache);
        } catch {
          propertyFallbackNodeCount += 1;
          return makeMinimalNode(item, entry.root.id, entry.rect);
        }
      }),
    };
    snapshotFrames.push(frameSnapshot);

    for (const item of frameNodes) {
      const order = layerCandidateOrder++;
      const sourceNodeId = nodeProperty(item.node, "id");
      const name = nodeProperty(item.node, "name");
      const rect = safeRectOf(item.node);
      if (sourceNodeId === entry.root.id || typeof sourceNodeId !== "string" || !canExportLayer(item.node) || !rect || rect.width <= 0 || rect.height <= 0) continue;
      layerCandidateCount += 1;
      retainLayerExportCandidate(layerCandidates, {
        entry,
        item,
        order,
        rect,
        name: typeof name === "string" ? name : "Unnamed layer",
        sourceNodeId,
        priority: layerExportPriority(item.node),
      });
    }
    frameNodes.length = 0;
  }

  report(`Read ${totalNodes.toLocaleString()} layers across ${roots.length} frames. Validating the structured snapshot size…`);

  if (propertyFallbackNodeCount) {
    warnings.push(`${propertyFallbackNodeCount} layer${propertyFallbackNodeCount === 1 ? " keeps" : "s keep"} its ID, name, bounds, and hierarchy, but some Figma properties were unavailable.`);
  }

  const renderScale = 2;
  const renderScaleFallbackFrameIds: string[] = [];
  const sourceMetadata: DraftSnapshot["sourceMetadata"] = {
    sourceTool: "figma",
    sourceFileId,
    sourceRevisionId: null,
    sourcePageId: scope === "file" ? null : pageCaptures[0]?.page.id ?? null,
    sourcePageName: scope === "file" ? null : pageCaptures[0]?.page.name ?? null,
    captureScope: scope === "file"
      ? "all top-level frames and components across all pages"
      : scope === "page"
        ? "all top-level frames and components on current page"
        : "selected frames and components",
    pageLayout,
    adapter: "asbir-figma-plugin",
    adapterVersion: "0.2.0",
    renderFormat: "image/png",
    renderScale,
    vectorSourcePreserved: false,
    vectorSourceFrameCount: 0,
    renderScaleFallbackFrameIds,
    propertyFallbackNodeCount,
    captureWarnings: warnings,
    layoutNote: "Figma auto-layout padding and spacing are source values. Margins are measured geometric distances to the immediate parent bounds; Figma does not define CSS margins.",
  };
  const payload: DraftSnapshot = {
    schemaVersion: 1,
    source: "figma",
    sourceFileId,
    sourceRevisionId: null,
    sourceFileName,
    capturedAt: new Date().toISOString(),
    canvasBounds: pageCanvasBounds(roots),
    frames: snapshotFrames,
    sourceMetadata,
  };
  const initialPayloadBytes = jsonByteLength(payload);
  if (initialPayloadBytes > maxStructuredPayloadBytes) throw structuredPayloadLimitError(initialPayloadBytes);

  const frameRenders: CaptureAssetBytes[] = [];
  const vectorRenders: CaptureAssetBytes[] = [];
  const vectorAssetKeys = new Set<string>();
  const maxRenderBytes = MAX_CAPTURE_ASSET_BYTES;
  let totalRenderBytes = 0;
  for (let offset = 0; offset < roots.length; offset += frameRenderBatchSize) {
    const batch = roots.slice(offset, offset + frameRenderBatchSize);
    for (const [batchIndex, entry] of batch.entries()) {
      const index = offset + batchIndex;
      const preferredScale = entry.rect.width * entry.rect.height <= 3_000_000 ? 2 : 1;
      if (index === 0 || (index + 1) % 10 === 0 || index === roots.length - 1) {
        report(`Rendering frame ${index + 1} of ${roots.length} at ${preferredScale}× with Figma…`);
      }
    }

    const preparedPngs = await Promise.all(batch.map(async (entry) => {
      const preferredScale = entry.rect.width * entry.rect.height <= 3_000_000 ? 2 : 1;
      try {
        return { entry, preferredScale, actualScale: preferredScale, png: await exportPng(entry.root, preferredScale), firstError: null, retryError: null };
      } catch (firstError) {
        if (preferredScale !== 2) {
          return { entry, preferredScale, actualScale: preferredScale, png: null, firstError, retryError: null };
        }
        try {
          return { entry, preferredScale, actualScale: 1, png: await exportPng(entry.root, 1), firstError, retryError: null };
        } catch (retryError) {
          return { entry, preferredScale, actualScale: 1, png: null, firstError, retryError };
        }
      }
    }));

    for (const prepared of preparedPngs) {
      const { entry, preferredScale } = prepared;
      const frameName = entry.root.name || "Untitled frame";
      if (prepared.firstError) {
        if (preferredScale !== 2) {
          const detail = prepared.firstError instanceof Error ? ` ${prepared.firstError.message}` : "";
          throw new Error(`Figma could not render “${frameName}” or validate its layer image.${detail}`);
        }
        if (!prepared.retryError && prepared.png) {
          report(`The 2× render for “${frameName}” failed. Retrying at 1× while preserving its inspectable layer data…`);
          renderScaleFallbackFrameIds.push(entry.root.id);
        } else {
          const firstDetail = prepared.firstError instanceof Error ? prepared.firstError.message : "The 2× export failed.";
          const retryDetail = prepared.retryError instanceof Error ? prepared.retryError.message : "The 1× export failed.";
          throw new Error(`Figma could not render “${frameName}” at 2× or 1×. ${firstDetail} ${retryDetail}`);
        }
      } else if (preferredScale === 1) {
        renderScaleFallbackFrameIds.push(entry.root.id);
      }

      let png = prepared.png;
      let actualRenderScale = prepared.actualScale;
      if (!png) throw new Error(`Figma could not render “${frameName}” or validate its layer image.`);
      if (totalRenderBytes + png.byteLength > maxRenderBytes && actualRenderScale === 2) {
        report(`The 2× render for “${frameName}” exceeds the transfer budget. Retrying at 1×…`);
        const reducedPng = await exportPng(entry.root, 1).catch((error: unknown) => {
          const detail = error instanceof Error ? ` ${error.message}` : "";
          throw new Error(`Figma could not make a smaller pixel render for “${frameName}”.${detail}`);
        });
        if (totalRenderBytes + reducedPng.byteLength > maxRenderBytes) {
          throw renderTransferLimitError(totalRenderBytes + reducedPng.byteLength);
        }
        png = reducedPng;
        actualRenderScale = 1;
        renderScaleFallbackFrameIds.push(entry.root.id);
      }
      if (totalRenderBytes + png.byteLength > maxRenderBytes) {
        throw renderTransferLimitError(totalRenderBytes + png.byteLength);
      }
      totalRenderBytes += png.byteLength;
      frameRenders.push({
        key: entry.key,
        fileName: `${entry.key}.png`,
        contentType: "image/png",
        bytes: png,
        sourceX: entry.rect.x + entry.pageOffsetX,
        sourceY: entry.rect.y + entry.pageOffsetY,
        sourceWidth: entry.rect.width,
        sourceHeight: entry.rect.height,
        renderBounds: entry.renderRect,
      });
      try {
        const svg = await entry.root.exportAsync({
          format: "SVG_STRING",
          svgOutlineText: true,
          svgIdAttribute: true,
        });
        const vectorKey = `${entry.key}-vector`;
        const vectorBytes = encodeUtf8(svg);
        if (totalRenderBytes + vectorBytes.byteLength > maxRenderBytes) {
          report(`Skipping the SVG companion for “${frameName}” to stay within the capture transfer limit.`);
        } else {
          vectorRenders.push({
            key: vectorKey,
            fileName: `${entry.key}.svg`,
            contentType: "image/svg+xml",
            bytes: vectorBytes,
            sourceX: entry.rect.x + entry.pageOffsetX,
            sourceY: entry.rect.y + entry.pageOffsetY,
            sourceWidth: entry.rect.width,
            sourceHeight: entry.rect.height,
          });
          vectorAssetKeys.add(vectorKey);
          totalRenderBytes += vectorBytes.byteLength;
        }
      } catch {
        report(`Figma's SVG source is unavailable for “${frameName}”; the pixel render and layer data are retained.`);
      }
      if (totalRenderBytes > maxRenderBytes) {
        throw renderTransferLimitError(totalRenderBytes);
      }
    }
  }

  const selectedLayerCandidates = layerCandidates.sort(compareLayerExportCandidates);
  const layerRenders: LayerExportAssetBytes[] = [];
  let layerExportBytes = 0;
  let layerExportFailures = 0;
  let layerExportSizeSkips = Math.max(0, layerCandidateCount - selectedLayerCandidates.length);
  let transferBudgetReached = false;

  if (selectedLayerCandidates.length) report(`Preparing exports for up to ${selectedLayerCandidates.length} image and vector layers…`);
  for (let offset = 0; offset < selectedLayerCandidates.length; offset += layerExportBatchSize) {
    if (transferBudgetReached || layerExportBytes >= maxLayerExportBytes || totalRenderBytes >= maxRenderBytes) {
      layerExportSizeSkips += selectedLayerCandidates.length - offset;
      break;
    }
    const batch = selectedLayerCandidates.slice(offset, offset + layerExportBatchSize);
    report(`Exporting layer assets ${Math.min(offset + batch.length, selectedLayerCandidates.length)} of ${selectedLayerCandidates.length}…`);
    const results = await Promise.all(batch.map(async (candidate) => {
      const { node } = candidate.item;
      const rect = candidate.rect;
      const imageLayer = hasImageFill(node) || nodeProperty(node, "type") === "IMAGE";
      try {
        if (imageLayer) {
          return { candidate, rect, contentType: "image/png" as const, bytes: await exportPng(node, 1) };
        }
        const svg = await node.exportAsync({ format: "SVG_STRING", svgOutlineText: true, svgIdAttribute: true });
        if (typeof svg !== "string" || !/<svg\b/i.test(svg)) throw new Error("Figma returned an invalid SVG export.");
        return { candidate, rect, contentType: "image/svg+xml" as const, bytes: encodeUtf8(svg) };
      } catch {
        return null;
      }
    }));

    for (const result of results) {
      if (transferBudgetReached) {
        layerExportSizeSkips += 1;
        continue;
      }
      if (!result) {
        layerExportFailures += 1;
        continue;
      }
      if (result.bytes.byteLength === 0 || result.bytes.byteLength > maxSingleLayerExportBytes || layerExportBytes + result.bytes.byteLength > maxLayerExportBytes) {
        layerExportSizeSkips += 1;
        continue;
      }
      if (totalRenderBytes + result.bytes.byteLength > maxRenderBytes) {
        layerExportSizeSkips += 1;
        transferBudgetReached = true;
        continue;
      }

      const assetIndex = layerRenders.length + 1;
      const slug = assetNameSlug(result.candidate.name);
      const key = `layer-${String(assetIndex).padStart(4, "0")}-${slug}`;
      const extension = result.contentType === "image/png" ? "png" : "svg";
      const asset: LayerExportAssetBytes = {
        key,
        fileName: `${String(assetIndex).padStart(4, "0")}-${slug}.${extension}`,
        contentType: result.contentType,
        bytes: result.bytes,
        sourceX: result.rect.x,
        sourceY: result.rect.y,
        sourceWidth: result.rect.width,
        sourceHeight: result.rect.height,
        sourceFrameId: result.candidate.entry.root.id,
        sourceNodeId: result.candidate.sourceNodeId,
      };
      const frame = snapshotFrames.find((item) => item.sourceFrameId === asset.sourceFrameId);
      const snapshotNode = frame?.nodes.find((item) => item.sourceNodeId === asset.sourceNodeId);
      if (!snapshotNode) {
        layerExportFailures += 1;
        continue;
      }
      snapshotNode.sourcePayload.layerExportAssetKey = asset.key;
      snapshotNode.sourcePayload.layerExportContentType = asset.contentType;
      layerRenders.push(asset);
      layerExportBytes += asset.bytes.byteLength;
      totalRenderBytes += asset.bytes.byteLength;
    }
    if (transferBudgetReached) {
      layerExportSizeSkips += selectedLayerCandidates.length - offset - batch.length;
      break;
    }
  }

  sourceMetadata.layerExportAssetCount = layerRenders.length;
  sourceMetadata.layerExportSkippedCount = layerExportFailures + layerExportSizeSkips;
  if (layerExportFailures) warnings.push(`${layerExportFailures} individual layer export${layerExportFailures === 1 ? " was" : "s were"} unavailable. Frame renders and inspectable properties were retained.`);
  if (layerExportSizeSkips) warnings.push(`${layerExportSizeSkips} individual layer export${layerExportSizeSkips === 1 ? " was" : "s were"} skipped to keep the capture within size and performance limits.`);

  for (const frame of snapshotFrames) {
    const vectorKey = `${frame.renderAssetKey}-vector`;
    if (vectorAssetKeys.has(vectorKey)) frame.vectorAssetKey = vectorKey;
  }

  sourceMetadata.vectorSourcePreserved = vectorRenders.length === roots.length;
  sourceMetadata.vectorSourceFrameCount = vectorRenders.length;
  const finalPayloadBytes = jsonByteLength(payload);
  if (finalPayloadBytes > maxStructuredPayloadBytes) throw structuredPayloadLimitError(finalPayloadBytes);
  return { payload, renders: frameRenders, vectorRenders, layerRenders, warnings };
}
