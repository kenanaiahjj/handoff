import type { SnapshotNode } from "@asbir/snapshot-contract";
import { typographyFromTextSegments } from "@asbir/snapshot-contract";
import type { SnapshotDiffChange } from "./diff";

/**
 * Developer-facing shapes for the MCP tools: diffs grouped by what a builder acts on, searchable
 * element reads, one focused element read, screen warnings and component → code mapping keys.
 */

type Measurement = { value: unknown; unit?: unknown };

function isMeasurement(value: unknown): value is Measurement {
  return typeof value === "object" && value !== null && "value" in value && Object.keys(value).every((key) => ["value", "unit", "provenance", "sourceProperty"].includes(key));
}

/** A captured value in its plain form: 54 (px), "#FF0000", "Inter", or the object as is. */
export function plainValue(value: unknown): unknown {
  if (value === undefined) return "removed";
  if (isMeasurement(value)) {
    const unit = typeof value.unit === "string" ? value.unit.toUpperCase() : "PX";
    if (unit === "AUTO") return "auto";
    if (value.value === null || value.value === undefined) return null;
    if (unit === "PERCENT" || unit === "%") return `${String(value.value)}%`;
    if (unit === "PX" || unit === "PIXELS") return value.value;
    return `${String(value.value)}${String(value.unit).toLowerCase()}`;
  }
  if (Array.isArray(value)) return value.map(plainValue);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, plainValue(entry)]));
  }
  return value;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function boundsOf(node: Pick<SnapshotNode, "bounds" | "layoutBounds">) {
  const bounds = (node.layoutBounds ?? node.bounds) as Record<string, unknown>;
  const read = (key: string) => {
    const entry = bounds[key];
    const value = isMeasurement(entry) ? entry.value : entry;
    return typeof value === "number" ? round(value) : null;
  };
  return { x: read("x"), y: read("y"), width: read("width"), height: read("height") };
}

function textOf(node: SnapshotNode) {
  const typography = typographyFromTextSegments(node.typography, node.sourcePayload);
  return typeof typography?.content === "string" ? typography.content : null;
}

/** For implementation links: an instance maps through its main component, anything else by its own id. */
export function componentIdentity(node: Pick<SnapshotNode, "sourceNodeId" | "name" | "type" | "sourcePayload">) {
  const payload = node.sourcePayload as Record<string, unknown>;
  if (typeof payload.mainComponentId === "string" && payload.mainComponentId) {
    return { componentId: payload.mainComponentId, componentName: typeof payload.mainComponentName === "string" ? payload.mainComponentName : node.name, kind: "instance" as const };
  }
  if (node.type === "COMPONENT" || node.type === "COMPONENT_SET") {
    return { componentId: node.sourceNodeId, componentName: node.name, kind: "component" as const };
  }
  return null;
}

type ElementRef = { id: string; name: string; type: string };

/** Diff paths in a builder's words: `layoutBounds.y.value` → `y`, `sourcePayload.characters` → `text`. */
export function friendlyField(path: string) {
  const cleaned = path.replace(/\.value$/, "").replace(/\.value\./g, ".");
  if (cleaned === "sourcePayload.characters") return "text";
  if (cleaned.startsWith("layoutBounds.")) return cleaned.slice("layoutBounds.".length);
  if (cleaned.startsWith("bounds.")) return `screen ${cleaned.slice("bounds.".length)}`;
  if (cleaned.startsWith("sourcePayload.")) return `figma.${cleaned.slice("sourcePayload.".length)}`;
  return cleaned;
}

export type ScreenChangeSummary = {
  counts: { removed: number; added: number; moved: number; edited: number; screenOnly: number };
  /** Whole layers that disappeared; their children are counted, not listed. */
  removed: Array<ElementRef & { bounds: ReturnType<typeof boundsOf>; text: string | null; childCount: number }>;
  added: Array<ElementRef & { bounds: ReturnType<typeof boundsOf>; text: string | null; childCount: number }>;
  moved: Array<ElementRef & { from: unknown; to: unknown }>;
  /** One entry per layer with every field that changed, as `field: before → after`. */
  edited: Array<ElementRef & { changes: Array<{ field: string; from: unknown; to: unknown; category: string }> }>;
  /** Changes that aren't about one layer (the screenshot itself, capture differences). */
  screen: Array<{ field: string; from: unknown; to: unknown; category: string }>;
};

/**
 * Groups a screen's raw diff into what a builder acts on: a removed or added layer with all its
 * children is one entry, and each edited layer lists its fields as `from → to`.
 */
export function summarizeScreenChanges(changes: SnapshotDiffChange[], beforeNodes: SnapshotNode[], afterNodes: SnapshotNode[]): ScreenChangeSummary {
  const removedNodes = changes.filter((change) => change.path === "node" && change.after === undefined).map((change) => change.before as SnapshotNode);
  const addedNodes = changes.filter((change) => change.path === "node" && change.before === undefined).map((change) => change.after as SnapshotNode);

  const subtreeRoots = (nodes: SnapshotNode[]) => {
    const ids = new Set(nodes.map((node) => node.sourceNodeId));
    const childCount = new Map<string, number>();
    const rootOf = (node: SnapshotNode, byId: Map<string, SnapshotNode>) => {
      let current = node;
      while (current.parentSourceNodeId && ids.has(current.parentSourceNodeId)) {
        const parent = byId.get(current.parentSourceNodeId);
        if (!parent) break;
        current = parent;
      }
      return current;
    };
    const byId = new Map(nodes.map((node) => [node.sourceNodeId, node]));
    const roots: SnapshotNode[] = [];
    for (const node of nodes) {
      const root = rootOf(node, byId);
      if (root === node) roots.push(node);
      else childCount.set(root.sourceNodeId, (childCount.get(root.sourceNodeId) ?? 0) + 1);
    }
    return roots.map((node) => ({
      id: node.sourceNodeId,
      name: node.name,
      type: node.type,
      bounds: boundsOf(node),
      text: textOf(node),
      childCount: childCount.get(node.sourceNodeId) ?? 0,
    }));
  };

  const removed = subtreeRoots(removedNodes);
  const added = subtreeRoots(addedNodes);
  const nodeById = new Map([...beforeNodes, ...afterNodes].map((node) => [node.sourceNodeId, node]));

  const moved: ScreenChangeSummary["moved"] = [];
  const editedById = new Map<string, ScreenChangeSummary["edited"][number]>();
  const screen: ScreenChangeSummary["screen"] = [];
  for (const change of changes) {
    if (change.path === "node") continue;
    const node = change.sourceNodeId ? nodeById.get(change.sourceNodeId) : undefined;
    if (!change.sourceNodeId) {
      screen.push({ field: friendlyField(change.path), from: plainValue(change.before), to: plainValue(change.after), category: change.category });
      continue;
    }
    const ref = { id: change.sourceNodeId, name: change.sourceNodeName ?? node?.name ?? change.sourceNodeId, type: node?.type ?? "UNKNOWN" };
    if (change.path === "parent") {
      moved.push({ ...ref, from: change.before, to: change.after });
      continue;
    }
    const entry = editedById.get(ref.id) ?? { ...ref, changes: [] };
    entry.changes.push({ field: friendlyField(change.path), from: plainValue(change.before), to: plainValue(change.after), category: change.category });
    editedById.set(ref.id, entry);
  }
  const edited = [...editedById.values()].sort((a, b) => b.changes.length - a.changes.length);
  return {
    counts: { removed: removed.length, added: added.length, moved: moved.length, edited: edited.length, screenOnly: screen.length },
    removed,
    added,
    moved,
    edited,
    screen,
  };
}

export const elementFields = ["bounds", "layout", "spacing", "typography", "fills", "strokes", "styles", "tokens", "component", "text", "raw"] as const;
export type ElementField = (typeof elementFields)[number];

export type ElementFilter = { query?: string; type?: string; ids?: string[]; visibleOnly?: boolean; parentId?: string };

/** Filters a screen's layers by name or text (case-insensitive), type, ids or parent. */
export function filterElements(nodes: SnapshotNode[], filter: ElementFilter) {
  const query = filter.query?.trim().toLowerCase();
  const type = filter.type?.trim().toUpperCase();
  const ids = filter.ids?.length ? new Set(filter.ids) : null;
  return nodes.filter((node) => {
    if (ids && !ids.has(node.sourceNodeId)) return false;
    if (type && node.type.toUpperCase() !== type) return false;
    if (filter.visibleOnly && !node.visible) return false;
    if (filter.parentId && node.parentSourceNodeId !== filter.parentId) return false;
    if (query) {
      const text = textOf(node)?.toLowerCase() ?? "";
      if (!node.name.toLowerCase().includes(query) && !text.includes(query) && node.sourceNodeId.toLowerCase() !== query) return false;
    }
    return true;
  });
}

/** One layer with only the requested fields (id, name, type and parent are always included). */
export function pickElementFields(node: SnapshotNode, fields: readonly ElementField[]) {
  const out: Record<string, unknown> = { id: node.sourceNodeId, parentId: node.parentSourceNodeId, name: node.name, type: node.type, visible: node.visible };
  for (const field of fields) {
    if (field === "bounds") { out.bounds = boundsOf(node); out.screenBounds = plainValue(node.bounds); }
    if (field === "layout") { out.layout = node.layout; out.padding = plainValue(node.padding); }
    if (field === "spacing") { out.spacing = plainValue(node.spacing); out.margins = plainValue(node.margins); }
    if (field === "typography") out.typography = plainValue(typographyFromTextSegments(node.typography, node.sourcePayload));
    if (field === "text") out.text = textOf(node);
    if (field === "fills") out.fills = plainValue(node.fills);
    if (field === "strokes") out.strokes = plainValue(node.strokes);
    if (field === "styles") out.styles = node.styleReferences;
    if (field === "tokens") out.tokens = node.tokens.map((token) => ({ name: token.name, category: token.category ?? null, bindingPath: token.bindingPath ?? null, collection: token.collectionName, mode: token.mode, value: token.value }));
    if (field === "component") out.component = componentIdentity(node);
    if (field === "raw") { out.layoutBounds = node.layoutBounds ?? null; out.sourcePayload = node.sourcePayload; }
  }
  return out;
}

/**
 * Everything a builder needs for one layer in one read: size and position, spacing, type, colours,
 * tokens, the component it comes from, and its parent chain with each parent's layout.
 */
export function focusedElement(nodes: SnapshotNode[], node: SnapshotNode) {
  const byId = new Map(nodes.map((candidate) => [candidate.sourceNodeId, candidate]));
  const ancestors: Array<Record<string, unknown>> = [];
  let parentId = node.parentSourceNodeId;
  while (parentId && ancestors.length < 12) {
    const parent = byId.get(parentId);
    if (!parent) break;
    ancestors.push({
      id: parent.sourceNodeId,
      name: parent.name,
      type: parent.type,
      bounds: boundsOf(parent),
      layout: { mode: parent.layout.mode, direction: parent.layout.direction, primaryAxisAlign: parent.layout.primaryAxisAlign, counterAxisAlign: parent.layout.counterAxisAlign, wrap: parent.layout.wrap },
      padding: plainValue(parent.padding),
      gap: plainValue(parent.spacing),
      component: componentIdentity(parent),
    });
    parentId = parent.parentSourceNodeId;
  }
  const children = nodes.filter((candidate) => candidate.parentSourceNodeId === node.sourceNodeId);
  const siblings = node.parentSourceNodeId ? nodes.filter((candidate) => candidate.parentSourceNodeId === node.parentSourceNodeId) : [];
  return {
    ...pickElementFields(node, elementFields.filter((field) => field !== "raw")),
    constraints: node.layout.constraints,
    siblingIndex: siblings.findIndex((candidate) => candidate.sourceNodeId === node.sourceNodeId),
    siblingCount: siblings.length,
    children: children.slice(0, 50).map((child) => ({ id: child.sourceNodeId, name: child.name, type: child.type, bounds: boundsOf(child), text: textOf(child) })),
    childCount: children.length,
    ancestors,
  };
}

type FrameLike = { sourceFrameId: string; name: string; bounds?: unknown; renderBounds?: unknown; renderAssetKey: string };
type AssetLike = { assetKey: string; width: number | null; height: number | null };

export type ScreenWarning =
  | { kind: "duplicate-name"; name: string; frameIds: string[]; message: string }
  | { kind: "render-size-mismatch"; frameId: string; name: string; expected: { width: number; height: number }; actual: { width: number; height: number }; message: string };

/** Screens that share a name (ambiguous to ask about) and screenshots whose size doesn't match the screen. */
export function screenWarnings(frames: FrameLike[], assets: AssetLike[]): ScreenWarning[] {
  const warnings: ScreenWarning[] = [];
  const byName = new Map<string, string[]>();
  for (const frame of frames) byName.set(frame.name, [...(byName.get(frame.name) ?? []), frame.sourceFrameId]);
  for (const [name, frameIds] of byName) {
    if (frameIds.length > 1) warnings.push({ kind: "duplicate-name", name, frameIds, message: `${frameIds.length} screens are named "${name}". Refer to them by frameId.` });
  }
  const assetByKey = new Map(assets.map((asset) => [asset.assetKey, asset]));
  for (const frame of frames) {
    const asset = assetByKey.get(frame.renderAssetKey);
    const bounds = (frame.renderBounds ?? frame.bounds) as Record<string, unknown> | undefined;
    const read = (key: string) => { const entry = bounds?.[key]; const value = isMeasurement(entry) ? entry.value : entry; return typeof value === "number" ? value : null; };
    const width = read("width");
    const height = read("height");
    if (!asset?.width || !asset.height || !width || !height) continue;
    // Renders are exported at a scale (often 2x); compare at that scale.
    const scale = asset.width / width;
    const expectedHeight = Math.round(height * scale);
    if (Math.abs(expectedHeight - asset.height) >= 1) {
      warnings.push({
        kind: "render-size-mismatch",
        frameId: frame.sourceFrameId,
        name: frame.name,
        expected: { width: asset.width, height: expectedHeight },
        actual: { width: asset.width, height: asset.height },
        message: `The screenshot of "${frame.name}" is ${asset.width}×${asset.height}px but the screen measures ${round(width)}×${round(height)} (expected ${asset.width}×${expectedHeight} at ${round(scale)}x). Trust measurements over the screenshot for exact sizes.`,
      });
    }
  }
  return warnings;
}
