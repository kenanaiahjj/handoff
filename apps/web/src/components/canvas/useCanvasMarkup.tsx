"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CanvasFrameOption } from "./FrameNavigator";
import type { CanvasLayerView, CanvasPagePoint, CanvasPointerTool } from "./CanvasViewport";
import { copyPngToClipboard, intersects, renderPageArea, screenRect, unionRect, type MarkupStroke, type PageRect } from "./screen-image";

export const markupColors = [
  { value: "#FF5A1F", label: "Orange" },
  { value: "#F0334B", label: "Red" },
  { value: "#2F7BFF", label: "Blue" },
  { value: "#1FB57A", label: "Green" },
  { value: "#FFD43B", label: "Yellow" },
] as const;

/** On-screen widths, turned into page units at the zoom the stroke starts at. */
const penPx = 3;
const highlighterPx = 18;

function strokeBounds(stroke: MarkupStroke): PageRect {
  const xs = stroke.points.map(([x]) => x);
  const ys = stroke.points.map(([, y]) => y);
  const pad = stroke.width / 2;
  return { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, width: Math.max(...xs) - Math.min(...xs) + stroke.width, height: Math.max(...ys) - Math.min(...ys) + stroke.width };
}

/** What the snapshot shows: every screen a stroke touches, plus strokes off the screens. */
export function snapshotArea(strokes: MarkupStroke[], screens: readonly CanvasFrameOption[]): PageRect | null {
  const marks = unionRect(strokes.map(strokeBounds));
  if (!marks) return null;
  const touched = screens.filter((screen) => strokes.some((stroke) => intersects(strokeBounds(stroke), screenRect(screen))));
  return unionRect([marks, ...touched.map(screenRect)]);
}

function readStrokes(key: string): MarkupStroke[] {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(saved) ? saved.filter((stroke) => stroke && Array.isArray(stroke.points)) : [];
  } catch {
    return [];
  }
}

function writeStrokes(key: string, strokes: MarkupStroke[]) {
  try {
    if (strokes.length) localStorage.setItem(key, JSON.stringify(strokes));
    else localStorage.removeItem(key);
  } catch {
    // Storage blocked or full: the drawing lasts until the page reloads.
  }
}

/**
 * Annotate mode: private freehand pen and highlighter on top of the screens. Drawings stay on this
 * device (per version) and nobody else sees them; Snapshot copies the marked-up screens as an image
 * to paste into a comment, Slack or a ticket.
 */
export function useCanvasMarkup(storageKey: string, screens: readonly CanvasFrameOption[], active: boolean) {
  const [strokes, setStrokes] = useState<MarkupStroke[]>([]);
  const [color, setColor] = useState<string>(markupColors[0].value);
  const [highlighter, setHighlighter] = useState(false);
  const [drawing, setDrawing] = useState<MarkupStroke | null>(null);
  const viewRef = useRef<CanvasLayerView>({ inverseScale: 1, originX: 0, originY: 0 });
  const drawingRef = useRef<MarkupStroke | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- drawings live in localStorage, only readable after mount.
    setStrokes(readStrokes(storageKey));
  }, [storageKey]);

  const commit = useCallback((next: MarkupStroke[]) => {
    setStrokes(next);
    writeStrokes(storageKey, next);
  }, [storageKey]);

  const pointerTool = useMemo<CanvasPointerTool | null>(() => active ? {
    cursor: "crosshair",
    onDown: (point: CanvasPagePoint) => {
      const width = (highlighter ? highlighterPx : penPx) * viewRef.current.inverseScale;
      const stroke: MarkupStroke = { id: crypto.randomUUID(), color, width, highlighter, points: [[point.x, point.y]] };
      drawingRef.current = stroke;
      setDrawing(stroke);
    },
    onMove: (point: CanvasPagePoint) => {
      const stroke = drawingRef.current;
      if (!stroke) return;
      const [lastX, lastY] = stroke.points[stroke.points.length - 1];
      if (Math.hypot(point.x - lastX, point.y - lastY) < 1.5 * viewRef.current.inverseScale) return;
      const next = { ...stroke, points: [...stroke.points, [point.x, point.y] as [number, number]] };
      drawingRef.current = next;
      setDrawing(next);
    },
    onUp: () => {
      const stroke = drawingRef.current;
      drawingRef.current = null;
      setDrawing(null);
      if (stroke) commit([...strokes, stroke]);
    },
  } : null, [active, color, commit, highlighter, strokes]);

  const undo = useCallback(() => {
    if (!strokes.length) return false;
    commit(strokes.slice(0, -1));
    return true;
  }, [commit, strokes]);

  const clear = useCallback(() => commit([]), [commit]);

  const snapshot = useCallback((fallback: CanvasFrameOption | null) => {
    const area = snapshotArea(strokes, screens) ?? (fallback ? screenRect(fallback) : null);
    if (!area) return Promise.resolve(false);
    const drawn = strokes;
    return copyPngToClipboard(() => renderPageArea(area, [...screens], drawn), strokes.length ? "your markup" : `“${fallback?.name}”`);
  }, [screens, strokes]);

  const overlay = useCallback((view: CanvasLayerView) => {
    viewRef.current = view;
    const all = drawing ? [...strokes, drawing] : strokes;
    if (!all.length) return null;
    return (
      <svg aria-hidden="true" className="pointer-events-none absolute left-0 top-0 z-30 overflow-visible" height="1" width="1">
        {all.map((stroke) => stroke.points.length === 1 ? (
          <circle cx={stroke.points[0][0] - view.originX} cy={stroke.points[0][1] - view.originY} fill={stroke.color} key={stroke.id} opacity={stroke.highlighter ? 0.35 : 1} r={stroke.width / 2} />
        ) : (
          <polyline
            fill="none"
            key={stroke.id}
            opacity={stroke.highlighter ? 0.35 : 1}
            points={stroke.points.map(([x, y]) => `${x - view.originX},${y - view.originY}`).join(" ")}
            stroke={stroke.color}
            strokeLinecap={stroke.highlighter ? "butt" : "round"}
            strokeLinejoin="round"
            strokeWidth={stroke.width}
          />
        ))}
      </svg>
    );
  }, [drawing, strokes]);

  return { strokes, color, setColor, highlighter, setHighlighter, pointerTool, overlay, undo, clear, snapshot };
}
