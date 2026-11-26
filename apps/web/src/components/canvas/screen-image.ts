import type { CanvasFrameOption } from "./FrameNavigator";
import { showToast } from "@/src/components/shell/Toaster";

/** In Figma page units (the same space as a screen's sourceX/sourceY). */
export type PageRect = { x: number; y: number; width: number; height: number };
/** A freehand stroke from Annotate mode, in Figma page units. */
export type MarkupStroke = { id: string; color: string; width: number; highlighter: boolean; points: Array<[number, number]> };

/** Largest image edge we draw, so a row of tall screens stays within what browsers and Slack accept. */
const maxEdge = 8000;

const imageCache = new Map<string, Promise<HTMLImageElement>>();

/** The screen's captured image, decoded once per page load (shared by copy, snapshot and the eyedropper). */
export function loadScreenImage(screen: Pick<CanvasFrameOption, "imageSrc">) {
  let pending = imageCache.get(screen.imageSrc);
  if (!pending) {
    pending = (async () => {
      const response = await fetch(screen.imageSrc, { cache: "force-cache" });
      if (!response.ok) throw new Error("The screen image could not be loaded.");
      const url = URL.createObjectURL(await response.blob());
      const image = new Image();
      image.decoding = "async";
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("The screen image could not be loaded."));
        image.src = url;
      });
      return image;
    })();
    pending.catch(() => imageCache.delete(screen.imageSrc));
    if (imageCache.size > 60) imageCache.delete(imageCache.keys().next().value!);
    imageCache.set(screen.imageSrc, pending);
  }
  return pending;
}

export function screenRect(screen: Pick<CanvasFrameOption, "sourceX" | "sourceY" | "sourceWidth" | "sourceHeight">): PageRect {
  return { x: screen.sourceX, y: screen.sourceY, width: screen.sourceWidth, height: screen.sourceHeight };
}

export function unionRect(rects: PageRect[]): PageRect | null {
  if (!rects.length) return null;
  const minX = Math.min(...rects.map((rect) => rect.x));
  const minY = Math.min(...rects.map((rect) => rect.y));
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.width));
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function intersects(a: PageRect, b: PageRect) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** Pixels per design unit: the capture's own density, capped so the whole image fits maxEdge. */
export function exportScale(screens: Array<Pick<CanvasFrameOption, "pixelWidth" | "sourceWidth">>, area: PageRect) {
  const density = Math.max(1, ...screens.map((screen) => screen.sourceWidth > 0 ? screen.pixelWidth / screen.sourceWidth : 1));
  return Math.max(0.05, Math.min(density, maxEdge / Math.max(area.width, area.height, 1)));
}

export function drawStrokes(context: CanvasRenderingContext2D, strokes: MarkupStroke[], area: PageRect, scale: number) {
  for (const stroke of strokes) {
    if (!stroke.points.length) continue;
    context.save();
    context.globalAlpha = stroke.highlighter ? 0.35 : 1;
    context.strokeStyle = stroke.color;
    context.fillStyle = stroke.color;
    context.lineWidth = stroke.width * scale;
    context.lineCap = stroke.highlighter ? "butt" : "round";
    context.lineJoin = "round";
    const [first, ...rest] = stroke.points;
    context.beginPath();
    context.moveTo((first[0] - area.x) * scale, (first[1] - area.y) * scale);
    if (!rest.length) {
      context.arc((first[0] - area.x) * scale, (first[1] - area.y) * scale, (stroke.width * scale) / 2, 0, Math.PI * 2);
      context.fill();
    } else {
      for (const [x, y] of rest) context.lineTo((x - area.x) * scale, (y - area.y) * scale);
      context.stroke();
    }
    context.restore();
  }
}

/**
 * Draws an area of the page as one PNG: every screen inside it from its captured image, plus any
 * strokes on top. Several screens come out side by side as they sit on the canvas.
 */
export async function renderPageArea(area: PageRect, screens: CanvasFrameOption[], strokes: MarkupStroke[] = []) {
  const inside = screens.filter((screen) => intersects(screenRect(screen), area));
  const scale = exportScale(inside.length ? inside : screens, area);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(area.width * scale));
  canvas.height = Math.max(1, Math.round(area.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The browser could not prepare this image.");
  context.imageSmoothingQuality = "high";
  const images = await Promise.all(inside.map(loadScreenImage));
  inside.forEach((screen, index) => {
    context.drawImage(images[index], (screen.sourceX - area.x) * scale, (screen.sourceY - area.y) * scale, screen.sourceWidth * scale, screen.sourceHeight * scale);
  });
  drawStrokes(context, strokes, area, scale);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("The browser could not export this image.");
  return blob;
}

/**
 * Puts a PNG on the clipboard. The ClipboardItem gets the promise straight away so Safari still
 * counts it as part of the key press or click.
 */
export async function copyPngToClipboard(render: () => Promise<Blob>, label: string) {
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
    showToast("This browser can’t copy images. Use Export to download it.", "error");
    return false;
  }
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": render() })]);
    showToast(`Copied ${label} as an image`);
    return true;
  } catch (cause) {
    showToast(cause instanceof Error && cause.name !== "NotAllowedError" ? cause.message : "The browser blocked copying the image.", "error");
    return false;
  }
}

/** Gap between screens copied together, in design units. */
const rowGap = 40;

/** Lines screens up left to right, tops aligned, so screens far apart on the canvas don't copy with a sea of empty space. */
export function layoutScreensInRow<T extends Pick<CanvasFrameOption, "sourceX" | "sourceY" | "sourceWidth" | "sourceHeight">>(screens: T[]): T[] {
  let x = 0;
  return screens.map((screen) => {
    const placed = { ...screen, sourceX: x, sourceY: 0 };
    x += screen.sourceWidth + rowGap;
    return placed;
  });
}

/** Copies screens (in a row, in the order given) or one area of the page, such as a selected element. */
export function copyScreensImage(screens: CanvasFrameOption[], allScreens: CanvasFrameOption[], area?: PageRect, label?: string) {
  const name = label ?? (screens.length === 1 ? `“${screens[0].name}”` : `${screens.length} screens`);
  if (area) return copyPngToClipboard(() => renderPageArea(area, allScreens), name);
  const placed = screens.length === 1 ? screens : layoutScreensInRow(screens);
  const target = unionRect(placed.map(screenRect));
  if (!target) return Promise.resolve(false);
  return copyPngToClipboard(() => renderPageArea(target, placed), name);
}
