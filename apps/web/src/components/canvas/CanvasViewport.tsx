"use client";

import Image from "next/image";
import { RetryingCanvasImage } from "./RetryingImage";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import type { CanvasFrameChangeStatus, CanvasFrameOption } from "./FrameNavigator";
import { useCanvasViewport } from "./useCanvasViewport";
import { attachCanvasWheelZoom } from "./canvas-wheel-zoom";
import { getCanvasImageRenderPlan } from "./canvas-image-plan";
import { getVisibleCanvasOverlayNodes } from "./visible-canvas-overlay-nodes";
import { canvasAnchorAtPoint, canvasAnchorToViewportPoint } from "./canvas-anchor";
import { CommentPin, type HandoffComment } from "../comments/CommentPin";
import type { PendingCommentPoint } from "../comments/CommentThread";
import { layoutCommentPins } from "../comments/comment-pin-layout";
import { CanvasCommentPopover } from "../comments/CanvasCommentPopover";
import { LayoutGridOverlay } from "./LayoutGridOverlay";
import { comparisonFrameStatusShortLabel } from "./compare-presentation";
import { shouldShowCanvasFrameLabel } from "./canvas-frame-label-visibility";
import { getElementDistanceGuides, type ElementRect } from "./element-distance-guides";
import { formatPrecisePixelValue } from "./format-captured-measurement";
import { overviewClipPath } from "./overview-clip";
import { CanvasScreenImages } from "./CanvasScreenImages";
import { resolutionNeed, sameScreenIds, screensInView } from "./canvas-screen-culling";
import { createZoomScaleSource, type ZoomScaleSource } from "./zoom-scale-source";

/** Re-reads devicePixelRatio when the window moves to a screen with a different density, or zooms. */
function subscribeToPixelRatio(onChange: () => void) {
  const query = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
  query.addEventListener("change", onChange);
  window.addEventListener("resize", onChange);
  return () => {
    query.removeEventListener("change", onChange);
    window.removeEventListener("resize", onChange);
  };
}

/** CSS mask that hides the given rectangles of an image (xor/exclude of a full layer and each rect). */
function cutOutMaskStyle(rects: CanvasFrameOption["maskRects"]) {
  if (!rects?.length) return {};
  const layers = ["linear-gradient(#000 0 0)", ...rects.map(() => "linear-gradient(#000 0 0)")].join(", ");
  const sizes = ["100% 100%", ...rects.map((rect) => `${rect.width}px ${rect.height}px`)].join(", ");
  const positions = ["0 0", ...rects.map((rect) => `${rect.x}px ${rect.y}px`)].join(", ");
  return {
    maskImage: layers,
    WebkitMaskImage: layers,
    maskSize: sizes,
    WebkitMaskSize: sizes,
    maskPosition: positions,
    WebkitMaskPosition: positions,
    maskRepeat: "no-repeat",
    WebkitMaskRepeat: "no-repeat",
    maskComposite: "exclude",
    WebkitMaskComposite: "xor",
  } as const;
}

export type CanvasViewportControls = {
  /** The live zoom (null until the canvas has been fitted). A store rather than a number, so a zoom
   * gesture updates the readout without handing the page a new value, and re-rendering it, every frame. */
  scale: ZoomScaleSource;
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
  /** Elements that changed in this version, outlined when "Changes" is on. */
  changedNodeIds?: string[];
  /** Colour changed and new screens (border and label chip). Off when "Changes" is toggled off. */
  changesVisible?: boolean;
  /** Remembers pan and zoom for this canvas (per handoff and screen). */
  viewMemoryKey?: string | null;
  showResolvedPins: boolean;
  selectedNodeId: string | null;
  onSelectNode: (sourceNodeId: string) => void;
  onSelectFrame: (frameId: string, event?: { shiftKey: boolean }) => void;
  /** Screens picked for removal: shown with a check and a tint. */
  pickedFrameIds?: Set<string>;
  /** Select mode: a click on a screen marks it instead of opening it. */
  pickingFrames?: boolean;
  comments: HandoffComment[];
  selectedCommentId: string | null;
  commentMode: boolean;
  onSelectComment: (commentId: string) => void;
  onPlaceComment: (point: PendingCommentPoint) => void;
  /** Figma-style anchored comments: the composer for a new pin and the open thread. */
  commentPopover?: {
    pendingPoint: PendingCommentPoint | null;
    threadOpen: boolean;
    canWrite: boolean;
    canResolve: boolean;
    onCreate: (body: string, point: PendingCommentPoint, attachmentIds: string[]) => Promise<void>;
    onReply: (parentCommentId: string, body: string, attachmentIds: string[]) => Promise<void>;
    onResolve: (commentId: string, resolved: boolean) => Promise<void>;
    onClose: () => void;
  };
  annotations: Array<{ id: string; frameId: string; sourceNodeId: string | null; x: number; y: number; title: string; body: string; authorName: string }>;
  selectedAnnotationId: string | null;
  annotationMode: boolean;
  onSelectAnnotation: (annotationId: string) => void;
  onPlaceAnnotation: (point: PendingCommentPoint) => void;
  onViewportChange: (controls: CanvasViewportControls) => void;
  /** Bump `seq` to centre and zoom to a screen (picked from the list, search, or [ and ]), or to one element on it. */
  focusRequest?: { frameId: string; nodeId?: string; seq: number } | null;
};

function statusLabel(status: CanvasFrameChangeStatus | undefined) {
  return comparisonFrameStatusShortLabel(status);
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
  changedNodeIds = [],
  changesVisible = true,
  viewMemoryKey = null,
  showResolvedPins,
  selectedNodeId,
  onSelectNode,
  onSelectFrame,
  pickedFrameIds,
  pickingFrames = false,
  comments,
  selectedCommentId,
  commentMode,
  onSelectComment,
  onPlaceComment,
  commentPopover,
  annotations,
  selectedAnnotationId,
  annotationMode,
  onSelectAnnotation,
  onPlaceAnnotation,
  onViewportChange,
  focusRequest = null,
}: CanvasViewportProps) {
  const dragRef = useRef<{ pointerId: number; x: number; y: number; startX: number; startY: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  const [altHeld, setAltHeld] = useState(false);
  // Holding Space pans with a drag from any tool, as in Figma; clicks don't select or place anything.
  const [spaceHeld, setSpaceHeld] = useState(false);
  const spaceHeldRef = useRef(false);
  const [hoveredNode, setHoveredNode] = useState<{ nodeId: string; frameId: string } | null>(null);
  const hoveredNodeId = hoveredNode?.frameId === frame.id ? hoveredNode.nodeId : null;
  // Fit shows the screens, not the whole Figma page they were captured from (often mostly empty).
  const screensRect = useMemo(() => {
    if (frame.kind !== "overview" || !screens.length) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const screen of screens) {
      minX = Math.min(minX, screen.sourceX - frame.sourceX);
      minY = Math.min(minY, screen.sourceY - frame.sourceY);
      maxX = Math.max(maxX, screen.sourceX - frame.sourceX + screen.sourceWidth);
      maxY = Math.max(maxY, screen.sourceY - frame.sourceY + screen.sourceHeight);
    }
    return Number.isFinite(minX) ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : null;
  }, [frame.kind, frame.sourceX, frame.sourceY, screens]);
  const { containerRef, viewportSize, transform, interacting, fitted, fitToFrame, zoomToRect, centerOn, zoomBy, zoomAt, panBy } = useCanvasViewport(
    frame.sourceWidth,
    frame.sourceHeight,
    viewMemoryKey,
    screensRect,
  );
  const [minimapVisible, setMinimapVisible] = useState(true);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the preference lives in localStorage, only readable after mount.
      if (localStorage.getItem("asbir.canvas.minimap") === "0") setMinimapVisible(false);
    } catch {
      // Storage blocked: the minimap just shows.
    }
  }, []);
  const [scaleSource] = useState(createZoomScaleSource);
  useEffect(() => scaleSource.set(fitted ? transform.scale : null), [fitted, scaleSource, transform.scale]);
  const controls = useMemo<CanvasViewportControls>(() => ({
    scale: scaleSource,
    fitToFrame,
    zoomOut: () => zoomBy(1 / 1.2),
    zoomIn: () => zoomBy(1.2),
  }), [fitToFrame, scaleSource, zoomBy]);
  const visibleScreenIds = useMemo(() => new Set(screens.map((screen) => screen.id)), [screens]);

  useEffect(() => onViewportChange(controls), [controls, onViewportChange]);

  // Bring a requested screen into view. Read the screens through a ref so a re-render of the list
  // doesn't re-run an old request after the person has panned away.
  const screensRef = useRef(screens);
  const frameOriginRef = useRef({ x: frame.sourceX, y: frame.sourceY, kind: frame.kind });
  useEffect(() => {
    screensRef.current = screens;
    frameOriginRef.current = { x: frame.sourceX, y: frame.sourceY, kind: frame.kind };
  });
  const focusOnScreen = useCallback((frameId: string) => {
    const origin = frameOriginRef.current;
    if (origin.kind !== "overview") return;
    const screen = screensRef.current.find((entry) => entry.id === frameId);
    if (!screen) return;
    zoomToRect({ x: screen.sourceX - origin.x, y: screen.sourceY - origin.y, width: screen.sourceWidth, height: screen.sourceHeight });
  }, [zoomToRect]);
  const overlayNodesRef = useRef<Map<string, { bounds: MeasuredRect }>>(new Map());
  useEffect(() => {
    if (!focusRequest) return;
    const node = focusRequest.nodeId ? overlayNodesRef.current.get(focusRequest.nodeId) : undefined;
    const origin = frameOriginRef.current;
    const rect = node ? elementRectInFrame(node.bounds, { kind: origin.kind, sourceX: origin.x, sourceY: origin.y }) : null;
    if (rect && rect.width > 0 && rect.height > 0) {
      // Leave room around the element so its surroundings stay readable.
      const pad = Math.max(160, Math.max(rect.width, rect.height) * 0.6);
      zoomToRect({ x: rect.x - pad, y: rect.y - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 });
    } else {
      focusOnScreen(focusRequest.frameId);
    }
  }, [focusOnScreen, focusRequest, zoomToRect]);
  // A shared link to a screen (#screen=…) opens zoomed on that screen, not on the whole canvas.
  const linkFocusedRef = useRef(false);
  useEffect(() => {
    if (linkFocusedRef.current) return;
    linkFocusedRef.current = true;
    const linked = new URLSearchParams(window.location.hash.slice(1)).get("screen");
    if (linked) focusOnScreen(linked);
  }, [focusOnScreen]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    return attachCanvasWheelZoom(container, zoomAt, panBy);
  }, [containerRef, panBy, zoomAt]);

  useEffect(() => {
    const setSpace = (held: boolean) => {
      spaceHeldRef.current = held;
      setSpaceHeld(held);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Alt") setAltHeld(true);
      // M shows or hides the minimap.
      if (event.key.toLowerCase() === "m" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        const typing = event.target instanceof HTMLElement && (event.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName));
        if (!typing) {
          setMinimapVisible((current) => {
            try {
              localStorage.setItem("asbir.canvas.minimap", current ? "0" : "1");
            } catch {
              // Storage blocked: the choice isn't remembered.
            }
            return !current;
          });
        }
      }
      if (event.code !== "Space" || event.metaKey || event.ctrlKey || event.altKey) return;
      // Only take Space when focus is on the page or the canvas, so it still presses focused buttons
      // and types in fields.
      const target = event.target as HTMLElement | null;
      const onCanvas = !target || target === document.body || Boolean(containerRef.current?.contains(target));
      if (!onCanvas || target?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "")) return;
      event.preventDefault();
      if (!spaceHeldRef.current) setSpace(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Alt") setAltHeld(false);
      if (event.code === "Space" && spaceHeldRef.current) setSpace(false);
    };
    const clearAlt = () => {
      setAltHeld(false);
      setSpace(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", clearAlt);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", clearAlt);
    };
  }, [containerRef]);

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    // Shift-click marks screens; stop the browser from also selecting text across the page.
    if (event.shiftKey) {
      event.preventDefault();
      window.getSelection()?.removeAllRanges();
    }
    const target = event.target as HTMLElement;
    const spacePan = spaceHeldRef.current && event.button === 0;
    if (!spacePan) {
      if (commentMode || annotationMode || event.button !== 0 || target.closest("[data-comment-pin], [data-canvas-annotation]")) return;
      if (target.closest("button") && !target.closest("[data-source-node-id]")) return;
    }
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
      // A Space-held click that didn't drag still shouldn't select or place anything.
      if (!drag.moved && spaceHeldRef.current) suppressClickRef.current = true;
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
    else if (event.key === "Home") fitToFrame();
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

    if (screen && (!nodeButton || event.shiftKey || pickingFrames)) onSelectFrame(screen.id, { shiftKey: event.shiftKey });
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
  // Borders, labels and image sizes follow the zoom only once a gesture settles. While zooming they
  // stay as they were, so the canvas layer's content doesn't change and the browser can scale the
  // picture it already drew instead of redrawing every screen on every frame.
  const [settledScale, setSettledScale] = useState(transform.scale);
  if (!interacting && settledScale !== transform.scale) setSettledScale(transform.scale);
  const visualScale = interacting ? settledScale : transform.scale;
  const inverseScale = 1 / Math.max(visualScale, 0.01);
  // Flip the comment popover to the pin's left when it would run off the viewport's right edge
  // and the left side has more room.
  const popoverFlips = (x: number) => {
    const pinX = (x - frame.sourceWidth / 2) * transform.scale + transform.offsetX + viewportSize.width / 2;
    return pinX + 340 > viewportSize.width && pinX > viewportSize.width - pinX;
  };
  const openThreadPin = commentPopover?.threadOpen
    ? commentPins.find(({ comment }) => comment.id === selectedCommentId) ?? null
    : null;
  const pendingCommentPosition = commentPopover?.pendingPoint
    ? canvasAnchorToViewportPoint(commentPopover.pendingPoint, frame, screens, overviewOrigin)
    : null;
  const openThreadKey = openThreadPin ? openThreadPin.comment.id : null;
  const openThreadPoint = openThreadPin ? { x: openThreadPin.comment.x, y: openThreadPin.comment.y } : null;

  // When a thread opens off-screen (e.g. picked from the list), pan so its pin and popover fit.
  useEffect(() => {
    const point = openThreadPoint;
    if (!openThreadKey || !point || !viewportSize.width) return;
    const screenX = (point.x - frame.sourceWidth / 2) * transform.scale + transform.offsetX + viewportSize.width / 2;
    const screenY = (point.y - frame.sourceHeight / 2) * transform.scale + transform.offsetY + viewportSize.height / 2;
    const margin = 48;
    const fits = screenX >= margin && screenX <= viewportSize.width - margin && screenY >= margin && screenY <= viewportSize.height - 200;
    if (!fits) panBy(viewportSize.width * 0.4 - screenX, viewportSize.height * 0.3 - screenY);
    // Only re-center when a different thread opens, not on every pan or zoom.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openThreadKey]);
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
    zoomScale: visualScale,
    overviewResolutionScale,
  });
  // Only screens near the viewport are drawn. The list keeps its identity while the same screens
  // stay in view, so the memoised image layer doesn't re-render as the canvas pans.
  const inViewScreens = frame.kind === "overview"
    ? screensInView(screens, {
        frameSourceX: frame.sourceX,
        frameSourceY: frame.sourceY,
        frameWidth: frame.sourceWidth,
        frameHeight: frame.sourceHeight,
        viewportWidth: viewportSize.width,
        viewportHeight: viewportSize.height,
        offsetX: transform.offsetX,
        offsetY: transform.offsetY,
        scale: transform.scale,
      })
    : screens;
  const [stableInViewScreens, setStableInViewScreens] = useState(inViewScreens);
  if (!sameScreenIds(stableInViewScreens, inViewScreens)) setStableInViewScreens(inViewScreens);
  const devicePixelRatio = useSyncExternalStore(subscribeToPixelRatio, () => window.devicePixelRatio || 1, () => 1);
  const imageNeed = resolutionNeed(visualScale, devicePixelRatio);
  // The backdrop reaches about one overview pixel past the edge to cover the soft image's bleed.
  // Not needed when the overview is clipped to the screens' edges: nothing soft shows past them,
  // and a canvas-coloured rim would show as a dark border on a light section.
  const backdropBleed = frame.keepRects ? 0 : Math.ceil(1.5 / Math.max(overviewResolutionScale, 0.05));
  // Behind a screen in a section, the backdrop takes the section's colour, so a transparent screen
  // shows the section through it as it does in Figma.
  const backdropColors = useMemo(() => {
    const colors = new Map<string, string>();
    for (const section of frame.kind === "overview" ? frame.sections ?? [] : []) {
      if (!section.fill || section.fill.length !== 7) continue;
      for (const frameId of section.frameIds) colors.set(frameId, section.fill);
    }
    return colors;
  }, [frame.kind, frame.sections]);
  const sectionFrameIds = useMemo(
    () => new Set(frame.kind === "overview" ? (frame.sections ?? []).flatMap((section) => section.frameIds) : []),
    [frame.kind, frame.sections],
  );
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
  const changedRects = useMemo(() => changedNodeIds.flatMap((nodeId) => {
    const node = overlayNodesById.get(nodeId);
    const rect = node ? elementRectInFrame(node.bounds, frame) : null;
    return rect && rect.width > 0 && rect.height > 0 ? [{ nodeId, rect }] : [];
  }), [changedNodeIds, frame, overlayNodesById]);
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
  useEffect(() => {
    overlayNodesRef.current = overlayNodesById;
  });
  const selectedRect = elementRectInFrame(selectedBounds, frame);
  const hoveredRect = elementRectInFrame(hoveredBounds, frame);
  const hoveredOverlayNode = hoveredNodeId ? overlayNodesById.get(hoveredNodeId) : undefined;
  const distanceGuides = interactionMode === "inspect" && altHeld && selectedNodeId && hoveredNodeId &&
    selectedNodeId !== hoveredNodeId && selectedRect && hoveredRect
    ? getElementDistanceGuides(selectedRect, hoveredRect)
    : [];
  const distanceAnnouncement = distanceGuides
    .map((guide) => (guide.axis === "horizontal" ? "Horizontal" : "Vertical") + " gap " + formatPrecisePixelValue(guide.distance) + " pixels")
    .join(". ");

  return (
    <section aria-label="Design canvas" className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface">
      <div
        aria-describedby="canvas-keyboard-help"
        aria-label={interactionMode === "inspect"
          ? "Inspect mode. Select a highlighted element to inspect it, scroll or drag to pan, and use Ctrl or Command + scroll or a trackpad pinch to zoom."
          : "View mode. Scroll or drag to pan and use Ctrl or Command + scroll or a trackpad pinch to zoom. Switch to Inspect to select design elements."}
        className={"review-dot-grid group relative grid min-h-0 min-w-0 flex-1 touch-none place-items-center overflow-hidden outline-none focus-visible:outline-none " + (isDragging ? "cursor-grabbing" : spaceHeld ? "cursor-grab" : commentMode || annotationMode ? "cursor-crosshair" : "cursor-grab")}
        data-canvas-viewport=""
        data-space-pan={spaceHeld ? "" : undefined}
        onClick={handleCanvasClick}
        onPointerCancel={handlePointerCancel}
        onMouseDown={(event) => {
          if (event.shiftKey) event.preventDefault();
        }}
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
        <span aria-hidden="true" className="pointer-events-none absolute left-3 top-3 z-30 hidden rounded-chip border border-border-strong bg-surface/95 px-2 py-1 text-[10px] font-medium text-foreground-muted group-focus-visible:flex">
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
            // Hidden until the first fit, so the canvas doesn't flash at a placeholder zoom while loading.
            visibility: fitted ? undefined : "hidden",
            transformOrigin: "center center",
            // Its own GPU layer only while moving; afterwards it's redrawn sharp at the new zoom.
            willChange: interacting ? "transform" : undefined,
          }}
        >
          {frame.kind === "overview" && frame.exact ? frame.sections?.map((section) => (
            // Under the screens (z-index -1 stays inside this transformed layer), like a section in Figma.
            <div
              aria-hidden="true"
              className="pointer-events-none absolute"
              key={"section:" + section.id}
              style={{
                left: section.x,
                top: section.y,
                width: section.width,
                height: section.height,
                zIndex: -1,
                backgroundColor: section.fill ?? undefined,
                border: inverseScale + "px solid rgba(255, 255, 255, 0.16)",
                borderRadius: 4 * inverseScale,
              }}
            >
              {section.width * visualScale >= 72 ? (
                // Above the section's top-left corner, like Figma, so it never covers the screens inside.
                <span
                  className="absolute max-w-full truncate rounded-chip bg-surface/95 font-medium text-foreground-muted shadow-sm"
                  style={{
                    left: 0,
                    bottom: "100%",
                    marginBottom: 4 * inverseScale,
                    maxWidth: section.width,
                    padding: 3 * inverseScale + "px " + 7 * inverseScale + "px",
                    borderRadius: 7 * inverseScale,
                    fontSize: 12 * inverseScale,
                    lineHeight: 1.3,
                  }}
                  title={section.name}
                >
                  {section.name}
                </span>
              ) : null}
            </div>
          )) : null}

          {imageRenderPlan.showBaseImage ? (
            <RetryingCanvasImage
              alt={(frame.fileName.toLowerCase().endsWith(".svg") ? "Figma vector render: " : "Frozen design render: ") + frame.name}
              className="pointer-events-none select-none object-fill"
              draggable={false}
              height={frame.pixelHeight}
              priority
              src={frame.imageSrc}
              style={{ width: frame.sourceWidth, height: frame.sourceHeight, ...cutOutMaskStyle(frame.maskRects), clipPath: overviewClipPath(frame.keepRects) }}
              unoptimized
              width={frame.pixelWidth}
            />
          ) : null}

          {imageRenderPlan.showFrameImages ? (
            <CanvasScreenImages
              backdrops={imageRenderPlan.showBaseImage}
              bleed={backdropBleed}
              backdropColors={backdropColors}
              need={imageNeed}
              originX={frame.sourceX}
              originY={frame.sourceY}
              screens={stableInViewScreens}
            />
          ) : null}

          {layoutGridsVisible
            ? frame.kind === "overview" && frame.exact
              ? stableInViewScreens.map((screen) => (
                  <LayoutGridOverlay
                    frame={screen}
                    key={screen.id}
                    left={screen.sourceX - frame.sourceX}
                    top={screen.sourceY - frame.sourceY}
                  />
                ))
              : frame.kind === "frame" ? <LayoutGridOverlay frame={frame} /> : null
            : null}

            {frame.kind === "overview" && frame.exact ? stableInViewScreens.map((screen) => {
            const status = frameStatuses[screen.id];
            const label = changesVisible ? statusLabel(status) : null;
            const selected = screen.id === selectedFrameId;
            const showLabel = shouldShowCanvasFrameLabel(visualScale, selected, screens.length);
              const isNew = label === "New";
              const borderColor = label === "Changed" ? "#e3a13a" : isNew ? "#55c987" : selected ? "#888888" : "#4c4c4c";
            return (
              <div
                className="pointer-events-none absolute"
                key={screen.id}
                style={{
                  left: screen.sourceX - frame.sourceX,
                  top: screen.sourceY - frame.sourceY,
                  width: screen.sourceWidth,
                  height: screen.sourceHeight,
                  // On a section's fill (usually white) the grey outline reads as a heavy frame, so screens
                  // in a section only get one when it says something: changed, new, or a thin selection line.
                  border: sectionFrameIds.has(screen.id) && !label
                    ? selected ? inverseScale + "px solid " + borderColor : undefined
                    : (selected ? 3 : 1.5) * inverseScale + "px solid " + borderColor,
                }}
              >
                  {pickedFrameIds?.has(screen.id) ? (
                    <span aria-hidden="true" className="absolute inset-0 grid place-items-center bg-black/55 outline outline-danger" style={{ outlineWidth: 3 * inverseScale }}>
                      <span className="whitespace-nowrap rounded-full bg-danger font-semibold text-white shadow-lg" style={{ fontSize: 12 * inverseScale, padding: `${4 * inverseScale}px ${10 * inverseScale}px` }}>
                        Removing
                      </span>
                    </span>
                  ) : null}
                  {showLabel ? (
                    <div
                    className="pointer-events-auto absolute inset-x-0 z-20 flex items-center gap-1 whitespace-nowrap"
                  style={{
                    bottom: "100%",
                    marginBottom: 4 * inverseScale,
                  }}
                >
                    <button
                      aria-label={"Select screen " + screen.name + (label ? ", " + label : "")}
                        aria-pressed={selected}
                      className="flex min-w-0 flex-1 items-center gap-1.5 rounded-chip bg-surface/95 text-left text-foreground-muted shadow-sm hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
                      onClick={(event) => onSelectFrame(screen.id, { shiftKey: event.shiftKey })}
                      style={{
                        minHeight: 24 * inverseScale + "px",
                        borderRadius: 7 * inverseScale + "px",
                        padding: 3 * inverseScale + "px " + 6 * inverseScale + "px",
                        fontSize: 12 * inverseScale + "px",
                        lineHeight: 1.3,
                        border: "1px solid " + borderColor,
                      }}
                      type="button"
                    >
                      <span className="min-w-0 flex-1 truncate" title={screen.name}>{screen.name}</span>
                      {label ? (
                        <span
                          className="shrink-0 rounded-chip font-medium"
                          style={{
                            padding: 2 * inverseScale + "px " + 4 * inverseScale + "px",
                            borderRadius: 4 * inverseScale + "px",
                            fontSize: 10 * inverseScale + "px",
                            color: isNew ? "#76e0a5" : "#ffca71",
                            backgroundColor: isNew ? "#173b2b" : "#46351e",
                          }}
                        >
                          {label}
                        </span>
                      ) : null}
                    </button>
                    {canCompare && status === "changed" ? (
                      <button
                        aria-label={"Compare " + screen.name + " before and after this version"}
                        className="rounded-chip border border-border-strong bg-surface-muted/95 px-1.5 py-0.5 text-foreground-muted shadow-sm hover:bg-surface-raised hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
                        onClick={() => onCompareScreen(screen.id)}
                        style={{ minHeight: 24 * inverseScale + "px", borderRadius: 7 * inverseScale + "px", padding: 3 * inverseScale + "px " + 6 * inverseScale + "px", fontSize: 11 * inverseScale + "px" }}
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

          {changedRects.map(({ nodeId, rect }) => (
            <span
              aria-hidden="true"
              className="canvas-changed-outline pointer-events-none absolute"
              key={"changed:" + nodeId}
              style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height, borderWidth: 1.5 * inverseScale, borderRadius: 2 * inverseScale }}
            />
          ))}

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
                aria-label={"Select " + node.name + ", " + node.type + ", " + formatPrecisePixelValue(node.bounds.x.value ?? x) + ", " + formatPrecisePixelValue(node.bounds.y.value ?? y)}
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

          {interactionMode === "inspect" && hoveredRect && hoveredOverlayNode && !distanceGuides.length && !isDragging && !spaceHeld ? (
            // Name and size of the layer under the pointer, like Figma's hover label.
            <span
              aria-hidden="true"
              className="pointer-events-none absolute z-20 whitespace-nowrap rounded-[4px] bg-[#e3a13a] font-medium text-[#1a1203] shadow-sm"
              style={{
                left: hoveredRect.x,
                top: hoveredRect.y,
                transform: `translateY(calc(-100% - ${4 * inverseScale}px)) scale(${inverseScale})`,
                transformOrigin: "bottom left",
                padding: "2px 6px",
                fontSize: 11,
                lineHeight: "16px",
              }}
            >
              {hoveredOverlayNode.name || hoveredOverlayNode.type}
              <span className="ml-1.5 font-mono opacity-70">{formatPrecisePixelValue(hoveredRect.width)} × {formatPrecisePixelValue(hoveredRect.height)}</span>
            </span>
          ) : null}

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
                const label = formatPrecisePixelValue(guide.distance);
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
              className={"absolute z-20 max-w-none rounded-control border px-2.5 py-2 text-left shadow-xl " + (annotation.id === selectedAnnotationId ? "border-[#f3ce7e] bg-[#f4d89e] text-[#34260f]" : "border-[#d2b774] bg-[#f3dfb5] text-[#3e321a] hover:bg-[#f7e6c5]")}
              data-canvas-annotation
              key={annotation.id}
              onClick={() => onSelectAnnotation(annotation.id)}
              style={{
                left: x + 10 * inverseScale,
                top: y + 10 * inverseScale,
                width: 230,
                transform: `scale(${inverseScale})`,
                transformOrigin: "top left",
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
                inverseScale={inverseScale}
                selected={comment.id === selectedCommentId}
                onSelect={onSelectComment}
              />
            </span>
          ))}

          {commentPopover && pendingCommentPosition && commentPopover.pendingPoint ? (
            <>
              <span
                aria-hidden="true"
                className="pointer-events-none absolute z-30 grid size-7 place-items-center rounded-full border-2 border-primary-foreground bg-primary text-[12px] font-semibold text-primary-foreground shadow-lg"
                style={{ left: pendingCommentPosition.x - 14 * inverseScale, top: pendingCommentPosition.y - 14 * inverseScale, transform: `scale(${inverseScale})`, transformOrigin: "top left" }}
              >
                +
              </span>
              <CanvasCommentPopover
                flip={popoverFlips(pendingCommentPosition.x)}
                inverseScale={inverseScale}
                key={`${commentPopover.pendingPoint.frameId}:${commentPopover.pendingPoint.x}:${commentPopover.pendingPoint.y}`}
                mode="compose"
                onClose={commentPopover.onClose}
                onCreate={commentPopover.onCreate}
                point={commentPopover.pendingPoint}
                x={pendingCommentPosition.x}
                y={pendingCommentPosition.y}
              />
            </>
          ) : null}
          {commentPopover && openThreadPin && !commentPopover.pendingPoint ? (
            <CanvasCommentPopover
              canResolve={commentPopover.canResolve}
              canWrite={commentPopover.canWrite}
              flip={popoverFlips(openThreadPin.comment.x)}
              index={openThreadPin.index}
              inverseScale={inverseScale}
              key={openThreadPin.comment.id}
              mode="thread"
              onClose={commentPopover.onClose}
              onReply={commentPopover.onReply}
              onResolve={commentPopover.onResolve}
              replies={comments.filter((comment) => comment.parentCommentId === openThreadPin.comment.id)}
              root={comments.find((comment) => comment.id === openThreadPin.comment.id) ?? openThreadPin.comment}
              x={openThreadPin.comment.x}
              y={openThreadPin.comment.y}
            />
          ) : null}
        </div>
        <span aria-atomic="true" aria-live="polite" className="sr-only">{distanceAnnouncement}</span>
        {minimapVisible && fitted && frame.kind === "overview" && frame.exact && screens.length > 1 && screensRect ? (
          <CanvasMinimap
            area={screensRect}
            frameHeight={frame.sourceHeight}
            frameWidth={frame.sourceWidth}
            onCenter={centerOn}
            originX={frame.sourceX}
            originY={frame.sourceY}
            screens={screens}
            selectedFrameId={selectedFrameId}
            transform={transform}
            viewportHeight={viewportSize.height}
            viewportWidth={viewportSize.width}
          />
        ) : null}
      </div>
    </section>
  );
}

/**
 * A small overview of every screen with the visible area outlined. Click or drag in it to move the
 * view there; the zoom stays as it is. M hides it.
 */
function CanvasMinimap({
  area,
  screens,
  originX,
  originY,
  frameWidth,
  frameHeight,
  transform,
  viewportWidth,
  viewportHeight,
  selectedFrameId,
  onCenter,
}: {
  area: { x: number; y: number; width: number; height: number };
  screens: CanvasFrameOption[];
  originX: number;
  originY: number;
  frameWidth: number;
  frameHeight: number;
  transform: { scale: number; offsetX: number; offsetY: number };
  viewportWidth: number;
  viewportHeight: number;
  selectedFrameId: string | null;
  onCenter: (x: number, y: number) => void;
}) {
  const maxWidth = 176;
  const maxHeight = 112;
  // A margin around the screens so the view box can sit at their edges.
  const margin = Math.max(area.width, area.height) * 0.08;
  const box = { x: area.x - margin, y: area.y - margin, width: area.width + margin * 2, height: area.height + margin * 2 };
  const ratio = Math.min(maxWidth / box.width, maxHeight / box.height);
  const width = box.width * ratio;
  const height = box.height * ratio;
  // The part of the canvas on screen, in canvas pixels (the canvas is drawn centred on the viewport).
  const view = {
    x: (-transform.offsetX - viewportWidth / 2) / transform.scale + frameWidth / 2,
    y: (-transform.offsetY - viewportHeight / 2) / transform.scale + frameHeight / 2,
    width: viewportWidth / transform.scale,
    height: viewportHeight / transform.scale,
  };
  const draggingRef = useRef(false);

  function centerAt(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    onCenter(box.x + (event.clientX - rect.left) / ratio, box.y + (event.clientY - rect.top) / ratio);
  }

  return (
    <div
      aria-label="Minimap: click to move the view (M hides it)"
      className="absolute bottom-3 right-3 z-30 hidden cursor-pointer overflow-hidden rounded-[8px] border border-white/[0.08] bg-surface/90 shadow-[0_8px_24px_rgb(0_0_0/0.45)] backdrop-blur-md sm:block"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => {
        event.stopPropagation();
        draggingRef.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        centerAt(event);
      }}
      onPointerMove={(event) => {
        if (draggingRef.current) centerAt(event);
      }}
      onPointerUp={(event) => {
        draggingRef.current = false;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      role="img"
      style={{ width, height }}
      title="Minimap (M)"
    >
      {screens.map((screen) => (
        <span
          className={"absolute rounded-[1px] " + (screen.id === selectedFrameId ? "bg-[#e3a13a]/80" : "bg-white/25")}
          key={screen.id}
          style={{
            left: (screen.sourceX - originX - box.x) * ratio,
            top: (screen.sourceY - originY - box.y) * ratio,
            width: Math.max(1.5, screen.sourceWidth * ratio),
            height: Math.max(1.5, screen.sourceHeight * ratio),
          }}
        />
      ))}
      <span
        className="pointer-events-none absolute rounded-[2px] border border-white/80 bg-white/[0.06]"
        style={{
          left: (view.x - box.x) * ratio,
          top: (view.y - box.y) * ratio,
          width: view.width * ratio,
          height: view.height * ratio,
        }}
      />
    </div>
  );
}
