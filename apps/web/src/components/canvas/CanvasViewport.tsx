"use client";

import Image from "next/image";
import { RetryingCanvasImage } from "./RetryingImage";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import type { CanvasFrameChangeStatus, CanvasFrameOption, CanvasOverlayNode } from "./FrameNavigator";
import { glideMs, useCanvasViewport } from "./useCanvasViewport";
import { attachCanvasWheelZoom } from "./canvas-wheel-zoom";
import { getCanvasImageRenderPlan } from "./canvas-image-plan";
import { getVisibleCanvasOverlayNodes, regionContains, visibleCanvasRegion, type CanvasRegion } from "./visible-canvas-overlay-nodes";
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
import { marqueeRect, screensInMarquee, type MarqueeRect } from "./canvas-marquee";

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

type OverlayCullInputs = readonly unknown[];
type OverlayCull = { inputs: OverlayCullInputs; region: CanvasRegion; nodes: readonly CanvasOverlayNode[] };
const emptyOverlayNodes: readonly CanvasOverlayNode[] = [];
/** Extra room kept around the view for clickable layers, as a fraction of the viewport per side. */
const overlayMargin = 0.25;

/** True when both lists hold the same node objects in the same order (a new version brings new objects). */
function sameOverlayNodes<T>(a: readonly T[], b: readonly T[]) {
  return a.length === b.length && a.every((node, index) => node === b[index]);
}

/** A point in Figma page units: the space screens' sourceX / sourceY are in. */
export type CanvasPagePoint = { x: number; y: number };

/**
 * A tool that takes the pointer over from panning and selecting, such as drawing or the eyedropper.
 * Space-drag and two-finger gestures still pan and zoom.
 */
export type CanvasPointerTool = {
  cursor: string;
  onDown?: (point: CanvasPagePoint, event: PointerEvent<HTMLDivElement>) => void;
  /** Every move over the canvas, pressed or not. */
  onMove?: (point: CanvasPagePoint, event: PointerEvent<HTMLDivElement>) => void;
  onUp?: (point: CanvasPagePoint, event: PointerEvent<HTMLDivElement>) => void;
  onLeave?: () => void;
};

/** What a layer overlay needs to draw in page units at a constant on-screen size. */
export type CanvasLayerView = { inverseScale: number; originX: number; originY: number };

export type CanvasViewportControls = {
  /** The live zoom (null until the canvas has been fitted). A store rather than a number, so a zoom
   * gesture updates the readout without handing the page a new value, and re-rendering it, every frame. */
  scale: ZoomScaleSource;
  fitToFrame: () => void;
  zoomOut: () => void;
  zoomIn: () => void;
  /** Shows this area of the page (Figma page units) as large as it fits, gliding there (Follow). */
  showPageRect: (rect: CanvasPageRect) => void;
  /** The area of the page on screen now, in Figma page units. */
  getPageView: () => CanvasPageRect | null;
};

/** An area in Figma page units. */
export type CanvasPageRect = { x: number; y: number; width: number; height: number };

type CanvasViewportProps = {
  frame: CanvasFrameOption;
  overviewOrigin: { sourceX: number; sourceY: number };
  /** "select" draws a drag-to-select box over the screens instead of panning. */
  interactionMode: "view" | "inspect" | "select";
  screens: CanvasFrameOption[];
  /** Screens picked with the Select tool, outlined in blue. */
  selectedScreenIds?: ReadonlySet<string>;
  /** A finished drag-to-select box: the screens it touched, and whether Shift or ⌘ was held to add to the selection. */
  onMarqueeSelect?: (screenIds: string[], additive: boolean) => void;
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
  /** Comment threads the comment filter shows (by first comment id); null shows every pin. */
  visibleCommentIds?: ReadonlySet<string> | null;
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
  /** A second layer picked with Shift+click; distances to it stay drawn. */
  compareNodeId?: string | null;
  /** True while the details panel slides over the canvas's right side (tablets), so selections are kept clear of it. */
  detailsDrawerOpen?: boolean;
  onCompareNode?: (sourceNodeId: string) => void;
  /** Called when the person pans or zooms themselves (Follow stops then). */
  onUserMove?: () => void;
  /** Drawing, the eyedropper: gets the pointer instead of pan, select and click. */
  pointerTool?: CanvasPointerTool | null;
  /** Drawn on top of the screens, inside the zoomed layer (strokes, other people's cursors). */
  layerOverlay?: (view: CanvasLayerView) => ReactNode;
  /** Where the pointer is on the page, for live presence; null when it leaves the canvas. */
  onPointerPageMove?: (point: CanvasPagePoint | null) => void;
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
const compareGuideColor = "#3b93f5";
const pinnedGuideColor = "#d9468f";
/** Figma's selection blue, for the drag-to-select box and the screens it picks. */
const marqueeColor = "#0d99ff";

/** Gap lines with their pixel badges between two layers (Figma's red measurement lines). */
function DistanceGuides({ guides, color, inverseScale, frameWidth, frameHeight, outlineRects = [] }: {
  guides: ReturnType<typeof getElementDistanceGuides>;
  color: string;
  inverseScale: number;
  frameWidth: number;
  frameHeight: number;
  outlineRects?: ElementRect[];
}) {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute left-0 top-0 z-10 overflow-visible"
      height={frameHeight}
      viewBox={`0 0 ${frameWidth} ${frameHeight}`}
      width={frameWidth}
    >
      {outlineRects.map((rect, index) => (
        <rect fill="none" height={rect.height} key={"outline-" + index} stroke={color} strokeDasharray="4 3" strokeWidth={1} vectorEffect="non-scaling-stroke" width={rect.width} x={rect.x} y={rect.y} />
      ))}
      {guides.map((guide) => {
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
                stroke={color}
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
            <rect fill={color} height={badgeHeight} rx={2 * inverseScale} width={badgeWidth} x={badgeX} y={guide.labelY - badgeHeight / 2} />
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
  );
}

export function CanvasViewport({
  frame,
  overviewOrigin,
  interactionMode,
  screens,
  selectedScreenIds,
  onMarqueeSelect,
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
  visibleCommentIds = null,
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
  compareNodeId = null,
  detailsDrawerOpen = false,
  onCompareNode,
  pointerTool = null,
  layerOverlay,
  onPointerPageMove,
  onUserMove,
}: CanvasViewportProps) {
  const toolPointerRef = useRef<number | null>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; startX: number; startY: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  // Touch points on the canvas, for two-finger pinch and pan on phones and tablets.
  const touchesRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ distance: number; x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  // The Select tool's drag-to-select box, in the canvas layer's units.
  const marqueeRef = useRef<{ pointerId: number; startX: number; startY: number; start: { x: number; y: number }; moved: boolean; additive: boolean } | null>(null);
  const [marquee, setMarquee] = useState<{ rect: MarqueeRect; additive: boolean } | null>(null);
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
  const { containerRef, viewportSize, transform, interacting, gliding, showRect, getViewRect, fitted, fitToFrame, zoomToRect, centerOn, zoomBy, zoomAt, panBy } = useCanvasViewport(
    frame.sourceWidth,
    frame.sourceHeight,
    viewMemoryKey,
    screensRect,
    onUserMove,
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
    // Page units are the canvas layer's pixels plus the frame's page position.
    showPageRect: (rect) => showRect({ ...rect, x: rect.x - frame.sourceX, y: rect.y - frame.sourceY }),
    getPageView: () => {
      const view = getViewRect();
      return view ? { ...view, x: view.x + frame.sourceX, y: view.y + frame.sourceY } : null;
    },
  }), [fitToFrame, frame.sourceX, frame.sourceY, getViewRect, scaleSource, showRect, zoomBy]);
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
  // ⌥-click keeps a measurement between the selection and the clicked layer on the canvas until Esc.
  const [pinnedPairs, setPinnedPairs] = useState<Array<[string, string]>>([]);
  const zoomToNode = useCallback((nodeId: string) => {
    const node = overlayNodesRef.current.get(nodeId);
    const origin = frameOriginRef.current;
    const rect = node ? elementRectInFrame(node.bounds, { kind: origin.kind, sourceX: origin.x, sourceY: origin.y }) : null;
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    const pad = Math.max(160, Math.max(rect.width, rect.height) * 0.6);
    zoomToRect({ x: rect.x - pad, y: rect.y - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 });
  }, [zoomToRect]);
  // The details panel covers the right of the canvas on tablets and its lower part on phones, so
  // move a selection that is under it (or off-screen) into the part still showing.
  useEffect(() => {
    if (!detailsDrawerOpen || !selectedNodeId) return;
    const phone = viewportSize.width < 640;
    const node = overlayNodesRef.current.get(selectedNodeId);
    const origin = frameOriginRef.current;
    const rect = node ? elementRectInFrame(node.bounds, { kind: origin.kind, sourceX: origin.x, sourceY: origin.y }) : null;
    if (!rect) return;
    const visibleWidth = phone ? viewportSize.width : viewportSize.width - Math.min(400, window.innerWidth * 0.62);
    // The phone sheet is 58% of the canvas wrapper, which here is about the canvas's own height.
    const visibleHeight = phone ? viewportSize.height * 0.42 : viewportSize.height - 72;
    const screenX = (rect.x + rect.width / 2 - frame.sourceWidth / 2) * transform.scale + transform.offsetX + viewportSize.width / 2;
    const screenY = (rect.y + rect.height / 2 - frame.sourceHeight / 2) * transform.scale + transform.offsetY + viewportSize.height / 2;
    const dx = screenX < 24 || screenX > visibleWidth - 24 ? visibleWidth / 2 - screenX : 0;
    const dy = screenY < 24 || screenY > visibleHeight ? (phone ? visibleHeight / 2 : viewportSize.height / 2) - screenY : 0;
    if (dx || dy) panBy(dx, dy);
    // Only when the selection or the drawer changes, not on every pan or zoom.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailsDrawerOpen, selectedNodeId]);
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
      if (event.key === "Escape") setPinnedPairs([]);
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

  function pinchState() {
    const [a, b] = [...touchesRef.current.values()];
    return { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  /** Two fingers zoom around their midpoint and pan as they move, in every tool. */
  function trackTouch(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "touch") return false;
    touchesRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    // A fresh touch starts clean: a pinch that ended without a click mustn't swallow this tap.
    if (touchesRef.current.size === 1) suppressClickRef.current = false;
    if (touchesRef.current.size !== 2) return false;
    // A second finger turns a one-finger pan, box or pending tap into a pinch.
    dragRef.current = null;
    marqueeRef.current = null;
    setMarquee(null);
    setIsDragging(false);
    suppressClickRef.current = true;
    pinchRef.current = pinchState();
    for (const id of touchesRef.current.keys()) {
      try {
        event.currentTarget.setPointerCapture(id);
      } catch {
        // The pointer already ended.
      }
    }
    return true;
  }

  function releaseTouch(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "touch") return;
    touchesRef.current.delete(event.pointerId);
    if (touchesRef.current.size < 2 && pinchRef.current) {
      pinchRef.current = null;
      // The finger left on the glass shouldn't then select or place what it rests on.
      suppressClickRef.current = true;
    }
  }

  /** A point on the page, in the canvas layer's units (what screens are positioned in). */
  function clientToLocal(element: HTMLElement, clientX: number, clientY: number) {
    const rect = element.getBoundingClientRect();
    return {
      x: (clientX - rect.left - rect.width / 2 - transform.offsetX) / transform.scale + frame.sourceWidth / 2,
      y: (clientY - rect.top - rect.height / 2 - transform.offsetY) / transform.scale + frame.sourceHeight / 2,
    };
  }

  function pagePoint(element: HTMLElement, clientX: number, clientY: number): CanvasPagePoint {
    const local = clientToLocal(element, clientX, clientY);
    return { x: local.x + frame.sourceX, y: local.y + frame.sourceY };
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (trackTouch(event)) {
      toolPointerRef.current = null;
      return;
    }
    if (pointerTool && event.button === 0 && !spaceHeldRef.current && !(event.target as HTMLElement).closest("[data-comment-pin], [data-canvas-annotation], [data-canvas-chrome]")) {
      event.preventDefault();
      toolPointerRef.current = event.pointerId;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // The pointer already ended.
      }
      pointerTool.onDown?.(pagePoint(event.currentTarget, event.clientX, event.clientY), event);
      return;
    }
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
      // The Select tool draws a box over the screens instead of panning (Space or two fingers still pan).
      if (interactionMode === "select" && frame.kind === "overview") {
        marqueeRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          start: clientToLocal(event.currentTarget, event.clientX, event.clientY),
          moved: false,
          // Shift or ⌘ at the start of the drag (or while it ends) adds to the selection.
          additive: event.shiftKey || event.metaKey || event.ctrlKey,
        };
        return;
      }
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
    if (onPointerPageMove || pointerTool?.onMove) {
      const point = pagePoint(event.currentTarget, event.clientX, event.clientY);
      onPointerPageMove?.(point);
      if (pointerTool && (toolPointerRef.current === null || toolPointerRef.current === event.pointerId) && !(event.pointerType === "touch" && touchesRef.current.size > 1)) {
        pointerTool.onMove?.(point, event);
        if (toolPointerRef.current !== null) return;
      }
    }
    if (event.pointerType === "touch" && touchesRef.current.has(event.pointerId)) {
      touchesRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const previous = pinchRef.current;
      if (previous && touchesRef.current.size === 2) {
        const next = pinchState();
        panBy(next.x - previous.x, next.y - previous.y);
        zoomAt(next.distance / previous.distance, { x: next.x, y: next.y });
        pinchRef.current = next;
        return;
      }
    }
    const box = marqueeRef.current;
    if (box && box.pointerId === event.pointerId) {
      if (!box.moved && Math.hypot(event.clientX - box.startX, event.clientY - box.startY) < 4) return;
      if (!box.moved) {
        box.moved = true;
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // The pointer already ended.
        }
      }
      setMarquee({
        rect: marqueeRect(box.start, clientToLocal(event.currentTarget, event.clientX, event.clientY)),
        additive: box.additive || event.shiftKey || event.metaKey || event.ctrlKey,
      });
      return;
    }
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
    releaseTouch(event);
    if (toolPointerRef.current === event.pointerId) {
      toolPointerRef.current = null;
      suppressClickRef.current = true;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      pointerTool?.onUp?.(pagePoint(event.currentTarget, event.clientX, event.clientY), event);
      return;
    }
    const box = marqueeRef.current;
    if (box?.pointerId === event.pointerId) {
      marqueeRef.current = null;
      setMarquee(null);
      if (box.moved) {
        // The box replaces a click: what it touched becomes the selection.
        suppressClickRef.current = true;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        const rect = marqueeRect(box.start, clientToLocal(event.currentTarget, event.clientX, event.clientY));
        onMarqueeSelect?.(screensInMarquee(rect, screens, { x: frame.sourceX, y: frame.sourceY }), box.additive || event.shiftKey || event.metaKey || event.ctrlKey);
      }
      return;
    }
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
    releaseTouch(event);
    if (toolPointerRef.current === event.pointerId) {
      toolPointerRef.current = null;
      pointerTool?.onUp?.(pagePoint(event.currentTarget, event.clientX, event.clientY), event);
    }
    if (marqueeRef.current?.pointerId === event.pointerId) {
      marqueeRef.current = null;
      setMarquee(null);
    }
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
    if (pointerTool) return;
    const target = event.target as HTMLElement;
    if (target.closest("[data-comment-pin]")) return;
    if (target.closest("[data-canvas-annotation]")) return;
    const nodeButton = target.closest<HTMLElement>("[data-source-node-id]");
    if (nodeButton && !commentMode && !annotationMode) return;
    if (target.closest("button") && !nodeButton) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const localX = (event.clientX - rect.left - rect.width / 2 - transform.offsetX) / transform.scale + frame.sourceWidth / 2;
    const localY = (event.clientY - rect.top - rect.height / 2 - transform.offsetY) / transform.scale + frame.sourceHeight / 2;
    if (localX < 0 || localY < 0 || localX > frame.sourceWidth || localY > frame.sourceHeight) {
      if (interactionMode === "select" && !commentMode && !annotationMode) onMarqueeSelect?.([], event.shiftKey || event.metaKey || event.ctrlKey);
      return;
    }

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
    // With the Select tool, a click on empty canvas clears the selection (Shift keeps it).
    else if (!screen && interactionMode === "select") onMarqueeSelect?.([], event.shiftKey || event.metaKey || event.ctrlKey);
  }

  // Everything below that doesn't depend on the pan or zoom is memoised, so a gesture frame only
  // re-renders the moving layer's transform and the few overlays that follow the viewport.
  const marqueePreview = useMemo(
    () => marquee ? new Set(screensInMarquee(marquee.rect, screens, { x: frame.sourceX, y: frame.sourceY })) : null,
    [frame.sourceX, frame.sourceY, marquee, screens],
  );
  const commentPins = useMemo(
    () => layoutCommentPins(comments, screens, frame, showResolvedPins, overviewOrigin)
      .filter(({ comment }) => !visibleCommentIds || visibleCommentIds.has(comment.id) || comment.id === selectedCommentId),
    [comments, frame, overviewOrigin, screens, selectedCommentId, showResolvedPins, visibleCommentIds],
  );
  const annotationPins = useMemo(() => annotations.flatMap((annotation) => {
    const position = canvasAnchorToViewportPoint(annotation, frame, screens, overviewOrigin);
    if (!position) return [];
    return [{
      annotation,
      x: position.x,
      y: position.y,
    }];
  }), [annotations, frame, overviewOrigin, screens]);
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
  // Phones: the comment box docks along the bottom of the canvas instead of beside its pin.
  const sheetComments = viewportSize.width > 0 && viewportSize.width < 640;
  const pendingCommentKey = commentPopover?.pendingPoint
    ? `${commentPopover.pendingPoint.frameId}:${commentPopover.pendingPoint.x}:${commentPopover.pendingPoint.y}`
    : null;
  // The pin must stay visible above that sheet, so move it into the top part of the canvas.
  useEffect(() => {
    if (!sheetComments || !pendingCommentKey || !pendingCommentPosition) return;
    const screenX = (pendingCommentPosition.x - frame.sourceWidth / 2) * transform.scale + transform.offsetX + viewportSize.width / 2;
    const screenY = (pendingCommentPosition.y - frame.sourceHeight / 2) * transform.scale + transform.offsetY + viewportSize.height / 2;
    const fits = screenX >= 24 && screenX <= viewportSize.width - 48 && screenY >= 48 && screenY <= viewportSize.height * 0.4;
    if (!fits) panBy(viewportSize.width / 2 - screenX, viewportSize.height * 0.25 - screenY);
    // Only when a new pin is placed, not on every pan or zoom.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCommentKey]);
  const openThreadKey = openThreadPin ? openThreadPin.comment.id : null;
  const openThreadPoint = openThreadPin ? { x: openThreadPin.comment.x, y: openThreadPin.comment.y } : null;

  // When a thread opens off-screen (e.g. picked from the list), pan so its pin and popover fit.
  useEffect(() => {
    const point = openThreadPoint;
    if (!openThreadKey || !point || !viewportSize.width) return;
    const screenX = (point.x - frame.sourceWidth / 2) * transform.scale + transform.offsetX + viewportSize.width / 2;
    const screenY = (point.y - frame.sourceHeight / 2) * transform.scale + transform.offsetY + viewportSize.height / 2;
    const margin = 48;
    const fits = screenX >= margin && screenX <= viewportSize.width - margin && screenY >= margin && screenY <= (sheetComments ? viewportSize.height * 0.4 : viewportSize.height - 200);
    if (!fits) panBy((sheetComments ? 0.5 : 0.4) * viewportSize.width - screenX, (sheetComments ? 0.25 : 0.3) * viewportSize.height - screenY);
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
  // Clickable layers: those in a region a quarter-viewport larger than the view on each side. The
  // list is kept while the view stays inside that region and the inputs are unchanged, so a pan
  // doesn't re-scan every layer and rebuild the buttons each frame. Tiny layers become clickable at
  // the zoom a gesture settles on, like the borders and labels.
  const overlayActive = interactionMode === "inspect" || commentMode || annotationMode;
  const overlayOriginX = frame.kind === "overview" ? frame.sourceX : 0;
  const overlayOriginY = frame.kind === "overview" ? frame.sourceY : 0;
  const viewGeometry = {
    frameWidth: frame.sourceWidth,
    frameHeight: frame.sourceHeight,
    viewportWidth: viewportSize.width,
    viewportHeight: viewportSize.height,
    offsetX: transform.offsetX,
    offsetY: transform.offsetY,
    scale: transform.scale,
  };
  const [overlayCull, setOverlayCull] = useState<OverlayCull | null>(null);
  const overlayInputs: OverlayCullInputs = [overlayActive, overlayNodes, visualScale, selectedNodeId, highlightedNodeIds, overlayOriginX, overlayOriginY, frame.sourceWidth, frame.sourceHeight, viewportSize.width, viewportSize.height];
  const overlayCullFits = overlayCull !== null &&
    overlayCull.inputs.every((value, index) => value === overlayInputs[index]) &&
    (!overlayActive || regionContains(overlayCull.region, visibleCanvasRegion(viewGeometry)));
  let visibleOverlayNodes = overlayCull?.nodes ?? emptyOverlayNodes;
  if (!overlayCullFits) {
    const nodes = overlayActive
      ? getVisibleCanvasOverlayNodes({
          nodes: overlayNodes,
          ...viewGeometry,
          targetScale: visualScale,
          frameOriginX: overlayOriginX,
          frameOriginY: overlayOriginY,
          margin: overlayMargin,
          selectedNodeId,
          highlightedNodeIds,
        })
      : emptyOverlayNodes;
    const kept = overlayCull && sameOverlayNodes(overlayCull.nodes, nodes) ? overlayCull.nodes : nodes;
    visibleOverlayNodes = kept;
    setOverlayCull({ inputs: overlayInputs, region: visibleCanvasRegion({ ...viewGeometry, margin: overlayMargin }), nodes: kept });
  }
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
  const compareRect = compareNodeId && compareNodeId !== selectedNodeId ? elementRectInFrame(overlayNodesById.get(compareNodeId)?.bounds, frame) : null;
  const compareGuides = interactionMode === "inspect" && selectedRect && compareRect ? getElementDistanceGuides(selectedRect, compareRect) : [];
  const pinnedGuides = pinnedPairs.flatMap(([first, second], index) => {
    const a = elementRectInFrame(overlayNodesById.get(first)?.bounds, frame);
    const b = elementRectInFrame(overlayNodesById.get(second)?.bounds, frame);
    return a && b ? [{ key: `pin-${index}`, rects: [a, b], guides: getElementDistanceGuides(a, b) }] : [];
  });
  const distanceAnnouncement = distanceGuides
    .map((guide) => (guide.axis === "horizontal" ? "Horizontal" : "Vertical") + " gap " + formatPrecisePixelValue(guide.distance) + " pixels")
    .join(". ");

  const sectionsLayer = useMemo(() => (
    <>{
frame.kind === "overview" && frame.exact ? frame.sections?.map((section) => (
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
          )) : null
    }</>
  ), [frame.exact, frame.kind, frame.sections, inverseScale, visualScale]);

  const baseImageLayer = useMemo(() => (
    <>{
imageRenderPlan.showBaseImage ? (
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
          ) : null
    }</>
  ), [frame.fileName, frame.imageSrc, frame.keepRects, frame.maskRects, frame.name, frame.pixelHeight, frame.pixelWidth, frame.sourceHeight, frame.sourceWidth, imageRenderPlan.showBaseImage]);

  const screenFramesLayer = useMemo(() => (
    <>{
frame.kind === "overview" && frame.exact ? stableInViewScreens.map((screen) => {
            const status = frameStatuses[screen.id];
            // While a box is being dragged, show what letting go would select.
            const boxed = marqueePreview?.has(screen.id) ?? false;
            const multiSelected = boxed || (selectedScreenIds?.has(screen.id) && (!marquee || marquee.additive));
            const label = changesVisible ? statusLabel(status) : null;
            const selected = screen.id === selectedFrameId;
            const showLabel = shouldShowCanvasFrameLabel(visualScale, selected, screens.length);
              const isNew = label === "New";
              const statusBorderColor = label === "Changed" ? "#e3a13a" : isNew ? "#55c987" : null;
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
                  border: statusBorderColor ? (selected ? 3 : 1.5) * inverseScale + "px solid " + statusBorderColor : undefined,
                  outline: multiSelected ? 2 * inverseScale + "px solid " + marqueeColor : undefined,
                }}
                data-multi-selected={multiSelected ? "" : undefined}
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
          }) : null
    }</>
  ), [canCompare, changesVisible, frame.exact, frame.kind, frame.sourceX, frame.sourceY, frameStatuses, inverseScale, marquee, marqueePreview, onCompareScreen, onSelectFrame, pickedFrameIds, screens.length, selectedFrameId, selectedScreenIds, stableInViewScreens, visualScale]);

  const changedRectsLayer = useMemo(() => (
    <>{
changedRects.map(({ nodeId, rect }) => (
            <span
              aria-hidden="true"
              className="canvas-changed-outline pointer-events-none absolute"
              key={"changed:" + nodeId}
              style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height, borderWidth: 1.5 * inverseScale, borderRadius: 2 * inverseScale }}
            />
          ))
    }</>
  ), [changedRects, inverseScale]);

  const annotationPinsLayer = useMemo(() => (
    <>{
annotationPins.map(({ annotation, x, y }) => (
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
          ))
    }</>
  ), [annotationPins, inverseScale, onSelectAnnotation, selectedAnnotationId]);

  const commentPinsLayer = useMemo(() => (
    <>{
commentPins.map(({ comment, index }) => (
            <span data-comment-pin key={comment.id}>
              <CommentPin
                comment={comment}
                index={index}
                inverseScale={inverseScale}
                selected={comment.id === selectedCommentId}
                onSelect={onSelectComment}
              />
            </span>
          ))
    }</>
  ), [commentPins, inverseScale, onSelectComment, selectedCommentId]);

  const overlayButtonsLayer = useMemo(() => (
    <>{
visibleOverlayNodes.map((node) => {
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
                  if (commentMode || annotationMode) return;
                  if (event.altKey && selectedNodeId && selectedNodeId !== node.sourceNodeId) {
                    // Keep this measurement on the canvas.
                    const pair: [string, string] = [selectedNodeId, node.sourceNodeId];
                    setPinnedPairs((current) => current.some(([a, b]) => (a === pair[0] && b === pair[1]) || (a === pair[1] && b === pair[0])) ? current : [...current, pair]);
                    return;
                  }
                  if (event.shiftKey && onCompareNode) {
                    onCompareNode(node.sourceNodeId);
                    return;
                  }
                  onSelectNode(node.sourceNodeId);
                }}
                onDoubleClick={(event) => {
                  if (commentMode || annotationMode || event.altKey || event.shiftKey) return;
                  zoomToNode(node.sourceNodeId);
                }}
                onMouseEnter={() => { if (interactionMode === "inspect") setHoveredNode({ nodeId: node.sourceNodeId, frameId: frame.id }); }}
                onMouseLeave={() => { if (interactionMode === "inspect") setHoveredNode(null); }}
                style={{ left: x, top: y, width, height }}
                type="button"
              />
            );
          })
    }</>
  ), [annotationMode, commentMode, frame.id, frame.kind, frame.sourceX, frame.sourceY, highlightedNodeIdSet, interactionMode, onCompareNode, onSelectNode, outlinesVisible, selectedNodeId, visibleOverlayNodes, zoomToNode]);
  const layerOverlayContent = useMemo(
    () => layerOverlay?.({ inverseScale, originX: frame.sourceX, originY: frame.sourceY }),
    [frame.sourceX, frame.sourceY, inverseScale, layerOverlay],
  );
  const composePopover = commentPopover?.pendingPoint && pendingCommentPosition ? (
    <CanvasCommentPopover
      flip={popoverFlips(pendingCommentPosition.x)}
      inverseScale={inverseScale}
      key={pendingCommentKey}
      mode="compose"
      onClose={commentPopover.onClose}
      onCreate={commentPopover.onCreate}
      point={commentPopover.pendingPoint}
      sheet={sheetComments}
      x={pendingCommentPosition.x}
      y={pendingCommentPosition.y}
    />
  ) : null;
  const threadPopover = commentPopover && openThreadPin && !commentPopover.pendingPoint ? (
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
      sheet={sheetComments}
      x={openThreadPin.comment.x}
      y={openThreadPin.comment.y}
    />
  ) : null;

  return (
    <section aria-label="Design canvas" className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface">
      <div
        aria-describedby="canvas-keyboard-help"
        aria-label={interactionMode === "inspect"
          ? "Inspect mode. Select a highlighted element to inspect it, scroll or drag to pan, and pinch or use Ctrl or Command + scroll to zoom."
          : interactionMode === "select"
          ? "Select mode. Drag a box over screens to select them, Shift-drag to add more, scroll or hold Space and drag to pan."
          : "View mode. Scroll or drag to pan, and pinch or use Ctrl or Command + scroll to zoom. Switch to Inspect to select design elements."}
        className={"review-dot-grid @container group relative grid min-h-0 min-w-0 flex-1 touch-none select-none place-items-center overflow-hidden outline-none focus-visible:outline-none " +(isDragging ? "cursor-grabbing" : spaceHeld ? "cursor-grab" : commentMode || annotationMode || marquee ? "cursor-crosshair" : interactionMode === "select" ? "cursor-default" : "cursor-grab")}
        data-canvas-viewport=""
        data-space-pan={spaceHeld ? "" : undefined}
        data-comment-cursor={commentMode && !spaceHeld && !isDragging ? "" : undefined}
        onClick={handleCanvasClick}
        // Panning starts only after 4px of movement; until then Windows browsers would start their own
        // drag of the screens (as a selection or image) and cancel the pointer, so the canvas never panned.
        onDragStart={(event) => {
          if (!(event.target instanceof HTMLElement && event.target.closest("input, textarea, [contenteditable='true']"))) event.preventDefault();
        }}
        onPointerCancel={handlePointerCancel}
        onMouseDown={(event) => {
          if (event.shiftKey) event.preventDefault();
        }}
        onPointerDown={handlePointerDown}
        onPointerLeave={(event) => {
          if (toolPointerRef.current === event.pointerId) return;
          onPointerPageMove?.(null);
          pointerTool?.onLeave?.();
        }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onKeyDown={handleCanvasKeyDown}
        ref={containerRef}
        style={pointerTool && !spaceHeld && !isDragging ? { cursor: pointerTool.cursor } : undefined}
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
            willChange: interacting || gliding ? "transform" : undefined,
            transition: gliding ? `transform ${glideMs}ms cubic-bezier(0.22, 1, 0.36, 1)` : undefined,
          }}
        >
          {sectionsLayer}

          {baseImageLayer}

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

          {screenFramesLayer}

          {marquee ? (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute z-30"
              data-canvas-marquee=""
              style={{
                left: marquee.rect.x,
                top: marquee.rect.y,
                width: marquee.rect.width,
                height: marquee.rect.height,
                border: inverseScale + "px solid " + marqueeColor,
                backgroundColor: "rgb(13 153 255 / 0.12)",
              }}
            />
          ) : null}

          {changedRectsLayer}

          {overlayButtonsLayer}

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

          {compareRect ? (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute border-[#5aa9ff] bg-[#5aa9ff]/15"
              style={{ left: compareRect.x, top: compareRect.y, width: compareRect.width, height: compareRect.height, borderWidth: 2 * inverseScale, borderStyle: "dashed", borderRadius: 2 * inverseScale }}
            />
          ) : null}
          {pinnedGuides.map((pin) => (
            <DistanceGuides color={pinnedGuideColor} frameHeight={frame.sourceHeight} frameWidth={frame.sourceWidth} guides={pin.guides} inverseScale={inverseScale} key={pin.key} outlineRects={pin.rects} />
          ))}
          {compareGuides.length ? <DistanceGuides color={compareGuideColor} frameHeight={frame.sourceHeight} frameWidth={frame.sourceWidth} guides={compareGuides} inverseScale={inverseScale} /> : null}
          {distanceGuides.length ? <DistanceGuides color={measurementGuideColor} frameHeight={frame.sourceHeight} frameWidth={frame.sourceWidth} guides={distanceGuides} inverseScale={inverseScale} /> : null}
          {pinnedPairs.length ? (
            <span className="sr-only" role="status">{pinnedPairs.length} pinned {pinnedPairs.length === 1 ? "measurement" : "measurements"}. Press Escape to clear.</span>
          ) : null}

          {annotationPinsLayer}

          {commentPinsLayer}

          {commentPopover && pendingCommentPosition && commentPopover.pendingPoint ? (
            <>
              <span
                aria-hidden="true"
                className="comment-pin comment-pin-pending pointer-events-none absolute z-30 grid size-7 place-items-center text-[15px] font-semibold"
                style={{ left: pendingCommentPosition.x, top: pendingCommentPosition.y - 28, transform: `scale(${inverseScale})`, transformOrigin: "bottom left" }}
              >
                +
              </span>
              {sheetComments ? null : composePopover}
            </>
          ) : null}
          {sheetComments ? null : threadPopover}
          {layerOverlayContent}
        </div>
        {sheetComments ? composePopover ?? threadPopover : null}
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
  // The screens don't move while the view does, so only the view box re-renders as you pan.
  const screenRects = useMemo(() => screens.map((screen) => (
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
      ))
  , [box.x, box.y, originX, originY, ratio, screens, selectedFrameId]);
  const draggingRef = useRef(false);

  function centerAt(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    onCenter(box.x + (event.clientX - rect.left) / ratio, box.y + (event.clientY - rect.top) / ratio);
  }

  return (
    <div
      aria-label="Minimap: click to move the view (M hides it)"
      className="absolute bottom-3 right-3 z-30 hidden cursor-pointer overflow-hidden rounded-[8px] border border-white/[0.08] bg-surface/90 shadow-[0_8px_24px_rgb(0_0_0/0.45)] backdrop-blur-md @min-[560px]:block @max-[960px]:bottom-[64px]"
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
      {screenRects}
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
