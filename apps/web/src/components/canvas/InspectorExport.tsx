"use client";

import { useState } from "react";
import { showToast } from "@/src/components/shell/Toaster";
import type { CanvasFrameOption } from "./FrameNavigator";

type Format = "png" | "jpg" | "svg";
/** In the screen's design units (Figma px), not image pixels. */
type Area = { x: number; y: number; width: number; height: number };

const SCALES = [1, 2, 3, 4] as const;

function safeName(name: string) {
  return name.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "export";
}

function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The screen image could not be loaded."));
    image.src = url;
  });
}

/**
 * Draws part of the screen at the chosen scale. The image is drawn at the size of the whole screen times
 * the scale, so an SVG screen renders sharp at any scale and a raster one is resampled from its pixels.
 */
async function renderRaster(frame: CanvasFrameOption, area: Area, scale: number, format: "png" | "jpg") {
  const objectUrl = URL.createObjectURL(await (await fetch(frame.imageSrc, { cache: "no-store" })).blob());
  try {
    const image = await loadImage(objectUrl);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(area.width * scale));
    canvas.height = Math.max(1, Math.round(area.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The browser could not prepare this image.");
    context.imageSmoothingQuality = "high";
    if (format === "jpg") {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(image, -area.x * scale, -area.y * scale, frame.sourceWidth * scale, frame.sourceHeight * scale);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, format === "png" ? "image/png" : "image/jpeg", 0.92));
    if (!blob) throw new Error("The browser could not export this image.");
    return blob;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function exportRaster(frame: CanvasFrameOption, area: Area, scale: number, format: "png" | "jpg", fileName: string) {
  download(await renderRaster(frame, area, scale, format), fileName);
}

async function exportFile(url: string, fileName: string) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("The file could not be loaded.");
  download(await response.blob(), fileName);
}

/**
 * Export for the inspector: the selected element or its whole screen, at 1x to 4x. Raster screens only
 * offer the scales their stored image has pixels for; SVG screens offer every scale.
 */
export function InspectorExport({ frame, element }: {
  frame: CanvasFrameOption;
  element?: {
    name: string;
    bounds: { x: number | null; y: number | null; width: number | null; height: number | null };
    layerExport: { downloadUrl: string; fileName: string; contentType: "image/png" | "image/svg+xml" } | null;
  } | null;
}) {
  const [target, setTarget] = useState<"element" | "screen">("element");
  const [scale, setScale] = useState(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { x, y, width, height } = element?.bounds ?? { x: null, y: null, width: null, height: null };
  const elementArea: Area | null = x !== null && y !== null && width && height ? { x, y, width, height } : null;
  const canExportElement = Boolean(element && (elementArea || element.layerExport));
  const scope = canExportElement && target === "element" ? "element" : "screen";
  const screenIsSvg = frame.fileName.toLowerCase().endsWith(".svg");
  const density = frame.sourceWidth > 0 ? frame.pixelWidth / frame.sourceWidth : 1;
  // A little slack so a 2.98x capture still counts as 3x.
  const scales = SCALES.filter((option) => screenIsSvg || option <= Math.max(1, density + 0.05));
  const activeScale = scales.includes(scale as (typeof SCALES)[number]) ? scale : scales[scales.length - 1];
  const layerExport = scope === "element" ? element?.layerExport ?? null : null;
  const svgUrl = scope === "element" ? (layerExport?.contentType === "image/svg+xml" ? layerExport.downloadUrl : null) : screenIsSvg ? frame.imageSrc : null;
  const baseName = safeName(scope === "element" ? element?.name ?? "element" : frame.name);
  const rasterArea = scope === "element" ? elementArea : { x: 0, y: 0, width: frame.sourceWidth, height: frame.sourceHeight };
  const suffix = activeScale === 1 ? "" : `@${activeScale}x`;

  async function run(format: Format) {
    setBusy(true);
    setError(null);
    try {
      if (format === "svg" && svgUrl) await exportFile(svgUrl, `${baseName}.svg`);
      else if (format !== "svg" && rasterArea) await exportRaster(frame, rasterArea, activeScale, format, `${baseName}${suffix}.${format}`);
      else if (layerExport) await exportFile(layerExport.downloadUrl, layerExport.fileName);
      else throw new Error("This element has no position to cut out of the screen.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The image could not be exported.");
    } finally {
      setBusy(false);
    }
  }

  const formats: Format[] = svgUrl ? ["png", "jpg", "svg"] : ["png", "jpg"];

  // Copies a PNG to the clipboard, to paste into Slack or a ticket. The ClipboardItem gets a promise
  // so Safari still counts it as part of the click.
  async function copyImage() {
    const what = scope === "element" ? element?.name || "element" : frame.name;
    const blob = rasterArea
      ? renderRaster(frame, rasterArea, activeScale, "png")
      : layerExport?.contentType === "image/png"
        ? fetch(layerExport.downloadUrl, { cache: "no-store" }).then((response) => response.blob())
        : null;
    if (!blob || typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
      showToast("This browser can’t copy images. Use PNG to download it.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      showToast(`Copied ${what} as an image`);
    } catch {
      setError("The browser blocked copying the image. Use PNG to download it.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="inspector-export-title" className="border-t border-border py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="dial-section-title" id="inspector-export-title">Export</h3>
        {canExportElement ? (
          <div aria-label="What to export" className="dial-segmented h-7" role="group">
            {(["element", "screen"] as const).map((option) => (
              <button aria-pressed={scope === option} className="min-h-6 px-2 text-[11px]" key={option} onClick={() => setTarget(option)} type="button">
                {option === "element" ? "Element" : "Screen"}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="flex items-center gap-1.5">
        <div aria-label="Export scale" className="dial-segmented h-8 shrink-0" role="group">
          {scales.map((option) => (
            <button aria-pressed={activeScale === option} className="min-h-7 px-2 font-mono text-[11px]" key={option} onClick={() => setScale(option)} type="button">
              {option}x
            </button>
          ))}
        </div>
        <button
          className="min-h-8 flex-1 rounded-control bg-surface-inset text-[12px] text-foreground-muted hover:bg-surface-raised hover:text-foreground disabled:opacity-50"
          disabled={busy || (!rasterArea && layerExport?.contentType !== "image/png")}
          onClick={() => void copyImage()}
          title={`Copy ${scope === "element" ? "this element" : "this screen"} as a PNG at ${activeScale}x, to paste anywhere`}
          type="button"
        >
          Copy
        </button>
        {formats.map((format) => (
          <button
            className="min-h-8 flex-1 rounded-control bg-surface-inset text-[12px] text-foreground-muted hover:bg-surface-raised hover:text-foreground disabled:opacity-50"
            disabled={busy}
            key={format}
            onClick={() => void run(format)}
            title={format === "svg" ? "Download as SVG (vector, any size)" : `Download ${scope === "element" ? "this element" : "this screen"} as ${format === "jpg" ? "JPEG" : "PNG"} at ${activeScale}x`}
            type="button"
          >
            {format === "jpg" ? "JPEG" : format.toUpperCase()}
          </button>
        ))}
      </div>
      {scales.length < SCALES.length ? <p className="mt-2 text-[11px] leading-4 text-foreground-subtle">This screen was captured at {Math.round(density * 10) / 10}x, so larger scales aren’t available.</p> : null}
      {error ? <p aria-live="assertive" className="mt-2 text-[11px] text-warning">{error}</p> : null}
    </section>
  );
}
