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
  // False until the first fit or restore, so the canvas isn't shown at the placeholder zoom.
  const [fitted, setFitted] = useState(false);
  const [transform, setTransformState] = useState<CanvasTransform>({
    scale: 0.3,
    offsetX: 0,
    offsetY: 0,
  });
  // Wheel, trackpad and drag events can arrive far faster than the screen refreshes (and each one
  // re-renders the canvas), so gestures update `latestRef` and commit at most once per frame.
  const latestRef = useRef(transform);
  const frameRequestRef = useRef<number | null>(null);
  // True while a gesture is moving the canvas, so it can be promoted to its own GPU layer.
  const [interacting, setInteracting] = useState(false);
  const idleTimerRef = useRef<number | null>(null);

  const markInteracting = useCallback(() => {
    setInteracting(true);
    if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current);
    idleTimerRef.current = window.setTimeout(() => {
      idleTimerRef.current = null;
      setInteracting(false);
    }, 180);
  }, []);

  /** Applies a view right away (fit, focus, restore), dropping any gesture frame still queued. */
  const setTransform = useCallback((next: CanvasTransform) => {
    if (frameRequestRef.current !== null) {
      cancelAnimationFrame(frameRequestRef.current);
      frameRequestRef.current = null;
    }
    latestRef.current = next;
    setTransformState(next);
  }, []);

  /** A gesture step: builds on the newest view (including steps not yet drawn) and draws next frame. */
  const updateTransform = useCallback((update: (current: CanvasTransform) => CanvasTransform) => {
    latestRef.current = update(latestRef.current);
    markInteracting();
    if (frameRequestRef.current !== null) return;
    frameRequestRef.current = requestAnimationFrame(() => {
      frameRequestRef.current = null;
      setTransformState(latestRef.current);
    });
  }, [markInteracting]);

  useEffect(() => () => {
    if (frameRequestRef.current !== null) cancelAnimationFrame(frameRequestRef.current);
    if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current);
  }, []);

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
    setFitted(true);
  }, [frameHeight, frameWidth, setTransform]);

  // Layout changes (panels opening, window resizes) refit only until the person pans, zooms or
  // jumps to a screen; after that their view is kept.
  const autoFit = useCallback(() => {
    if (touchedRef.current) return;
    if (restoreRef.current) {
      setTransform(restoreRef.current);
      setFitted(true);
      return;
    }
    fitToFrame();
  }, [fitToFrame, setTransform]);

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

  /** Centres an area of the canvas (in canvas pixels from its top-left) and zooms so it fits, up to 100%. */
  const zoomToRect = useCallback((rect: { x: number; y: number; width: number; height: number }) => {
    const container = containerRef.current;
    if (!container || rect.width <= 0 || rect.height <= 0) return;
    const bounds = container.getBoundingClientRect();
    const scale = Math.max(
      MIN_SCALE,
      Math.min(1, Math.max(1, bounds.width - 120) / rect.width, Math.max(1, bounds.height - 120) / rect.height),
    );
    touchedRef.current = true;
    restoreRef.current = null;
    setFitted(true);
    // The canvas is drawn centred on the viewport, so offsets are measured from its centre.
    setTransform({
      scale,
      offsetX: -(rect.x + rect.width / 2 - frameWidth / 2) * scale,
      offsetY: -(rect.y + rect.height / 2 - frameHeight / 2) * scale,
    });
  }, [frameHeight, frameWidth, setTransform]);

  const zoomBy = useCallback((factor: number) => {
    touchedRef.current = true;
    const current = latestRef.current;
    setTransform({ ...current, scale: Math.max(MIN_SCALE, Math.min(MAX_SCALE, current.scale * factor)) });
  }, [setTransform]);

  const zoomAt = useCallback((factor: number, point: { x: number; y: number }) => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const center = { x: rect.width / 2, y: rect.height / 2 };
    const pointer = { x: point.x - rect.left, y: point.y - rect.top };
    touchedRef.current = true;

    updateTransform((current) => {
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
  }, [updateTransform]);

  const panBy = useCallback((deltaX: number, deltaY: number) => {
    touchedRef.current = true;
    updateTransform((current) => ({
      ...current,
      offsetX: current.offsetX + deltaX,
      offsetY: current.offsetY + deltaY,
    }));
  }, [updateTransform]);

  return {
    containerRef,
    viewportSize,
    transform,
    interacting,
    fitted,
    fitToFrame: fitByUser,
    zoomToRect,
    zoomBy,
    zoomAt,
    panBy,
  };
}
