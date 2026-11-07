"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type PointerEvent, type WheelEvent } from "react";
import type { CanvasFrameChangeStatus, CanvasFrameOption } from "./FrameNavigator";
import { useCanvasViewport } from "./useCanvasViewport";
import { CommentPin, type HandoffComment } from "../comments/CommentPin";
import type { PendingCommentPoint } from "../comments/CommentThread";
import { LayoutGridOverlay } from "./LayoutGridOverlay";

export type CanvasViewportControls = {
  scale: number;
  fitToFrame: () => void;
  zoomOut: () => void;
  zoomIn: () => void;
};

type CanvasViewportProps = {
  frame: CanvasFrameOption;
  interactionMode: "view" | "inspect";
  screens: CanvasFrameOption[];
  selectedFrameId: string | null;
  frameStatuses: Record<string, CanvasFrameChangeStatus>;
  canCompare: boolean;
  onCompareScreen: (frameId: string) => void;
  outlinesVisible: boolean;
  layoutGridsVisible: boolean;
  highlightedNodeIds: string[];
  showResolvedPins: boolean;
  selectedNodeId: string | null;
  onSelectNode: (sourceNodeId: string) => void;
  onSelectFrame: (frameId: string) => void;
  comments: HandoffComment[];
  selectedCommentId: string | null;
  commentMode: boolean;
  onSelectComment: (commentId: string) => void;
  onPlaceComment: (point: PendingCommentPoint) => void;
  annotations: Array<{ id: string; frameId: string; sourceNodeId: string | null; x: number; y: number; title: string; body: string; authorName: string }>;
  selectedAnnotationId: string | null;
  annotationMode: boolean;
  onSelectAnnotation: (annotationId: string) => void;
  onPlaceAnnotation: (point: PendingCommentPoint) => void;
  onViewportChange: (controls: CanvasViewportControls) => void;
};

function statusLabel(status: CanvasFrameChangeStatus | undefined) {
  if (status === "changed") return "Changed";
  if (status === "added") return "New";
  if (status === "removed") return "Removed";
  return null;
}

export function CanvasViewport({
  frame,
  interactionMode,
  screens,
  selectedFrameId,
  frameStatuses,
  canCompare,
  onCompareScreen,
  outlinesVisible,
  layoutGridsVisible,
  highlightedNodeIds,
  showResolvedPins,
  selectedNodeId,
  onSelectNode,
  onSelectFrame,
  comments,
  selectedCommentId,
  commentMode,
  onSelectComment,
  onPlaceComment,
  annotations,
  selectedAnnotationId,
  annotationMode,
  onSelectAnnotation,
  onPlaceAnnotation,
  onViewportChange,
}: CanvasViewportProps) {
  const dragRef = useRef<{ pointerId: number; x: number; y: number; startX: number; startY: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  const [altHeld, setAltHeld] = useState(false);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const { containerRef, transform, fitToFrame, zoomBy, zoomAt, panBy } = useCanvasViewport(
    frame.sourceWidth,
    frame.sourceHeight,
  );
  const controls = useMemo<CanvasViewportControls>(() => ({
    scale: transform.scale,
    fitToFrame,
    zoomOut: () => zoomBy(1 / 1.2),
    zoomIn: () => zoomBy(1.2),
  }), [fitToFrame, transform.scale, zoomBy]);

  useEffect(() => onViewportChange(controls), [controls, onViewportChange]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Alt") setAltHeld(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Alt") setAltHeld(false);
    };
    const clearAlt = () => setAltHeld(false);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", clearAlt);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", clearAlt);
    };
  }, []);

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (commentMode || annotationMode || event.button !== 0 || target.closest("[data-comment-pin], [data-canvas-annotation]")) return;
    if (target.closest("button") && !target.closest("[data-source-node-id]")) return;
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    let drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) return;
    if (!drag.moved) {
      drag = { ...drag, moved: true };
      dragRef.current = drag;
      event.currentTarget.setPointerCapture(event.pointerId);
      setIsDragging(true);
    }
    panBy(event.clientX - drag.x, event.clientY - drag.y);
    dragRef.current = { ...drag, x: event.clientX, y: event.clientY };
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (drag?.pointerId === event.pointerId) {
      if (drag.moved) {
        suppressClickRef.current = true;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }
      dragRef.current = null;
      setIsDragging(false);
    }
  }

  function handlePointerCancel(event: PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId === event.pointerId) {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      dragRef.current = null;
      setIsDragging(false);
    }
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    zoomAt(Math.exp(-event.deltaY * 0.0015), { x: event.clientX, y: event.clientY });
  }

  function handleCanvasKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    const distance = event.shiftKey ? 12 : 40;
    if (event.key === "ArrowLeft") panBy(distance, 0);
    else if (event.key === "ArrowRight") panBy(-distance, 0);
    else if (event.key === "ArrowUp") panBy(0, distance);
    else if (event.key === "ArrowDown") panBy(0, -distance);
    else if (event.key === "+" || event.key === "=") zoomBy(1.2);
    else if (event.key === "-") zoomBy(1 / 1.2);
    else if (event.key === "0" || event.key === "Home") fitToFrame();
    else return;
    event.preventDefault();
  }

  function handleCanvasClick(event: MouseEvent<HTMLDivElement>) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      event.preventDefault();
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest("[data-comment-pin]")) return;
    if (target.closest("[data-canvas-annotation]")) return;
    const nodeButton = target.closest<HTMLElement>("[data-source-node-id]");
    if (nodeButton && !commentMode && !annotationMode) return;
    if (target.closest("button") && !nodeButton) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const localX = (event.clientX - rect.left - rect.width / 2 - transform.offsetX) / transform.scale + frame.sourceWidth / 2;
    const localY = (event.clientY - rect.top - rect.height / 2 - transform.offsetY) / transform.scale + frame.sourceHeight / 2;
    if (localX < 0 || localY < 0 || localX > frame.sourceWidth || localY > frame.sourceHeight) return;

    const sourceX = localX + frame.sourceX;
    const sourceY = localY + frame.sourceY;
    const screen = screens.find((candidate) =>
      sourceX >= candidate.sourceX && sourceY >= candidate.sourceY &&
      sourceX <= candidate.sourceX + candidate.sourceWidth &&
      sourceY <= candidate.sourceY + candidate.sourceHeight,
    );

    if (commentMode) {
      if (!screen) return;
      const sourceNodeId = nodeButton?.dataset.sourceNodeId ?? selectedNodeId;
      onPlaceComment({
        frameId: screen.id,
        sourceNodeId: sourceNodeId ?? null,
        x: sourceX - screen.sourceX,
        y: sourceY - screen.sourceY,
      });
      return;
    }

    if (annotationMode) {
      if (!screen) return;
      const sourceNodeId = nodeButton?.dataset.sourceNodeId ?? selectedNodeId;
      onPlaceAnnotation({
        frameId: screen.id,
        sourceNodeId: sourceNodeId ?? null,
        x: sourceX - screen.sourceX,
        y: sourceY - screen.sourceY,
      });
      return;
    }

    if (!nodeButton && screen) onSelectFrame(screen.id);
  }

  const commentPins = comments
    .filter((comment) => comment.parentCommentId === null && comment.x !== null && comment.y !== null && (showResolvedPins || !comment.resolvedAt))
    .flatMap((comment, index) => {
      const screen = screens.find((candidate) => candidate.id === comment.frameId);
      if (!screen || comment.x === null || comment.y === null) return [];
      const absoluteX = screen.sourceX + comment.x;
      const absoluteY = screen.sourceY + comment.y;
      return [{
        comment: { ...comment, x: absoluteX - frame.sourceX, y: absoluteY - frame.sourceY },
        index,
      }];
    });
  const annotationPins = annotations.flatMap((annotation) => {
    const screen = screens.find((candidate) => candidate.id === annotation.frameId);
    if (!screen) return [];
    return [{
      annotation,
      x: screen.sourceX + annotation.x - frame.sourceX,
      y: screen.sourceY + annotation.y - frame.sourceY,
    }];
  });
  const inverseScale = 1 / Math.max(transform.scale, 0.01);
  const selectedBounds = frame.nodes.find((node) => node.sourceNodeId === selectedNodeId)?.bounds;
  const hoveredBounds = frame.nodes.find((node) => node.sourceNodeId === hoveredNodeId)?.bounds;
  const distance = altHeld && selectedNodeId && hoveredNodeId && selectedNodeId !== hoveredNodeId && selectedBounds && hoveredBounds &&
    selectedBounds.x.value !== null && selectedBounds.y.value !== null && selectedBounds.width.value !== null && selectedBounds.height.value !== null &&
    hoveredBounds.x.value !== null && hoveredBounds.y.value !== null && hoveredBounds.width.value !== null && hoveredBounds.height.value !== null
    ? {
        horizontal: Math.max(0, hoveredBounds.x.value - (selectedBounds.x.value + selectedBounds.width.value), selectedBounds.x.value - (hoveredBounds.x.value + hoveredBounds.width.value)),
        vertical: Math.max(0, hoveredBounds.y.value - (selectedBounds.y.value + selectedBounds.height.value), selectedBounds.y.value - (hoveredBounds.y.value + hoveredBounds.height.value)),
      }
    : null;

  return (
    <section aria-label="Design canvas" className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#1d1d1d]">
      <div
        aria-describedby="canvas-keyboard-help"
        aria-label={interactionMode === "inspect"
          ? "Inspect mode. Select a highlighted element to inspect it, drag to pan and use the scroll wheel to zoom."
          : "View mode. Drag to pan and use the scroll wheel to zoom. Switch to Inspect to select design elements."}
        className={"review-dot-grid relative grid min-h-0 min-w-0 flex-1 touch-none place-items-center overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-[#b3b3b3] " + (commentMode || annotationMode ? "cursor-crosshair" : isDragging ? "cursor-grabbing" : "cursor-grab")}
        onClick={handleCanvasClick}
        onPointerCancel={handlePointerCancel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onKeyDown={handleCanvasKeyDown}
        onWheel={handleWheel}
        ref={containerRef}
        role="region"
        tabIndex={0}
      >
        <span className="sr-only" id="canvas-keyboard-help">
          Focus this canvas, then use the arrow keys to pan, plus or minus to zoom, and zero or Home to fit the design. To inspect a layer, expand Elements in the screen sidebar and choose it.
        </span>
        <div
            className="absolute left-1/2 top-1/2 shrink-0 shadow-[0_18px_55px_rgba(0,0,0,0.35)]"
          style={{
            width: frame.sourceWidth,
            height: frame.sourceHeight,
              marginLeft: -frame.sourceWidth / 2,
              marginTop: -frame.sourceHeight / 2,
            transform: "translate(" + transform.offsetX + "px, " + transform.offsetY + "px) scale(" + transform.scale + ")",
            transformOrigin: "center center",
          }}
        >
          <Image
            alt={(frame.fileName.toLowerCase().endsWith(".svg") ? "Figma vector render: " : "Frozen design render: ") + frame.name}
            className="pointer-events-none select-none object-fill"
            draggable={false}
            height={frame.pixelHeight}
            priority
            src={frame.imageSrc}
            style={{ width: frame.sourceWidth, height: frame.sourceHeight }}
            unoptimized
            width={frame.pixelWidth}
          />

          {layoutGridsVisible
            ? frame.kind === "overview" && frame.exact
              ? screens.map((screen) => (
                  <LayoutGridOverlay
                    frame={screen}
                    key={screen.id}
                    left={screen.sourceX - frame.sourceX}
                    top={screen.sourceY - frame.sourceY}
                  />
                ))
              : frame.kind === "frame" ? <LayoutGridOverlay frame={frame} /> : null
            : null}

            {frame.kind === "overview" && frame.exact ? screens.map((screen) => {
            const status = frameStatuses[screen.id];
            const label = statusLabel(status);
            const selected = screen.id === selectedFrameId;
              const borderColor = status === "changed" ? "#e3a13a" : status === "added" ? "#55c987" : status === "removed" ? "#df7770" : selected ? "#888888" : "#4c4c4c";
            return (
              <div
                className="pointer-events-none absolute"
                key={screen.id}
                style={{
                  left: screen.sourceX - frame.sourceX,
                  top: screen.sourceY - frame.sourceY,
                  width: screen.sourceWidth,
                  height: screen.sourceHeight,
                  border: (selected ? 3 : 1.5) * inverseScale + "px solid " + borderColor,
                }}
              >
                  <div
                    className="pointer-events-auto absolute left-0 flex items-center gap-1 whitespace-nowrap"
                  style={{
                    bottom: "100%",
                    marginBottom: 4 * inverseScale,
                    maxWidth: Math.max(screen.sourceWidth, 120) + "px",
                  }}
                >
                    <button
                      aria-label={"Select screen " + screen.name + (label ? ", " + label : "")}
                        aria-pressed={selected}
                      className="flex max-w-[min(80vw,480px)] items-center gap-1.5 rounded-[4px] bg-[#202020]/95 text-left text-[#d7d7d7] shadow-sm hover:bg-[#303030] focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
                      onClick={() => onSelectFrame(screen.id)}
                      style={{
                        padding: 3 * inverseScale + "px " + 5 * inverseScale + "px",
                        fontSize: 12 * inverseScale + "px",
                        lineHeight: 1.3,
                        border: "1px solid " + borderColor,
                      }}
                      type="button"
                    >
                      <span className="max-w-[28ch] truncate">{screen.name}</span>
                        <span className="font-mono text-[#999]" style={{ fontSize: 10 * inverseScale + "px" }}>
                        {Math.round(screen.sourceWidth)}×{Math.round(screen.sourceHeight)}
                      </span>
                      {label ? (
                        <span
                          className="rounded-[3px] font-medium"
                          style={{
                            padding: 2 * inverseScale + "px " + 4 * inverseScale + "px",
                            fontSize: 10 * inverseScale + "px",
                            color: status === "added" ? "#76e0a5" : status === "removed" ? "#f18b84" : "#ffb646",
                            backgroundColor: status === "added" ? "#173b2b" : status === "removed" ? "#3b2323" : "#46351e",
                          }}
                        >
                          {label}
                        </span>
                      ) : null}
                    </button>
                    {canCompare && status === "changed" ? (
                      <button
                        aria-label={"Compare " + screen.name + " before and after this version"}
                        className="rounded-[4px] border border-[#424242] bg-[#252525]/95 px-1.5 py-0.5 text-[#c6c6c6] shadow-sm hover:bg-[#363636] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
                        onClick={() => onCompareScreen(screen.id)}
                        style={{ padding: 3 * inverseScale + "px " + 5 * inverseScale + "px", fontSize: 11 * inverseScale + "px" }}
                        type="button"
                      >
                        Compare
                      </button>
                    ) : null}
                  </div>
              </div>
            );
          }) : null}

          {(interactionMode === "inspect" || commentMode || annotationMode ? frame.nodes.filter((node) => node.visible) : []).map((node) => {
            const x = node.bounds.x.value === null ? null : node.bounds.x.value - (frame.kind === "overview" ? frame.sourceX : 0);
            const y = node.bounds.y.value === null ? null : node.bounds.y.value - (frame.kind === "overview" ? frame.sourceY : 0);
            const width = node.bounds.width.value;
            const height = node.bounds.height.value;
            if (x === null || y === null || width === null || height === null || width <= 0 || height <= 0) return null;
            const isSelected = node.sourceNodeId === selectedNodeId;
            const isHighlighted = highlightedNodeIds.includes(node.sourceNodeId);
            return (
              <button
                aria-hidden="true"
                aria-label={"Select " + node.name + ", " + node.type + ", " + Math.round(node.bounds.x.value ?? x) + ", " + Math.round(node.bounds.y.value ?? y)}
                tabIndex={-1}
                className={"absolute rounded-[2px] outline-none transition-colors focus-visible:border-2 focus-visible:border-white " + (isSelected ? "border-2 border-[#e3a13a] bg-[#e3a13a]/20" : isHighlighted ? "border border-[#e3a13a] bg-[#e3a13a]/15" : outlinesVisible ? "border border-white/30 hover:border-white/80 hover:bg-white/10" : "border border-transparent hover:border-white/70 hover:bg-white/10")}
                data-source-node-id={node.sourceNodeId}
                key={node.sourceNodeId}
                onClick={(event) => {
                  if (suppressClickRef.current) {
                    suppressClickRef.current = false;
                    event.preventDefault();
                    return;
                  }
                  if (!commentMode && !annotationMode) onSelectNode(node.sourceNodeId);
                }}
                onMouseEnter={() => { if (interactionMode === "inspect") setHoveredNodeId(node.sourceNodeId); }}
                onMouseLeave={() => { if (interactionMode === "inspect") setHoveredNodeId(null); }}
                style={{ left: x, top: y, width, height }}
                type="button"
              />
            );
          })}

          {annotationPins.map(({ annotation, x, y }) => (
            <button
              aria-label={`Canvas note: ${annotation.title}. ${annotation.body}`}
              className={"absolute z-20 max-w-none rounded-[6px] border px-2.5 py-2 text-left shadow-xl " + (annotation.id === selectedAnnotationId ? "border-[#f3ce7e] bg-[#f4d89e] text-[#34260f]" : "border-[#d2b774] bg-[#f3dfb5] text-[#3e321a] hover:bg-[#f7e6c5]")}
              data-canvas-annotation
              key={annotation.id}
              onClick={() => onSelectAnnotation(annotation.id)}
              style={{
                left: x + 10 * inverseScale,
                top: y + 10 * inverseScale,
                width: 230 * inverseScale,
                fontSize: 11 * inverseScale,
                lineHeight: 1.4,
              }}
              type="button"
            >
              <span aria-hidden="true" className="absolute -left-[5px] -top-[5px] size-2.5 rounded-full border border-[#423719] bg-[#f3bd5e]" />
              <span className="block font-semibold">{annotation.title}</span>
              <span className="mt-1 block whitespace-pre-wrap break-words">{annotation.body}</span>
                <span className="mt-1.5 block border-t border-black/15 pt-1 text-[0.8em] text-[#685734]">{annotation.authorName}</span>
            </button>
          ))}

          {commentPins.map(({ comment, index }) => (
            <span data-comment-pin key={comment.id}>
              <CommentPin
                comment={comment}
                index={index}
                selected={comment.id === selectedCommentId}
                onSelect={onSelectComment}
              />
            </span>
          ))}
        </div>
        {distance ? (
          <div aria-live="polite" className="pointer-events-none absolute left-4 top-4 rounded-[5px] border border-[#515151] bg-[#202020]/95 px-2.5 py-1.5 font-mono text-[11px] text-[#e3e3e3] shadow-lg">
            Δ x {Math.round(distance.horizontal)} · y {Math.round(distance.vertical)} px
          </div>
        ) : null}
      </div>
    </section>
  );
}
