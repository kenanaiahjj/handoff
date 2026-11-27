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
  /** Extra room around the viewport, as a fraction of its size on each side. */
  margin?: number;
  /** The zoom the minimum target size is judged at (defaults to `scale`). */
  targetScale?: number;
};

/** An area of the canvas in its own pixels (from the canvas's top-left). */
export type CanvasRegion = { left: number; right: number; top: number; bottom: number };

/** The part of the canvas the viewport shows, grown by `margin` of the viewport's size on each side. */
export function visibleCanvasRegion(input: {
  frameWidth: number;
  frameHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  offsetX: number;
  offsetY: number;
  scale: number;
  margin?: number;
}): CanvasRegion {
  const { frameWidth, frameHeight, viewportWidth, viewportHeight, offsetX, offsetY, scale, margin = 0 } = input;
  const padX = viewportWidth * margin;
  const padY = viewportHeight * margin;
  return {
    left: frameWidth / 2 + (-viewportWidth / 2 - padX - offsetX) / scale,
    right: frameWidth / 2 + (viewportWidth / 2 + padX - offsetX) / scale,
    top: frameHeight / 2 + (-viewportHeight / 2 - padY - offsetY) / scale,
    bottom: frameHeight / 2 + (viewportHeight / 2 + padY - offsetY) / scale,
  };
}

export function regionContains(outer: CanvasRegion, inner: CanvasRegion) {
  return inner.left >= outer.left && inner.right <= outer.right && inner.top >= outer.top && inner.bottom <= outer.bottom;
}

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

  const visibleBounds = visibleCanvasRegion({ frameWidth, frameHeight, viewportWidth, viewportHeight, offsetX, offsetY, scale, margin: input.margin });
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
    const targetScale = input.targetScale ?? scale;
    return explicitlyEmphasized || (width * targetScale >= minimumTargetSize && height * targetScale >= minimumTargetSize);
  });
}
