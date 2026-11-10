import type { SnapshotFrame } from "@asbir/snapshot-contract";
import type { CanvasOverlayNode } from "./FrameNavigator";

export function buildOverviewOverlayNodes(
  frames: readonly Pick<SnapshotFrame, "sourceFrameId" | "bounds" | "nodes" | "sourcePageId">[],
  pageOffsets: ReadonlyMap<string, { offsetX: number; offsetY: number }> = new Map(),
): CanvasOverlayNode[] {
  return frames.flatMap((frame) => frame.nodes.map((node) => {
    const pageOffset = frame.sourcePageId ? pageOffsets.get(frame.sourcePageId) : undefined;
    return {
      sourceNodeId: node.sourceNodeId,
      sourceFrameId: frame.sourceFrameId,
      name: node.name,
      type: node.type,
      visible: node.visible,
      bounds: {
        ...node.bounds,
        x: {
          ...node.bounds.x,
          value: node.bounds.x.value === null || frame.bounds.x.value === null
            ? null
            : node.bounds.x.value + frame.bounds.x.value + (pageOffset?.offsetX ?? 0),
        },
        y: {
          ...node.bounds.y,
          value: node.bounds.y.value === null || frame.bounds.y.value === null
            ? null
            : node.bounds.y.value + frame.bounds.y.value + (pageOffset?.offsetY ?? 0),
        },
      },
    };
  }));
}
