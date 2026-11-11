"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { getPixelDiffImageRect, getPixelDiffPlan } from "../../workers/pixel-diff";

type PixelPreview = {
  name: string;
  imageUrl: string;
  width: number | null;
  height: number | null;
  sourceWidth: number;
  sourceHeight: number;
};

type PixelDiffResult = {
  width: number;
  height: number;
  pixels: ArrayBuffer;
  changedPixels: number;
};

async function decodeScreenImage(imageUrl: string, signal: AbortSignal) {
  if (signal.aborted) throw new DOMException("The comparison was cancelled.", "AbortError");
  const image = document.createElement("img");
  image.decoding = "async";
  image.src = imageUrl;
  await image.decode();

  if (signal.aborted) throw new DOMException("The comparison was cancelled.", "AbortError");
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context || canvas.width === 0 || canvas.height === 0) {
    throw new Error("The browser could not prepare this screen image for comparison.");
  }
  context.drawImage(image, 0, 0);
  return createImageBitmap(canvas);
}

export function PixelDiffView({ before, after }: { before: PixelPreview; after: PixelPreview }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const plan = getPixelDiffPlan(before.sourceWidth, before.sourceHeight, after.sourceWidth, after.sourceHeight);
  const afterImageRect = plan.status === "ready"
    ? getPixelDiffImageRect(after.sourceWidth, after.sourceHeight)
    : null;
  const plannedWidth = plan.status === "ready" ? plan.width : null;
  const plannedHeight = plan.status === "ready" ? plan.height : null;
  const [result, setResult] = useState<{ width: number; height: number; changedPixels: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (plannedWidth === null || plannedHeight === null) return;
    const controller = new AbortController();
    const worker = new Worker(new URL("../../workers/pixel-diff.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<PixelDiffResult | { error: string }>) => {
      if ("error" in event.data) {
        setError(event.data.error);
        return;
      }
      const { width, height, pixels, changedPixels } = event.data;
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      if (!canvas || !context) {
        setError("The browser could not display the pixel difference.");
        return;
      }
      canvas.width = width;
      canvas.height = height;
      context.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
      setResult({ width, height, changedPixels });
    };
    worker.onerror = () => setError("The browser could not calculate this pixel difference.");

    Promise.all([
      decodeScreenImage(before.imageUrl, controller.signal),
      decodeScreenImage(after.imageUrl, controller.signal),
    ])
      .then(([beforeBitmap, afterBitmap]) => {
        if (controller.signal.aborted) {
          beforeBitmap.close();
          afterBitmap.close();
          return;
        }
        worker.postMessage({
          before: beforeBitmap,
          after: afterBitmap,
          beforeSourceWidth: before.sourceWidth,
          beforeSourceHeight: before.sourceHeight,
          afterSourceWidth: after.sourceWidth,
          afterSourceHeight: after.sourceHeight,
        }, [beforeBitmap, afterBitmap]);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError(cause instanceof Error ? cause.message : "The pixel difference could not be calculated.");
      });

    return () => {
      controller.abort();
      worker.terminate();
    };
  }, [plannedWidth, plannedHeight, before.imageUrl, before.sourceWidth, before.sourceHeight, after.imageUrl, after.sourceWidth, after.sourceHeight]);

  return (
    <div className="relative grid min-h-[min(68vh,760px)] place-items-center overflow-hidden rounded-surface border border-border bg-surface-inset p-3">
      {plan.status === "ready" && afterImageRect ? (
        <div className="relative max-h-[min(68vh,760px)] max-w-full">
          <Image
            alt={`After screen, shown beneath pixel differences: ${after.name}`}
            className="pointer-events-none absolute left-0 top-0 object-fill opacity-50"
            height={after.height ?? 900}
            src={after.imageUrl}
            style={{
              height: `${(afterImageRect.height / plan.height) * 100}%`,
              width: `${(afterImageRect.width / plan.width) * 100}%`,
            }}
            unoptimized
            width={after.width ?? 1280}
          />
        <canvas
          aria-label="Pixel difference overlay. Changed pixels are highlighted in pink."
          className="relative z-10 block max-h-[min(68vh,760px)] max-w-full"
          ref={canvasRef}
          role="img"
        />
        </div>
      ) : null}
      {plan.status !== "ready" ? (
        <Image
          alt={`After screen, shown beneath pixel differences: ${after.name}`}
          className="pointer-events-none absolute inset-3 m-auto max-h-[min(68vh,760px)] w-[calc(100%-24px)] object-contain opacity-50"
          height={after.height ?? 900}
          src={after.imageUrl}
          unoptimized
          width={after.width ?? 1280}
        />
      ) : null}
      {error ? <p aria-live="assertive" className="relative z-20 rounded-control bg-background/90 p-3 text-xs text-warning">{error}</p> : null}
      {plan.status === "too-large" ? <p aria-live="polite" className="relative z-20 max-w-md rounded-control bg-background/90 p-3 text-xs text-foreground-muted">Pixel diff is unavailable for screens this large. Use side-by-side or overlay to compare them at full size.</p> : null}
      {plan.status === "invalid" ? <p aria-live="polite" className="relative z-20 max-w-md rounded-control bg-background/90 p-3 text-xs text-foreground-muted">Pixel diff is unavailable because the captured screen dimensions are invalid. Use side-by-side or overlay instead.</p> : null}
      {plan.status === "ready" && !result && !error ? <p aria-live="polite" className="relative z-20 rounded-control bg-background/90 p-3 text-xs text-foreground-muted">Computing pixel difference…</p> : null}
      {result ? <p className="absolute bottom-2 right-2 z-20 rounded-control bg-background/90 px-2 py-1 font-mono text-[10px] text-foreground">{result.changedPixels.toLocaleString()} changed pixels · {result.width}×{result.height}</p> : null}
    </div>
  );
}
