"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import type { CanvasFrameChangeStatus, CanvasFrameOption } from "./FrameNavigator";
import { useCanvasViewport } from "./useCanvasViewport";
import { attachCanvasWheelZoom } from "./canvas-wheel-zoom";
import { getCanvasImageRenderPlan } from "./canvas-image-plan";
import { getVisibleCanvasOverlayNodes } from "./visible-canvas-overlay-nodes";
import { canvasAnchorAtPoint, canvasAnchorToViewportPoint } from "./canvas-anchor";
import { CommentPin, type HandoffComment } from "../comments/CommentPin";
import type { PendingCommentPoint } from "../comments/CommentThread";
import { layoutCommentPins } from "../comments/comment-pin-layout";
import { LayoutGridOverlay } from "./LayoutGridOverlay";
import { comparisonFrameStatusLabel } from "./compare-presentation";
import { getCanvasFrameLabelMaxWidth, shouldShowCanvasFrameLabel } from "./canvas-frame-label-visibility";
import { getElementDistanceGuides, type ElementRect } from "./element-distance-guides";
import { formatPixelValue } from "./format-captured-measurement";

export type CanvasViewportControls = {
  scale: number;
  fitToFrame: () => void;
  zoomOut: () => void;
  zoomIn: () => void;
};

type CanvasViewportProps = {
  frame: CanvasFrameOption;
  overviewOrigin: { sourceX: number; sourceY: number };
  interactionMode: "view" | "inspect";
  screens: CanvasFrameOption[];
  changedOnly: boolean;
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
  return status && status !== "unchanged" ? comparisonFrameStatusLabel(status) : null;
}

type MeasuredRect = {
  x: { value: number | null };
  y: { value: number | null };
  width: { value: number | null };
  height: { value: number | null };
};

function elementRectInFrame(
  bounds: MeasuredRect | undefined,
  frame: Pick<CanvasFrameOption, "kind" | "sourceX" | "sourceY">,
): ElementRect | null {
  if (!bounds) return null;
  const x = bounds.x.value;
  const y = bounds.y.value;
  const width = bounds.width.value;
  const height = bounds.height.value;
  if (
    typeof x !== "number" || !Number.isFinite(x) ||
    typeof y !== "number" || !Number.isFinite(y) ||
    typeof width !== "number" || !Number.isFinite(width) ||
    typeof height !== "number" || !Number.isFinite(height)
  ) return null;
  return {
    x: x - (frame.kind === "overview" ? frame.sourceX : 0),
    y: y - (frame.kind === "overview" ? frame.sourceY : 0),
    width,
    height,
  };
}

const measurementGuideColor = "#f24e1e";

export function CanvasViewport({
  frame,
  overviewOrigin,
  interactionMode,
  screens,
  changedOnly,
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
  const [hoveredNode, setHoveredNode] = useState<{ nodeId: string; frameId: string } | null>(null);
  const hoveredNodeId = hoveredNode?.frameId === frame.id ? hoveredNode.nodeId : null;
  const { containerRef, viewportSize, transform, fitToFrame, zoomBy, zoomAt, panBy } = useCanvasViewport(
    frame.sourceWidth,
    frame.sourceHeight,
  );
  const controls = useMemo<CanvasViewportControls>(() => ({
    scale: transform.scale,
    fitToFrame,
    zoomOut: () => zoomBy(1 / 1.2),
    zoomIn: () => zoomBy(1.2),
  }), [fitToFrame, transform.scale, zoomBy]);
  const visibleScreenIds = useMemo(() => new Set(screens.map((screen) => screen.id)), [screens]);

  useEffect(() => onViewportChange(controls), [controls, onViewportChange]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    return attachCanvasWheelZoom(container, zoomAt);
  }, [containerRef, zoomAt]);

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

    const anchor = canvasAnchorAtPoint(
      frame,
      screens,
      { x: localX, y: localY },
      nodeButton?.dataset.sourceNodeId ?? null,
    );
    const sourceX = localX + frame.sourceX;
    const sourceY = localY + frame.sourceY;
    const screen = screens.find((candidate) =>
      sourceX >= candidate.sourceX && sourceY >= candidate.sourceY &&
      sourceX <= candidate.sourceX + candidate.sourceWidth &&
      sourceY <= candidate.sourceY + candidate.sourceHeight,
    );

    if (commentMode) {
      if (anchor) onPlaceComment(anchor);
      return;
    }

    if (annotationMode) {
      if (anchor) onPlaceAnnotation(anchor);
      return;
    }

    if (!nodeButton && screen) onSelectFrame(screen.id);
  }

  const commentPins = layoutCommentPins(comments, screens, frame, showResolvedPins, overviewOrigin);
  const annotationPins = annotations.flatMap((annotation) => {
    const position = canvasAnchorToViewportPoint(annotation, frame, screens, overviewOrigin);
    if (!position) return [];
    return [{
      annotation,
      x: position.x,
      y: position.y,
    }];
  });
  const inverseScale = 1 / Math.max(transform.scale, 0.01);
  const canvasFrameLabelMaxWidth = getCanvasFrameLabelMaxWidth(viewportSize.width, transform.scale);
  const overviewResolutionScale = Math.min(
    frame.pixelWidth / Math.max(frame.sourceWidth, 1),
    frame.pixelHeight / Math.max(frame.sourceHeight, 1),
  );
  const imageRenderPlan = getCanvasImageRenderPlan({
    kind: frame.kind,
    exact: frame.exact,
    changedOnly,
    frameVisible: visibleScreenIds.has(frame.id),
    hasScreenFrames: screens.length > 0,
    zoomScale: transform.scale,
    overviewResolutionScale,
  });
  const sourceOverlayNodes = frame.overlayNodes ?? frame.nodes;
  const overlayNodes = useMemo(
    () => frame.kind === "overview" && changedOnly
      ? sourceOverlayNodes.filter((node) => visibleScreenIds.has(node.sourceFrameId))
      : sourceOverlayNodes,
    [changedOnly, frame.kind, sourceOverlayNodes, visibleScreenIds],
  );
  const overlayNodesById = useMemo(
    () => new Map(overlayNodes.map((node) => [node.sourceNodeId, node] as const)),
    [overlayNodes],
  );
  const highlightedNodeIdSet = useMemo(() => new Set(highlightedNodeIds), [highlightedNodeIds]);
  const selectedBounds = selectedNodeId ? overlayNodesById.get(selectedNodeId)?.bounds : undefined;
  const hoveredBounds = hoveredNodeId ? overlayNodesById.get(hoveredNodeId)?.bounds : undefined;
  const visibleOverlayNodes = useMemo(() => {
    if (interactionMode !== "inspect" && !commentMode && !annotationMode) return [];
    return getVisibleCanvasOverlayNodes({
      nodes: overlayNodes,
      frameWidth: frame.sourceWidth,
      frameHeight: frame.sourceHeight,
      frameOriginX: frame.kind === "overview" ? frame.sourceX : 0,
      frameOriginY: frame.kind === "overview" ? frame.sourceY : 0,
      viewportWidth: viewportSize.width,
      viewportHeight: viewportSize.height,
      offsetX: transform.offsetX,
      offsetY: transform.offsetY,
      scale: transform.scale,
      selectedNodeId,
      highlightedNodeIds,
    });
  }, [
    annotationMode,
    commentMode,
    frame.kind,
    frame.sourceHeight,
    frame.sourceWidth,
    frame.sourceX,
    frame.sourceY,
    highlightedNodeIds,
    interactionMode,
    overlayNodes,
    selectedNodeId,
    transform.offsetX,
    transform.offsetY,
    transform.scale,
    viewportSize.height,
    viewportSize.width,
  ]);
  const selectedRect = elementRectInFrame(selectedBounds, frame);
  const hoveredRect = elementRectInFrame(hoveredBounds, frame);
  const distanceGuides = interactionMode === "inspect" && altHeld && selectedNodeId && hoveredNodeId &&
    selectedNodeId !== hoveredNodeId && selectedRect && hoveredRect
    ? getElementDistanceGuides(selectedRect, hoveredRect)
    : [];
  const distanceAnnouncement = distanceGuides
    .map((guide) => (guide.axis === "horizontal" ? "Horizontal" : "Vertical") + " gap " + formatPixelValue(guide.distance) + " pixels")
    .join(". ");

  return (
    <section aria-label="Design canvas" className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#1d1d1d]">
      <div
        aria-describedby="canvas-keyboard-help"
        aria-label={interactionMode === "inspect"
          ? "Inspect mode. Select a highlighted element to inspect it, drag to pan, and use the scroll wheel or trackpad pinch to zoom."
          : "View mode. Drag to pan and use the scroll wheel or trackpad pinch to zoom. Switch to Inspect to select design elements."}
        className={"review-dot-grid group relative grid min-h-0 min-w-0 flex-1 touch-none place-items-center overflow-hidden outline-none focus-visible:outline-none " + (commentMode || annotationMode ? "cursor-crosshair" : isDragging ? "cursor-grabbing" : "cursor-grab")}
        onClick={handleCanvasClick}
        onPointerCancel={handlePointerCancel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onKeyDown={handleCanvasKeyDown}
        ref={containerRef}
        role="region"
        tabIndex={0}
      >
        <span className="sr-only" id="canvas-keyboard-help">
          Focus this canvas, then use the arrow keys to pan, plus or minus to zoom, and zero or Home to fit the design. To inspect a layer, expand Elements in the screen sidebar and choose it.
        </span>
        <span aria-hidden="true" className="pointer-events-none absolute left-3 top-3 z-30 hidden rounded-[4px] border border-[#505050] bg-[#202020]/95 px-2 py-1 text-[10px] font-medium text-[#d7d7d7] group-focus-visible:flex">
          Canvas focus
        </span>
        <div
          className="absolute left-1/2 top-1/2 shrink-0"
          style={{
            width: frame.sourceWidth,
            height: frame.sourceHeight,
              marginLeft: -frame.sourceWidth / 2,
              marginTop: -frame.sourceHeight / 2,
            transform: "translate(" + transform.offsetX + "px, " + transform.offsetY + "px) scale(" + transform.scale + ")",
            transformOrigin: "center center",
          }}
        >
          {imageRenderPlan.showBaseImage ? (
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
          ) : null}

          {imageRenderPlan.showFrameImages ? screens.map((screen) => (
            <Image
              alt={(screen.fileName.toLowerCase().endsWith(".svg") ? "Figma vector render: " : "Frozen design render: ") + screen.name}
              className="pointer-events-none absolute select-none object-fill"
              draggable={false}
              height={screen.pixelHeight}
              key={screen.id}
              loading="lazy"
              src={screen.imageSrc}
              style={{
                left: screen.sourceX - frame.sourceX,
                top: screen.sourceY - frame.sourceY,
                width: screen.sourceWidth,
                height: screen.sourceHeight,
              }}
              unoptimized
              width={screen.pixelWidth}
            />
          )) : null}

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
            const showLabel = shouldShowCanvasFrameLabel(transform.scale, selected, screens.length);
              const captureOnly = status === "only-in-before-capture" || status === "only-in-after-capture";
              const borderColor = status === "changed" ? "#e3a13a" : status === "added" ? "#55c987" : status === "removed" ? "#df7770" : captureOnly ? "#b99a5d" : selected ? "#888888" : "#4c4c4c";
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
                  {showLabel ? (
                    <div
                    className="pointer-events-auto absolute left-0 flex items-center gap-1 whitespace-nowrap"
                  style={{
                    bottom: "100%",
                    marginBottom: 4 * inverseScale,
                    maxWidth: canvasFrameLabelMaxWidth + "px",
                  }}
                >
                    <button
                      aria-label={"Select screen " + screen.name + (label ? ", " + label : "")}
                        aria-pressed={selected}
                      className="flex max-w-none items-center gap-1.5 rounded-[4px] bg-[#202020]/95 text-left text-[#d7d7d7] shadow-sm hover:bg-[#303030] focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
                      onClick={() => onSelectFrame(screen.id)}
                      style={{
                        minHeight: 24 * inverseScale + "px",
                        padding: 3 * inverseScale + "px " + 5 * inverseScale + "px",
                        fontSize: 12 * inverseScale + "px",
                        lineHeight: 1.3,
                        border: "1px solid " + borderColor,
                        maxWidth: canvasFrameLabelMaxWidth + "px",
                      }}
                      type="button"
                    >
                      <span className="max-w-[28ch] truncate">{screen.name}</span>
                        <span className="font-mono text-[#999]" style={{ fontSize: 10 * inverseScale + "px" }}>
                        {formatPixelValue(screen.sourceWidth)}×{formatPixelValue(screen.sourceHeight)}
                      </span>
                      {label ? (
                        <span
                          className="rounded-[3px] font-medium"
                          style={{
                            padding: 2 * inverseScale + "px " + 4 * inverseScale + "px",
                            fontSize: 10 * inverseScale + "px",
                            color: status === "added" ? "#76e0a5" : status === "removed" || status === "only-in-before-capture" ? "#f18b84" : "#ffca71",
                            backgroundColor: status === "added" ? "#173b2b" : status === "removed" || status === "only-in-before-capture" ? "#3b2323" : "#46351e",
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
                        style={{ minHeight: 24 * inverseScale + "px", padding: 3 * inverseScale + "px " + 5 * inverseScale + "px", fontSize: 11 * inverseScale + "px" }}
                        type="button"
                      >
                        Compare
                      </button>
                    ) : null}
                    </div>
                  ) : null}
              </div>
            );
          }) : null}

          {visibleOverlayNodes.map((node) => {
            const x = node.bounds.x.value === null ? null : node.bounds.x.value - (frame.kind === "overview" ? frame.sourceX : 0);
            const y = node.bounds.y.value === null ? null : node.bounds.y.value - (frame.kind === "overview" ? frame.sourceY : 0);
            const width = node.bounds.width.value;
            const height = node.bounds.height.value;
            if (x === null || y === null || width === null || height === null || width <= 0 || height <= 0) return null;
            const isSelected = node.sourceNodeId === selectedNodeId;
            const isHighlighted = highlightedNodeIdSet.has(node.sourceNodeId);
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
                onMouseEnter={() => { if (interactionMode === "inspect") setHoveredNode({ nodeId: node.sourceNodeId, frameId: frame.id }); }}
                onMouseLeave={() => { if (interactionMode === "inspect") setHoveredNode(null); }}
                style={{ left: x, top: y, width, height }}
                type="button"
              />
            );
          })}

          {distanceGuides.length ? (
            <svg
              aria-hidden="true"
              className="pointer-events-none absolute left-0 top-0 z-10 overflow-visible"
              height={frame.sourceHeight}
              viewBox={`0 0 ${frame.sourceWidth} ${frame.sourceHeight}`}
              width={frame.sourceWidth}
            >
              {distanceGuides.map((guide) => {
                const segments = [guide.segment, ...guide.extensions];
                const label = formatPixelValue(guide.distance);
                const badgeWidth = Math.max(26, label.length * 7.5 + 10) * inverseScale;
                const badgeHeight = 18 * inverseScale;
                const badgeX = guide.axis === "horizontal"
                  ? guide.labelX - badgeWidth / 2
                  : guide.labelX - 2 * inverseScale;
                return (
                  <g key={guide.axis}>
                    {segments.map((segment, index) => (
                      <line
                        key={`${guide.axis}-segment-${index}`}
                        stroke={measurementGuideColor}
                        strokeLinecap="round"
                        strokeOpacity={index === 0 ? 1 : 0.7}
                        strokeWidth={1}
                        vectorEffect="non-scaling-stroke"
                        x1={segment.x1}
                        x2={segment.x2}
                        y1={segment.y1}
                        y2={segment.y2}
                      />
                    ))}
                    <rect
                      fill={measurementGuideColor}
                      height={badgeHeight}
                      rx={2 * inverseScale}
                      width={badgeWidth}
                      x={badgeX}
                      y={guide.labelY - badgeHeight / 2}
                    />
                    <text
                      dominantBaseline="middle"
                      fill="#fff"
                      fontFamily="system-ui, sans-serif"
                      fontSize={12 * inverseScale}
                      fontWeight={600}
                      textAnchor="middle"
                      x={badgeX + badgeWidth / 2}
                      y={guide.labelY}
                    >
                      {label}
                    </text>
                  </g>
                );
              })}
            </svg>
          ) : null}

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
        <span aria-atomic="true" aria-live="polite" className="sr-only">{distanceAnnouncement}</span>
      </div>
    </section>
  );
}
