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
