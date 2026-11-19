"use client";

import { memo, useCallback, useEffect, useState } from "react";
import { RetryingCanvasImage } from "./RetryingImage";
import type { CanvasFrameOption } from "./FrameNavigator";
import { canvasImageVariantSrc, pickCanvasImageSize, type CanvasImageSize } from "./canvas-screen-culling";

/** The canvas colour behind the dot grid (.review-dot-grid). */
const canvasBackground = "var(--background)";

type Props = {
  /** Only the screens near the viewport. */
  screens: readonly CanvasFrameOption[];
  originX: number;
  originY: number;
  /** Cover the soft overview behind each loaded screen (see below). */
  backdrops: boolean;
  /** How far, in canvas pixels, a backdrop reaches past its screen's edge. */
  bleed: number;
  /** From resolutionNeed(): captured pixels needed per canvas pixel at this zoom. */
  need: number;
};

/**
 * The sharp per-screen images of an overview. Memoised so panning (which only moves the parent)
 * doesn't re-render them; they change only when the screens in view or the zoom tier change.
 *
 * Sharp screen images sit on top of the overview image, which is soft when zoomed in. Where a
 * screen is transparent (text with no fill, its edges) the soft copy would show through as a glow,
 * so each screen gets a backdrop in the canvas colour once its sharp image has loaded.
 */
export const CanvasScreenImages = memo(function CanvasScreenImages({ screens, originX, originY, backdrops, bleed, need }: Props) {
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(() => new Set());
  // The largest size each screen has been drawn at. Zooming back out keeps it (it's cached) rather
  // than fetching a smaller copy.
  const [drawnSizes, setDrawnSizes] = useState<ReadonlyMap<string, CanvasImageSize>>(() => new Map());
  const sizeFor = (screen: CanvasFrameOption) =>
    Math.max(drawnSizes.get(screen.id) ?? 0, pickCanvasImageSize(need, screen)) as CanvasImageSize;

  useEffect(() => {
    setDrawnSizes((current) => {
      let next: Map<string, CanvasImageSize> | null = null;
      for (const screen of screens) {
        const size = pickCanvasImageSize(need, screen);
        if (size > (current.get(screen.id) ?? 0)) (next ??= new Map(current)).set(screen.id, size);
      }
      return next ?? current;
    });
    // A screen that left the view is unmounted; forget it was loaded so it doesn't get a backdrop
    // before its image is back on screen.
    setLoaded((current) => {
      const ids = new Set(screens.map((screen) => screen.id));
      let changed = false;
      const next = new Set<string>();
      for (const id of current) {
        if (ids.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : current;
    });
  }, [need, screens]);

  const markLoaded = useCallback((id: string) => {
    setLoaded((current) => (current.has(id) ? current : new Set(current).add(id)));
  }, []);

  return (
    <>
      {backdrops ? screens.map((screen) => loaded.has(screen.id) ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute"
          key={"backdrop:" + screen.id}
          style={{
            left: screen.sourceX - originX,
            top: screen.sourceY - originY,
            width: screen.sourceWidth,
            height: screen.sourceHeight,
            backgroundColor: canvasBackground,
            boxShadow: `0 0 0 ${bleed}px ${canvasBackground}`,
          }}
        />
      ) : null) : null}
      {screens.map((screen) => (
        <RetryingCanvasImage
          alt={(screen.fileName.toLowerCase().endsWith(".svg") ? "Figma vector render: " : "Frozen design render: ") + screen.name}
          className="pointer-events-none absolute select-none object-fill"
          decoding="async"
          draggable={false}
          height={screen.pixelHeight}
          key={screen.id}
          loading="eager"
          onLoad={() => markLoaded(screen.id)}
          src={canvasImageVariantSrc(screen, sizeFor(screen))}
          style={{
            left: screen.sourceX - originX,
            top: screen.sourceY - originY,
            width: screen.sourceWidth,
            height: screen.sourceHeight,
          }}
          unoptimized
          width={screen.pixelWidth}
        />
      ))}
    </>
  );
});
