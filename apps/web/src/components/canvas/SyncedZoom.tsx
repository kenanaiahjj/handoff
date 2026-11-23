"use client";

import { useEffect, useRef, type ReactNode } from "react";

export type ZoomView = { scale: number; x: number; y: number };

export const fitView: ZoomView = { scale: 1, x: 0, y: 0 };
const minScale = 0.25;
const maxScale = 8;

function isFit(view: ZoomView) {
  return view.scale === 1 && view.x === 0 && view.y === 0;
}

function clampScale(value: number) {
  return Math.min(maxScale, Math.max(minScale, value));
}

/** Zoom by `factor` keeping the point (px, py), in pane pixels, under the cursor. */
export function zoomAt(view: ZoomView, factor: number, px: number, py: number): ZoomView {
  const raw = clampScale(view.scale * factor);
  // Passing through 100% on the way out snaps back to fit, so the screen re-centres there.
  const crossedFit = (view.scale > 1 && raw <= 1) || (view.scale < 1 && raw >= 1);
  if (crossedFit || Math.abs(raw - 1) < 0.001) return fitView;
  const scale = raw;
  const ratio = scale / view.scale;
  return { scale, x: px - (px - view.x) * ratio, y: py - (py - view.y) * ratio };
}

/**
 * One pane of a before/after pair. Every pane gets the same view, so zooming or panning one moves the
 * other and the same spot of a long screen stays lined up. Ctrl/⌘ + scroll or a trackpad pinch zooms
 * at the cursor, in to 800% or out to 25%; dragging pans; plain scrolling pans once zoomed in and
 * otherwise scrolls the page.
 */
export function ZoomPane({
  view,
  onViewChange,
  className,
  children,
}: {
  view: ZoomView;
  onViewChange: (update: (view: ZoomView) => ZoomView) => void;
  className: string;
  children: ReactNode;
}) {
  const paneRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const onViewChangeRef = useRef(onViewChange);
  const zoomedInRef = useRef(view.scale > 1);
  useEffect(() => {
    onViewChangeRef.current = onViewChange;
    zoomedInRef.current = view.scale > 1;
  });

  useEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;
    // Native, non-passive listener so a pinch or ⌘-scroll zooms the pane instead of the page.
    function onWheel(event: WheelEvent) {
      if (!event.ctrlKey && !event.metaKey) {
        if (!zoomedInRef.current) return;
        event.preventDefault();
        const unit = event.deltaMode === 1 ? 16 : 1;
        const dx = (event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX) * unit;
        const dy = (event.shiftKey && event.deltaX === 0 ? 0 : event.deltaY) * unit;
        onViewChangeRef.current((current) => ({ ...current, x: current.x - dx, y: current.y - dy }));
        return;
      }
      event.preventDefault();
      const rect = pane!.getBoundingClientRect();
      const factor = Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.05 : 0.0025));
      onViewChangeRef.current((current) => zoomAt(current, factor, event.clientX - rect.left, event.clientY - rect.top));
    }
    pane.addEventListener("wheel", onWheel, { passive: false });
    return () => pane.removeEventListener("wheel", onWheel);
  }, []);

  const zoomed = !isFit(view);
  return (
    <div
      className={className + " relative overflow-hidden " + (zoomed ? "cursor-grab active:cursor-grabbing" : "")}
      onDoubleClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        onViewChange((current) => (!isFit(current) ? fitView : zoomAt(current, 3, x, y)));
      }}
      onPointerDown={(event) => {
        if (!zoomed || event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (!start || start.pointerId !== event.pointerId) return;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
        onViewChange((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
      }}
      onPointerUp={() => { drag.current = null; }}
      onPointerCancel={() => { drag.current = null; }}
      ref={paneRef}
      style={{ touchAction: zoomed ? "none" : "pan-y" }}
    >
      <div
        className="h-full w-full"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, transformOrigin: "0 0" }}
      >
        {children}
      </div>
    </div>
  );
}

/** −, zoom level, + and Fit, shared by both panes. Buttons zoom around the pane's centre. */
export function ZoomControls({
  view,
  onViewChange,
  paneSize,
}: {
  view: ZoomView;
  onViewChange: (update: (view: ZoomView) => ZoomView) => void;
  paneSize: () => { width: number; height: number } | null;
}) {
  function step(factor: number) {
    const size = paneSize();
    onViewChange((current) => zoomAt(current, factor, (size?.width ?? 0) / 2, (size?.height ?? 0) / 2));
  }
  const buttonClass = "grid min-h-7 min-w-7 place-items-center rounded-[6px] px-1.5 text-[12px] text-foreground-muted hover:bg-surface-raised hover:text-foreground disabled:opacity-40";
  return (
    <div aria-label="Zoom" className="flex items-center gap-0.5 rounded-control border border-border bg-surface p-0.5" role="group">
      <button aria-label="Zoom out" className={buttonClass} disabled={view.scale <= minScale} onClick={() => step(1 / 1.5)} type="button">−</button>
      <span className="min-w-11 text-center font-mono text-[11px] tabular-nums text-foreground-subtle">{Math.round(view.scale * 100)}%</span>
      <button aria-label="Zoom in" className={buttonClass} disabled={view.scale >= maxScale} onClick={() => step(1.5)} type="button">+</button>
      <button className={buttonClass} disabled={isFit(view)} onClick={() => onViewChange(() => fitView)} type="button">Fit</button>
    </div>
  );
}
