/** Image sizes a raster screen can be drawn at, as a fraction of its captured pixels. */
export type CanvasImageSize = 1 | 0.5 | 0.25;

type ScreenBox = { id: string; sourceX: number; sourceY: number; sourceWidth: number; sourceHeight: number };

type CullInput = {
  /** The overview's own origin in Figma page coordinates. */
  frameSourceX: number;
  frameSourceY: number;
  frameWidth: number;
  frameHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  offsetX: number;
  offsetY: number;
  scale: number;
  /** Extra room around the viewport, as a fraction of its size, so panning doesn't reveal gaps. */
  margin?: number;
};

/**
 * The screens that overlap the viewport (plus a margin). The canvas is drawn centred in the
 * viewport and moved by `translate(offset) scale(scale)` around its centre, so a viewport edge
 * maps back to canvas pixels as frameSize/2 + (edge - viewportSize/2 - offset) / scale.
 */
export function screensInView<T extends ScreenBox>(screens: readonly T[], input: CullInput): T[] {
  const { frameSourceX, frameSourceY, frameWidth, frameHeight, viewportWidth, viewportHeight, offsetX, offsetY, scale, margin = 0.5 } = input;
  if (!(scale > 0) || !(viewportWidth > 0) || !(viewportHeight > 0) || ![offsetX, offsetY].every(Number.isFinite)) return [...screens];
  const padX = viewportWidth * margin;
  const padY = viewportHeight * margin;
  const left = frameWidth / 2 + (-viewportWidth / 2 - padX - offsetX) / scale;
  const right = frameWidth / 2 + (viewportWidth / 2 + padX - offsetX) / scale;
  const top = frameHeight / 2 + (-viewportHeight / 2 - padY - offsetY) / scale;
  const bottom = frameHeight / 2 + (viewportHeight / 2 + padY - offsetY) / scale;
  return screens.filter((screen) => {
    const x = screen.sourceX - frameSourceX;
    const y = screen.sourceY - frameSourceY;
    return x < right && x + screen.sourceWidth > left && y < bottom && y + screen.sourceHeight > top;
  });
}

/** Whether two screen lists hold the same screens in the same order. */
export function sameScreenIds(a: readonly { id: string }[], b: readonly { id: string }[]) {
  return a.length === b.length && a.every((screen, index) => screen.id === b[index].id);
}

/**
 * How many captured pixels each canvas pixel needs at this zoom, rounded up to a power of two so
 * the value (and the images picked from it) only changes when zoom roughly doubles.
 */
export function resolutionNeed(scale: number, devicePixelRatio: number) {
  const need = scale * (devicePixelRatio > 0 ? devicePixelRatio : 1);
  if (!(need > 0)) return 1;
  return 2 ** Math.ceil(Math.log2(need));
}

/** The smallest image size that still has enough pixels for a screen at this resolution need. */
export function pickCanvasImageSize(need: number, screen: { pixelWidth: number; sourceWidth: number }): CanvasImageSize {
  const density = screen.pixelWidth / Math.max(screen.sourceWidth, 1);
  const fraction = need / (density > 0 ? density : 1);
  if (fraction <= 0.25) return 0.25;
  if (fraction <= 0.5) return 0.5;
  return 1;
}

/** The URL for a screen at a size. Vectors and full size use the original; smaller ones a WebP copy. */
export function canvasImageVariantSrc(screen: { imageSrc: string; fileName: string }, size: CanvasImageSize) {
  if (size === 1 || screen.fileName.toLowerCase().endsWith(".svg")) return screen.imageSrc;
  return screen.imageSrc + (screen.imageSrc.includes("?") ? "&" : "?") + "size=" + (size === 0.5 ? "half" : "quarter");
}
