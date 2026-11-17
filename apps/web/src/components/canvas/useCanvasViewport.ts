"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface CanvasTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

// Low enough that Fit shows a whole large Figma page (some are 25,000+ px wide).
const MIN_SCALE = 0.01;
const MAX_SCALE = 5;

const viewMemoryPrefix = "asbir-canvas-view:";

function readView(key: string | null): CanvasTransform | null {
  if (!key) return null;
  try {
    const saved = JSON.parse(sessionStorage.getItem(viewMemoryPrefix + key) ?? "null") as CanvasTransform | null;
    return saved && [saved.scale, saved.offsetX, saved.offsetY].every(Number.isFinite) ? saved : null;
  } catch {
    return null;
  }
}

/**
 * Pan and zoom for one canvas. With a `memoryKey` the view is remembered for this browser tab, so
 * coming back to a screen (or switching tabs) puts you where you left off instead of fitting again.
 */
export function useCanvasViewport(frameWidth: number, frameHeight: number, memoryKey: string | null = null) {
  const containerRef = useRef<HTMLDivElement>(null);
  // A saved view waiting to be applied; layout resizes refit only once the person has moved.
  const restoreRef = useRef<CanvasTransform | null>(null);
  const touchedRef = useRef(false);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [transform, setTransform] = useState<CanvasTransform>({
    scale: 0.3,
    offsetX: 0,
    offsetY: 0,
  });

  const fitToFrame = useCallback(() => {
    const container = containerRef.current;
    if (!container || frameWidth <= 0 || frameHeight <= 0) return;

    container.scrollLeft = 0;
    container.scrollTop = 0;
    const rect = container.getBoundingClientRect();
    const availableWidth = Math.max(1, rect.width - 72);
    const availableHeight = Math.max(1, rect.height - 72);
    const scale = Math.max(
      MIN_SCALE,
      Math.min(1, availableWidth / frameWidth, availableHeight / frameHeight),
    );

    setTransform({ scale, offsetX: 0, offsetY: 0 });
  }, [frameHeight, frameWidth]);

  const autoFit = useCallback(() => {
    if (restoreRef.current && !touchedRef.current) {
      setTransform(restoreRef.current);
      return;
    }
    fitToFrame();
  }, [fitToFrame]);

  useEffect(() => {
    restoreRef.current = readView(memoryKey);
    touchedRef.current = false;
    autoFit();
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      const contentRect = entries[0]?.contentRect;
      if (contentRect) {
        const nextSize = { width: contentRect.width, height: contentRect.height };
        setViewportSize((current) => current.width === nextSize.width && current.height === nextSize.height ? current : nextSize);
      }
      autoFit();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [autoFit, memoryKey]);

  // Save the view once the person has panned or zoomed.
  useEffect(() => {
    if (!memoryKey || !touchedRef.current) return;
    const timer = window.setTimeout(() => {
      try {
        sessionStorage.setItem(viewMemoryPrefix + memoryKey, JSON.stringify(transform));
      } catch {
        // Storage blocked: the view just isn't remembered.
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [memoryKey, transform]);

  const fitByUser = useCallback(() => {
    touchedRef.current = true;
    restoreRef.current = null;
    fitToFrame();
  }, [fitToFrame]);

  const zoomBy = useCallback((factor: number) => {
    touchedRef.current = true;
    setTransform((current) => ({
      ...current,
      scale: Math.max(MIN_SCALE, Math.min(MAX_SCALE, current.scale * factor)),
    }));
  }, []);

  const zoomAt = useCallback((factor: number, point: { x: number; y: number }) => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const center = { x: rect.width / 2, y: rect.height / 2 };
    const pointer = { x: point.x - rect.left, y: point.y - rect.top };
    touchedRef.current = true;

    setTransform((current) => {
      const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, current.scale * factor));
      const contentPoint = {
        x: (pointer.x - center.x - current.offsetX) / current.scale,
        y: (pointer.y - center.y - current.offsetY) / current.scale,
      };

      return {
        scale,
        offsetX: pointer.x - center.x - contentPoint.x * scale,
        offsetY: pointer.y - center.y - contentPoint.y * scale,
      };
    });
  }, []);

  const panBy = useCallback((deltaX: number, deltaY: number) => {
    touchedRef.current = true;
    setTransform((current) => ({
      ...current,
      offsetX: current.offsetX + deltaX,
      offsetY: current.offsetY + deltaY,
    }));
  }, []);

  return {
    containerRef,
    viewportSize,
    transform,
    fitToFrame: fitByUser,
    zoomBy,
    zoomAt,
    panBy,
  };
}
