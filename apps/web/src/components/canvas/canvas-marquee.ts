/** A drag-to-select box, in the canvas layer's own units (the overview's coordinates). */
export type MarqueeRect = { x: number; y: number; width: number; height: number };

type ScreenBox = { id: string; sourceX: number; sourceY: number; sourceWidth: number; sourceHeight: number };

/** The box between where the drag started and where the pointer is now, whichever way it was dragged. */
export function marqueeRect(start: { x: number; y: number }, end: { x: number; y: number }): MarqueeRect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

/**
 * The screens the box touches, in the order given. As in Figma, a screen only has to overlap the box,
 * not sit fully inside it. `origin` is the overview's top-left in source coordinates.
 */
export function screensInMarquee(rect: MarqueeRect, screens: ScreenBox[], origin: { x: number; y: number }): string[] {
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  return screens
    .filter((screen) => {
      const left = screen.sourceX - origin.x;
      const top = screen.sourceY - origin.y;
      return left < right && left + screen.sourceWidth > rect.x && top < bottom && top + screen.sourceHeight > rect.y;
    })
    .map((screen) => screen.id);
}

/**
 * What a finished drag selects. A plain drag replaces the selection; with Shift (or ⌘/Ctrl) the boxed
 * screens are added to what was already selected, so separate groups can be gathered.
 */
export function mergeMarqueeSelection(previous: ReadonlySet<string>, boxed: string[], additive: boolean): Set<string> {
  return additive ? new Set([...previous, ...boxed]) : new Set(boxed);
}
