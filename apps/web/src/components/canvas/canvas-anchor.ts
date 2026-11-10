export const overviewCanvasFrameId = "__overview__";

export type CanvasAnchorFrame = {
  id: string;
  kind: "overview" | "frame";
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
};

export type CanvasAnchorPoint = {
  frameId: string;
  sourceNodeId: string | null;
  x: number;
  y: number;
};

export function canvasAnchorAtPoint(
  viewportFrame: CanvasAnchorFrame,
  screens: readonly CanvasAnchorFrame[],
  point: { x: number; y: number },
  sourceNodeId: string | null,
): CanvasAnchorPoint | null {
  if (
    !Number.isFinite(point.x) || !Number.isFinite(point.y) ||
    point.x < 0 || point.y < 0 ||
    point.x > viewportFrame.sourceWidth || point.y > viewportFrame.sourceHeight
  ) return null;

  const sourceX = viewportFrame.sourceX + point.x;
  const sourceY = viewportFrame.sourceY + point.y;
  const screen = screens.find((candidate) =>
    sourceX >= candidate.sourceX && sourceY >= candidate.sourceY &&
    sourceX <= candidate.sourceX + candidate.sourceWidth &&
    sourceY <= candidate.sourceY + candidate.sourceHeight,
  );

  if (screen) {
    return {
      frameId: screen.id,
      sourceNodeId,
      x: sourceX - screen.sourceX,
      y: sourceY - screen.sourceY,
    };
  }

  if (viewportFrame.kind !== "overview") return null;
  return {
    frameId: overviewCanvasFrameId,
    sourceNodeId: null,
    x: point.x,
    y: point.y,
  };
}

export function canvasAnchorToViewportPoint(
  anchor: CanvasAnchorPoint,
  viewportFrame: CanvasAnchorFrame,
  screens: readonly CanvasAnchorFrame[],
  overviewOrigin: { sourceX: number; sourceY: number },
): { x: number; y: number } | null {
  let sourceX: number;
  let sourceY: number;

  if (anchor.frameId === overviewCanvasFrameId) {
    sourceX = overviewOrigin.sourceX + anchor.x;
    sourceY = overviewOrigin.sourceY + anchor.y;
  } else {
    const screen = screens.find((candidate) => candidate.id === anchor.frameId);
    if (!screen) return null;
    sourceX = screen.sourceX + anchor.x;
    sourceY = screen.sourceY + anchor.y;
  }

  const x = sourceX - viewportFrame.sourceX;
  const y = sourceY - viewportFrame.sourceY;
  if (
    !Number.isFinite(x) || !Number.isFinite(y) ||
    x < 0 || y < 0 || x > viewportFrame.sourceWidth || y > viewportFrame.sourceHeight
  ) return null;
  return { x, y };
}
