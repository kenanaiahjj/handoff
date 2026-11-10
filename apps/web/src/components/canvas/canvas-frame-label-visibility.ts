export const MIN_CANVAS_FRAME_LABEL_ZOOM = 0.2;

export function shouldShowCanvasFrameLabel(scale: number, selected: boolean, screenCount = 0) {
  return selected || (screenCount <= 50 && scale >= MIN_CANVAS_FRAME_LABEL_ZOOM);
}

export function getCanvasFrameLabelMaxWidth(viewportWidth: number, scale: number) {
  const maxViewportWidth = Math.min(Math.max(viewportWidth, 0) * 0.8, 480);
  return maxViewportWidth / Math.max(scale, 0.01);
}
