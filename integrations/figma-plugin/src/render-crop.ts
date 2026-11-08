export type RenderRect = { x: number; y: number; width: number; height: number };
export type PixelCrop = { x: number; y: number; width: number; height: number };

export function frameRenderCrop(
  frameBounds: RenderRect,
  renderBounds: RenderRect,
  pixelWidth: number,
  pixelHeight: number,
): PixelCrop | null {
  if (![...Object.values(frameBounds), ...Object.values(renderBounds), pixelWidth, pixelHeight]
    .every(Number.isFinite) ||
      frameBounds.width <= 0 || frameBounds.height <= 0 ||
      renderBounds.width <= 0 || renderBounds.height <= 0 ||
      pixelWidth <= 0 || pixelHeight <= 0) {
    return null;
  }

  const scaleX = pixelWidth / renderBounds.width;
  const scaleY = pixelHeight / renderBounds.height;
  const left = Math.round((frameBounds.x - renderBounds.x) * scaleX);
  const top = Math.round((frameBounds.y - renderBounds.y) * scaleY);
  const right = Math.round((frameBounds.x + frameBounds.width - renderBounds.x) * scaleX);
  const bottom = Math.round((frameBounds.y + frameBounds.height - renderBounds.y) * scaleY);
  const x = Math.max(0, Math.min(pixelWidth, left));
  const y = Math.max(0, Math.min(pixelHeight, top));
  const endX = Math.max(x, Math.min(pixelWidth, right));
  const endY = Math.max(y, Math.min(pixelHeight, bottom));
  const crop = { x, y, width: endX - x, height: endY - y };

  if (crop.width <= 0 || crop.height <= 0) return null;
  if (crop.x === 0 && crop.y === 0 && crop.width === pixelWidth && crop.height === pixelHeight) return null;
  return crop;
}
