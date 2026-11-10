import type { CanvasOverlayNode } from "./FrameNavigator";

type VisibleCanvasOverlayInput = {
  nodes: readonly CanvasOverlayNode[];
  frameWidth: number;
  frameHeight: number;
  frameOriginX?: number;
  frameOriginY?: number;
  viewportWidth: number;
  viewportHeight: number;
  offsetX: number;
  offsetY: number;
  scale: number;
  minimumTargetSize?: number;
  selectedNodeId?: string | null;
  highlightedNodeIds?: readonly string[];
};

export function getVisibleCanvasOverlayNodes(input: VisibleCanvasOverlayInput) {
  const {
    nodes,
    frameWidth,
    frameHeight,
    frameOriginX = 0,
    frameOriginY = 0,
    viewportWidth,
    viewportHeight,
    offsetX,
    offsetY,
    scale,
    minimumTargetSize = 8,
    selectedNodeId = null,
    highlightedNodeIds = [],
  } = input;

  if (
    !Number.isFinite(scale) || scale <= 0 ||
    !Number.isFinite(frameWidth) || frameWidth <= 0 ||
    !Number.isFinite(frameHeight) || frameHeight <= 0 ||
    !Number.isFinite(viewportWidth) || viewportWidth <= 0 ||
    !Number.isFinite(viewportHeight) || viewportHeight <= 0
  ) return [];

  const visibleBounds = {
    left: frameWidth / 2 + (-viewportWidth / 2 - offsetX) / scale,
    right: frameWidth / 2 + (viewportWidth / 2 - offsetX) / scale,
    top: frameHeight / 2 + (-viewportHeight / 2 - offsetY) / scale,
    bottom: frameHeight / 2 + (viewportHeight / 2 - offsetY) / scale,
  };
  const highlighted = new Set(highlightedNodeIds);

  return nodes.filter((node) => {
    if (!node.visible) return false;

    const sourceX = node.bounds.x.value;
    const sourceY = node.bounds.y.value;
    const width = node.bounds.width.value;
    const height = node.bounds.height.value;
    if (
      sourceX === null || sourceY === null || width === null || height === null ||
      !Number.isFinite(sourceX) || !Number.isFinite(sourceY) ||
      !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0
    ) return false;

    const x = sourceX - frameOriginX;
    const y = sourceY - frameOriginY;
    if (
      x + width < visibleBounds.left || x > visibleBounds.right ||
      y + height < visibleBounds.top || y > visibleBounds.bottom
    ) return false;

    const explicitlyEmphasized = node.sourceNodeId === selectedNodeId || highlighted.has(node.sourceNodeId);
    return explicitlyEmphasized || (width * scale >= minimumTargetSize && height * scale >= minimumTargetSize);
  });
}
