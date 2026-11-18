export type OverviewRect = { x: number; y: number; width: number; height: number };

/**
 * A CSS `clip-path` that shows only the given rectangles of the overview image.
 *
 * The overview is a single picture of every screen. Screens removed later, or old pixels a
 * page merge painted over, would otherwise stay visible in it; clipping to the version's
 * current screens keeps the picture in step with the screen list.
 */
export function overviewClipPath(rects: readonly OverviewRect[] | undefined) {
  if (!rects) return undefined;
  const commands = rects.flatMap((rect) => {
    if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) return [];
    const round = (value: number) => Math.round(value * 100) / 100;
    // Same winding for every rectangle, so overlaps stay visible under the nonzero rule.
    return [`M${round(rect.x)} ${round(rect.y)}h${round(rect.width)}v${round(rect.height)}h${round(-rect.width)}Z`];
  });
  return commands.length ? `path(nonzero, "${commands.join("")}")` : "inset(50%)";
}
