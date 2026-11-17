import type { SnapshotNode } from "@asbir/snapshot-contract";

/** Geometry the canvas draws with: values only (units and provenance live in full details). */
export type CanvasBounds = Record<"x" | "y" | "width" | "height", { value: number | null }>;

/**
 * The slice of a captured element the canvas needs on first load: hit areas, outlines,
 * distance guides, search, and the screen's element list. Full details (layout, spacing,
 * typography, paints, raw Figma payload) load per screen when someone inspects it.
 *
 * A large Figma capture is ~100 MB as full nodes; summaries keep the first load small
 * without changing anything that is drawn on the canvas.
 */
export type CanvasNodeSummary = Pick<SnapshotNode, "sourceNodeId" | "parentSourceNodeId" | "sourceFrameId" | "name" | "type" | "visible"> & {
  bounds: CanvasBounds;
  typography: { content: string | null } | null;
  fills: Array<{ color: string | null }>;
  strokes: Array<{ color: string | null }>;
  tokens: Array<{ name: string; value: SnapshotNode["tokens"][number]["value"] }>;
  /** Only on a screen's root node: the captured Figma layout grids drawn by the Grid toggle. */
  layoutGrids?: unknown;
};

function compactMeasurement(measurement: SnapshotNode["bounds"]["x"]) {
  return { value: measurement.value };
}

/**
 * Overview hit areas for every screen, in canvas coordinates. Built in the browser from the
 * screen summaries (a screen's sourceX/Y already includes its page offset) instead of
 * shipping a second copy of every element.
 */
export function buildOverviewOverlayFromScreens(
  screens: ReadonlyArray<{ id: string; sourceX: number; sourceY: number; nodes: readonly CanvasNodeSummary[] }>,
) {
  return screens.flatMap((screen) => screen.nodes.map((node) => ({
    sourceNodeId: node.sourceNodeId,
    sourceFrameId: screen.id,
    name: node.name,
    type: node.type,
    visible: node.visible,
    bounds: {
      x: { value: node.bounds.x.value === null ? null : node.bounds.x.value + screen.sourceX },
      y: { value: node.bounds.y.value === null ? null : node.bounds.y.value + screen.sourceY },
      width: node.bounds.width,
      height: node.bounds.height,
    },
  })));
}

export function summarizeCanvasNode(node: SnapshotNode, frameId: string): CanvasNodeSummary {
  const summary: CanvasNodeSummary = {
    sourceNodeId: node.sourceNodeId,
    parentSourceNodeId: node.parentSourceNodeId,
    sourceFrameId: node.sourceFrameId,
    name: node.name,
    type: node.type,
    visible: node.visible,
    bounds: {
      x: compactMeasurement(node.bounds.x),
      y: compactMeasurement(node.bounds.y),
      width: compactMeasurement(node.bounds.width),
      height: compactMeasurement(node.bounds.height),
    },
    typography: node.typography ? { content: node.typography.content } : null,
    fills: node.fills.flatMap((paint) => paint.color ? [{ color: paint.color }] : []),
    strokes: node.strokes.flatMap((paint) => paint.color ? [{ color: paint.color }] : []),
    tokens: node.tokens.map((token) => ({ name: token.name, value: token.value })),
  };
  if (node.sourceNodeId === frameId && node.sourcePayload.layoutGrids !== undefined) {
    summary.layoutGrids = node.sourcePayload.layoutGrids;
  }
  return summary;
}

/**
 * A summary as one flat array, for the page payload. A large capture has tens of thousands of
 * elements, and repeating every key (`{"bounds":{"x":{"value":…}}}`…) made up about a third of the
 * review page, slowing the server render and the browser's first parse. `unpackCanvasNodes` rebuilds
 * the exact same summaries, so nothing that reads them changes.
 *
 * [id, parentId, frameId (0 = the screen's own id), name, type, visible (1/0), x, y, width, height,
 *  typography (0 = none, else its content), fill colors, stroke colors, [token name, value][],
 *  layout grids (only when the summary has them)]
 */
export type PackedCanvasNode = [
  string, string | null, string | 0, string, string, 0 | 1,
  number | null, number | null, number | null, number | null,
  0 | string | null, string[], string[], Array<[string, unknown]>, ...unknown[],
];

export function packCanvasNodes(nodes: readonly CanvasNodeSummary[], frameId: string): PackedCanvasNode[] {
  return nodes.map((node) => {
    const packed: PackedCanvasNode = [
      node.sourceNodeId,
      node.parentSourceNodeId,
      node.sourceFrameId === frameId ? 0 : node.sourceFrameId,
      node.name,
      node.type,
      node.visible ? 1 : 0,
      node.bounds.x.value,
      node.bounds.y.value,
      node.bounds.width.value,
      node.bounds.height.value,
      node.typography ? node.typography.content : 0,
      node.fills.map((fill) => fill.color as string),
      node.strokes.map((stroke) => stroke.color as string),
      node.tokens.map((token) => [token.name, token.value]),
    ];
    if ("layoutGrids" in node) packed.push(node.layoutGrids);
    return packed;
  });
}

export function unpackCanvasNodes(packed: readonly PackedCanvasNode[], frameId: string): CanvasNodeSummary[] {
  return packed.map((entry) => {
    const [id, parentId, nodeFrameId, name, type, visible, x, y, width, height, typography, fills, strokes, tokens] = entry;
    const summary: CanvasNodeSummary = {
      sourceNodeId: id,
      parentSourceNodeId: parentId,
      sourceFrameId: nodeFrameId === 0 ? frameId : nodeFrameId,
      name,
      type: type as CanvasNodeSummary["type"],
      visible: visible === 1,
      bounds: { x: { value: x }, y: { value: y }, width: { value: width }, height: { value: height } },
      typography: typography === 0 ? null : { content: typography },
      fills: fills.map((color) => ({ color })),
      strokes: strokes.map((color) => ({ color })),
      tokens: tokens.map(([tokenName, value]) => ({ name: tokenName, value: value as CanvasNodeSummary["tokens"][number]["value"] })),
    };
    if (entry.length > 14) summary.layoutGrids = entry[14];
    return summary;
  });
}
