"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { showToast } from "@/src/components/shell/Toaster";
import type { CanvasFrameOption } from "./FrameNavigator";
import type { CanvasLayerView, CanvasPagePoint, CanvasPointerTool } from "./CanvasViewport";
import { describePick, screenPalette, toHex, type Rgba } from "./eyedropper-colors";
import { loadScreenImage } from "./screen-image";

/** The topmost screen under a page point. */
export function screenAt(screens: readonly CanvasFrameOption[], point: CanvasPagePoint) {
  for (let index = screens.length - 1; index >= 0; index -= 1) {
    const screen = screens[index];
    if (point.x >= screen.sourceX && point.y >= screen.sourceY && point.x < screen.sourceX + screen.sourceWidth && point.y < screen.sourceY + screen.sourceHeight) return screen;
  }
  return null;
}

let sampler: CanvasRenderingContext2D | null = null;

/** Reads one pixel of the screen's captured image, drawn into a 1×1 canvas so tall screens cost nothing extra. */
async function samplePixel(screen: CanvasFrameOption, point: CanvasPagePoint): Promise<Rgba | null> {
  const image = await loadScreenImage(screen);
  const width = image.naturalWidth || screen.pixelWidth;
  const height = image.naturalHeight || screen.pixelHeight;
  const x = Math.floor(((point.x - screen.sourceX) / screen.sourceWidth) * width);
  const y = Math.floor(((point.y - screen.sourceY) / screen.sourceHeight) * height);
  if (x < 0 || y < 0 || x >= width || y >= height) return null;
  if (!sampler) {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    sampler = canvas.getContext("2d", { willReadFrequently: true });
  }
  if (!sampler) return null;
  sampler.clearRect(0, 0, 1, 1);
  sampler.drawImage(image, x, y, 1, 1, 0, 0, 1, 1);
  const [r, g, b, alpha] = sampler.getImageData(0, 0, 1, 1).data;
  return { r, g, b, a: alpha / 255 };
}

type Hover = { point: CanvasPagePoint; hex: string };

/**
 * The eyedropper: hover shows the colour under the pointer, a click copies its hex and says which
 * token (or captured colour) it matches, so people can check a colour on image-only screens too.
 */
export function useCanvasEyedropper(screens: readonly CanvasFrameOption[], active: boolean) {
  const [hover, setHover] = useState<Hover | null>(null);
  const pending = useRef(0);
  const palettes = useRef(new Map<string, ReturnType<typeof screenPalette>>());

  const sample = useCallback(async (point: CanvasPagePoint) => {
    const screen = screenAt(screens, point);
    if (!screen) return null;
    const rgba = await samplePixel(screen, point).catch(() => null);
    return rgba ? { screen, rgba } : null;
  }, [screens]);

  const pointerTool = useMemo<CanvasPointerTool | null>(() => active ? {
    cursor: "crosshair",
    onMove: (point) => {
      const ticket = ++pending.current;
      void sample(point).then((result) => {
        if (ticket !== pending.current) return;
        setHover(result ? { point, hex: toHex({ ...result.rgba, a: 1 }) } : null);
      });
    },
    onLeave: () => {
      pending.current += 1;
      setHover(null);
    },
    onUp: (point) => {
      void sample(point).then((result) => {
        if (!result) {
          showToast("Pick a colour on a screen");
          return;
        }
        let palette = palettes.current.get(result.screen.id);
        if (!palette) {
          palette = screenPalette(result.screen.nodes);
          palettes.current.set(result.screen.id, palette);
        }
        const { hex, detail } = describePick(result.rgba, palette);
        navigator.clipboard?.writeText(hex).then(
          () => showToast(`Copied ${hex} · ${detail}`),
          () => showToast(`${hex} · ${detail}`),
        );
      });
    },
  } : null, [active, sample]);

  const overlay = useCallback((view: CanvasLayerView) => {
    if (!active || !hover) return null;
    return (
      <div
        aria-hidden="true"
        className="pointer-events-none absolute z-40 flex items-center gap-1.5 rounded-full border border-white/15 bg-[#151515]/95 py-1 pl-1 pr-2.5 font-mono text-[11px] text-white shadow-lg"
        style={{
          left: hover.point.x - view.originX,
          top: hover.point.y - view.originY,
          transform: `translate(${14 * view.inverseScale}px, ${14 * view.inverseScale}px) scale(${view.inverseScale})`,
          transformOrigin: "top left",
        }}
      >
        <span className="size-4 rounded-full border border-white/30" style={{ backgroundColor: hover.hex }} />
        {hover.hex}
      </div>
    );
  }, [active, hover]);

  return { pointerTool, overlay };
}
