"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type { SnapshotNode } from "@asbir/snapshot-contract";
import { CommentThread, type PendingCommentPoint } from "../comments/CommentThread";
import type { HandoffComment } from "../comments/CommentPin";
import { CanvasToolbar } from "./CanvasToolbar";
import { CanvasViewport, type CanvasViewportControls } from "./CanvasViewport";
import { InstallAppButton } from "@/src/components/shell/InstallAppButton";
import { AgentHandoffPanel } from "./AgentHandoffPanel";
import { ElementInspector } from "./ElementInspector";
import { LocalPreviewPanel } from "./LocalPreviewPanel";
import { CanvasAnnotationsPanel, type CanvasAnnotationRecord } from "./CanvasAnnotationsPanel";
import { McpConnectionPanel } from "./McpConnectionPanel";
import { hasVisibleLayoutGrids } from "./LayoutGridOverlay";
import { formatComparisonChangeCount } from "./compare-presentation";
import { formatCapturedAt } from "./captured-at";
import { filterChangedFrames } from "./changed-frame-filter";
import { overviewCanvasFrameId } from "./canvas-anchor";
import {
  FrameNavigator,
  type CanvasFrameChangeStatus,
  type CanvasFrameOption,
  type FrameComparisonSummary,
} from "./FrameNavigator";
import type { VersionOption } from "./VersionCompare";

export type ReviewMetadata = {
  projectName: string;
  projectHref: string;
  handoffName: string;
  versionLabel: string;
  selectedVersionId: string;
  versionHrefPrefix: string;
  versions: VersionOption[];
  capturedAt: string;
  source: string;
  captureScope: string | null;
  sourceRevisionId: string | null;
  releaseNote: string | null;
  visualOnly: boolean;
  reviewHref: string | null;
  latestPublishedEndpoint: string | null;
  publishedVersionId: string | null;
  versionIsPublished: boolean;
  contentHash: string;
  canManageIntegrations: boolean;
  canAnnotate: boolean;
  canUseLocalPreview: boolean;
};

export type ReviewDockPanels = Partial<Record<"version" | "qa" | "changelog", ReactNode>>;

type HandoffCanvasProps = {
  frames: CanvasFrameOption[];
  commentsEndpoint: string;
  workspaceId: string;
  projectId: string;
  handoffId: string;
  frameStatuses: Record<string, CanvasFrameChangeStatus>;
  comparisonSummary: FrameComparisonSummary | null;
  canCompare: boolean;
  onCompareScreen: (frameId: string) => void;
  onOpenComparison: (frameId?: string) => void;
  comparisonOpen: boolean;
  metadata: ReviewMetadata;
  dockPanels: ReviewDockPanels;
};

type CommentPayload = { comments: HandoffComment[] };
type AnnotationPayload = { annotations: CanvasAnnotationRecord[] };
type SearchCategory = "All" | "Text" | "Colours" | "Elements";
type SearchResult = {
  frame: CanvasFrameOption;
  node: SnapshotNode;
  category: Exclude<SearchCategory, "All">;
  detail: string;
};

function summaryText(summary: FrameComparisonSummary | null) {
  if (!summary) return "";
  const parts = [];
  if (summary.changed) parts.push(summary.changed + " changed");
  if (summary.added) parts.push(summary.added + " new");
  if (summary.removed) parts.push(summary.removed + " removed");
  if (summary.onlyInAfterCapture) parts.push(summary.onlyInAfterCapture + " screen" + (summary.onlyInAfterCapture === 1 ? "" : "s") + " with no match in the earlier capture");
  if (summary.onlyInBeforeCapture) parts.push(summary.onlyInBeforeCapture + " screen" + (summary.onlyInBeforeCapture === 1 ? "" : "s") + " with no match in this capture");
  if (summary.changeCount) parts.push(formatComparisonChangeCount(summary.changeCount, summary.visualChangeCount));
  return (parts.join(", ") || "No changes") + " since " + summary.earlierVersionLabel;
}

function subscribeToLocationHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  window.addEventListener("handofflocationchange", onChange);
  return () => {
    window.removeEventListener("hashchange", onChange);
    window.removeEventListener("handofflocationchange", onChange);
  };
}

function getLocationHash() {
  return window.location.hash;
}

function getServerLocationHash() {
  return "";
}

const MOBILE_PANEL_FOCUSABLE_SELECTOR = "a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex='-1'])";

function getFocusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(MOBILE_PANEL_FOCUSABLE_SELECTOR))
    .filter((element) => element.getClientRects().length > 0 && !element.closest("[hidden], [aria-hidden='true']"));
}

export function HandoffCanvas({
  frames,
  commentsEndpoint,
  workspaceId,
  projectId,
  handoffId,
  frameStatuses,
  comparisonSummary,
  canCompare,
  onCompareScreen,
  onOpenComparison,
  comparisonOpen,
  metadata,
  dockPanels,
}: HandoffCanvasProps) {
  const overviewFrame = frames.find((frame) => frame.kind === "overview") ?? frames[0];
  const screens = useMemo(() => frames.filter((frame) => frame.kind === "frame"), [frames]);
  const exportTargets = useMemo(() => frames.map((frame) => ({
    id: frame.id,
    name: frame.name,
    kind: frame.kind,
    imageUrl: frame.imageSrc,
    fileName: frame.fileName,
    pixelWidth: frame.pixelWidth,
    pixelHeight: frame.pixelHeight,
  })), [frames]);
  const locationHash = useSyncExternalStore(subscribeToLocationHash, getLocationHash, getServerLocationHash);
  const linkValues = useMemo(() => new URLSearchParams(locationHash.slice(1)), [locationHash]);
  const linkedFrameId = linkValues.get("screen");
  const linkedNodeId = linkValues.get("element");
  const linkedCommentId = linkValues.get("comment");
  const linkedNode = useMemo(
    () => linkedNodeId ? screens.flatMap((frame) => frame.nodes).find((node) => node.sourceNodeId === linkedNodeId) ?? null : null,
    [linkedNodeId, screens],
  );
  const [localSelectedFrameId, setSelectedFrameId] = useState<string | null>(null);
  const [localSelectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [changedOnly, setChangedOnly] = useState(false);
  const [comments, setComments] = useState<HandoffComment[]>([]);
  const [annotations, setAnnotations] = useState<CanvasAnnotationRecord[]>([]);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [localSelectedCommentId, setSelectedCommentId] = useState<string | null>(null);
  const [showResolvedPins, setShowResolvedPins] = useState(false);
  const [panelMode, setPanelMode] = useState<"inspect" | "comments" | "annotations" | "version" | "qa" | "changelog" | "agent" | "local" | "mcp">("inspect");
  const [canvasModeOverride, setCanvasModeOverride] = useState<"view" | "inspect" | null>(null);
  const [statesOpen, setStatesOpen] = useState(false);
  const [mobilePanelOpenOverride, setMobilePanelOpenOverride] = useState<boolean | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const canvasMode = canvasModeOverride ?? (linkedNode ? "inspect" : "view");
  const mobilePanelOpen = mobilePanelOpenOverride ?? (isMobile && Boolean(linkedNode));
  const [commentMode, setCommentMode] = useState(false);
  const [annotationMode, setAnnotationMode] = useState(false);
  const [pendingPoint, setPendingPoint] = useState<PendingCommentPoint | null>(null);
  const [pendingAnnotationPoint, setPendingAnnotationPoint] = useState<PendingCommentPoint | null>(null);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [annotationError, setAnnotationError] = useState<string | null>(null);
  const [outlinesVisible, setOutlinesVisible] = useState(false);
  const [layoutGridsVisible, setLayoutGridsVisible] = useState(false);
  const [viewportControls, setViewportControls] = useState<CanvasViewportControls | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchCategory, setSearchCategory] = useState<SearchCategory>("All");
  const [activeSearchIndex, setActiveSearchIndex] = useState(-1);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const screenPanelRef = useRef<HTMLDivElement | null>(null);
  const detailsPanelRef = useRef<HTMLElement | null>(null);
  const mobilePanelOpenerRef = useRef<HTMLElement | null>(null);
  const activeMobilePanelRef = useRef<HTMLElement | null>(null);
  const mobilePanelWasOpenRef = useRef(false);
  const [highlightedNodeIds, setHighlightedNodeIds] = useState<string[]>([]);
  const [latestPublished, setLatestPublished] = useState<{ versionId: string; versionLabel: string } | null>(null);

  const closeSearchPanel = useCallback(() => {
    setSearchOpen(false);
    window.requestAnimationFrame(() => document.getElementById("canvas-search-screens-trigger")?.focus());
  }, []);

  useEffect(() => {
    if (!metadata.latestPublishedEndpoint) return;
    let active = true;
    const refresh = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const response = await fetch(metadata.latestPublishedEndpoint!, { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json() as { versionId?: string; versionLabel?: string };
        if (active && payload.versionId && payload.versionLabel) {
          setLatestPublished({ versionId: payload.versionId, versionLabel: payload.versionLabel });
        }
      } catch {
        // Keep the last successful published-version status when the network is unavailable.
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 20_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [metadata.latestPublishedEndpoint]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)");
    const updateLayout = () => {
      setIsMobile(media.matches);
      setStatesOpen(!media.matches);
      setMobilePanelOpenOverride(null);
    };
    updateLayout();
    media.addEventListener("change", updateLayout);
    return () => media.removeEventListener("change", updateLayout);
  }, []);

  useEffect(() => {
    if (!isMobile) return;
    const panel = statesOpen ? screenPanelRef.current : mobilePanelOpen ? detailsPanelRef.current : null;
    if (!panel) {
      if (mobilePanelWasOpenRef.current) {
        const opener = mobilePanelOpenerRef.current;
        window.requestAnimationFrame(() => {
          if (opener?.isConnected) opener.focus();
          else document.getElementById("canvas-mobile-screens-toggle")?.focus();
        });
      }
      mobilePanelWasOpenRef.current = false;
      activeMobilePanelRef.current = null;
      mobilePanelOpenerRef.current = null;
      return;
    }
    const activePanel = panel;

    if (!mobilePanelWasOpenRef.current) {
      const activeElement = document.activeElement;
      mobilePanelOpenerRef.current = activeElement instanceof HTMLElement && activeElement !== document.body ? activeElement : null;
      mobilePanelWasOpenRef.current = true;
    }
    if (activeMobilePanelRef.current !== activePanel) {
      activeMobilePanelRef.current = activePanel;
      window.requestAnimationFrame(() => {
        const initialTarget = searchOpen
          ? activePanel.querySelector<HTMLElement>("#handoff-search-input")
          : getFocusableElements(activePanel)[0];
        (initialTarget ?? activePanel).focus();
      });
    }

    function containMobilePanelFocus(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (searchOpen) {
          closeSearchPanel();
          return;
        }
        if (commentMode || annotationMode) {
          setCommentMode(false);
          setAnnotationMode(false);
          setPendingPoint(null);
          setPendingAnnotationPoint(null);
          return;
        }
        setStatesOpen(false);
        setSearchOpen(false);
        setMobilePanelOpenOverride(false);
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = getFocusableElements(activePanel);
      if (!focusable.length) {
        event.preventDefault();
        activePanel.focus();
        return;
      }
      const activeIndex = focusable.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey && (activeIndex <= 0 || !activePanel.contains(document.activeElement))) {
        event.preventDefault();
        focusable[focusable.length - 1].focus();
      } else if (!event.shiftKey && (activeIndex < 0 || activeIndex === focusable.length - 1 || !activePanel.contains(document.activeElement))) {
        event.preventDefault();
        focusable[0].focus();
      }
    }

    document.addEventListener("keydown", containMobilePanelFocus);
    return () => document.removeEventListener("keydown", containMobilePanelFocus);
  }, [annotationMode, closeSearchPanel, commentMode, isMobile, mobilePanelOpen, searchOpen, statesOpen]);

  const requestedSelectedFrameId = localSelectedFrameId ??
    (linkedFrameId === overviewCanvasFrameId || screens.some((frame) => frame.id === linkedFrameId)
      ? linkedFrameId
      : linkedNode?.sourceFrameId ?? null);
  const overviewSelected = requestedSelectedFrameId === overviewCanvasFrameId;
  const changedOnlyActive = changedOnly && Boolean(comparisonSummary);
  const canvasScreens = useMemo(
    () => filterChangedFrames(screens, changedOnlyActive, frameStatuses, Boolean(comparisonSummary)),
    [screens, changedOnlyActive, frameStatuses, comparisonSummary],
  );
  const selectedFrameId = overviewSelected
    ? overviewCanvasFrameId
    : changedOnlyActive && !canvasScreens.some((frame) => frame.id === requestedSelectedFrameId)
    ? canvasScreens[0]?.id ?? null
    : requestedSelectedFrameId;
  const requestedSelectedNodeId = localSelectedNodeId ?? linkedNode?.sourceNodeId ?? null;
  const selectedCommentId = localSelectedCommentId ?? linkedCommentId;
  const annotationsEndpoint = commentsEndpoint.replace(/\/comments$/, "/annotations");
  const selectedFrame = screens.find((frame) => frame.id === selectedFrameId) ?? null;
  const visualFrame = overviewFrame?.exact || overviewSelected
    ? overviewFrame
    : changedOnlyActive
      ? canvasScreens.find((frame) => frame.id === selectedFrameId) ?? canvasScreens[0] ?? overviewFrame
      : selectedFrame ?? overviewFrame;
  const hasLayoutGrids = useMemo(() => hasVisibleLayoutGrids(
    visualFrame?.kind === "overview" && visualFrame.exact ? canvasScreens : visualFrame ? [visualFrame] : [],
  ), [canvasScreens, visualFrame]);
  const requestedSelectedNode = useMemo<SnapshotNode | null>(() => {
    if (!requestedSelectedNodeId) return null;
    return screens.flatMap((frame) => frame.nodes).find((node) => node.sourceNodeId === requestedSelectedNodeId) ?? null;
  }, [screens, requestedSelectedNodeId]);
  const selectedNode = changedOnlyActive && requestedSelectedNode &&
    !canvasScreens.some((frame) => frame.id === requestedSelectedNode.sourceFrameId)
    ? null
    : requestedSelectedNode;
  const selectedNodeId = selectedNode?.sourceNodeId ?? (changedOnlyActive ? null : requestedSelectedNodeId);

  const commentCount = comments.filter((comment) => comment.parentCommentId === null).length;
  const openCommentCount = comments.filter((comment) => comment.parentCommentId === null && !comment.resolvedAt).length;

  const searchResults = useMemo<SearchResult[]>(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return [];
    const results: SearchResult[] = [];
    for (const frame of screens) {
      for (const node of frame.nodes) {
        const textValue = [node.name, node.typography?.content ?? ""].join(" ");
        const colorValue = [...node.fills, ...node.strokes].map((paint) => paint.color ?? "").concat(node.tokens.map((token) => token.name + " " + JSON.stringify(token.value))).join(" ");
        const elementValue = [node.name, node.type, node.sourceNodeId].join(" ");
        const candidates: Array<{ category: Exclude<SearchCategory, "All">; value: string; detail: string }> = [
          { category: "Text", value: textValue, detail: node.typography?.content || node.name },
          { category: "Colours", value: colorValue, detail: colorValue || "No captured colour" },
          { category: "Elements", value: elementValue, detail: node.name + " · " + node.type },
        ];
        const match = candidates.find((candidate) =>
          (searchCategory === "All" || searchCategory === candidate.category) && candidate.value.toLowerCase().includes(query),
        );
        if (match) results.push({ frame, node, category: match.category, detail: match.detail });
      }
    }
    return results.slice(0, 80);
  }, [screens, searchCategory, searchQuery]);

  const refreshComments = useCallback(async () => {
    const response = await fetch(commentsEndpoint, { cache: "no-store" });
    const payload = await response.json() as CommentPayload | { error?: string };
    if (!response.ok || !("comments" in payload)) {
      throw new Error("error" in payload ? payload.error ?? "Could not load comments." : "Could not load comments.");
    }
    setComments(payload.comments);
  }, [commentsEndpoint]);

  const refreshAnnotations = useCallback(async () => {
    const response = await fetch(annotationsEndpoint, { cache: "no-store" });
    const payload = await response.json() as AnnotationPayload | { error?: string };
    if (!response.ok || !("annotations" in payload)) {
      throw new Error("error" in payload ? payload.error ?? "Could not load canvas notes." : "Could not load canvas notes.");
    }
    setAnnotations(payload.annotations);
  }, [annotationsEndpoint]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(commentsEndpoint, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as CommentPayload | { error?: string };
        if (!response.ok || !("comments" in payload)) {
          throw new Error("error" in payload ? payload.error ?? "Could not load comments." : "Could not load comments.");
        }
        setComments(payload.comments);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setCommentError(cause instanceof Error ? cause.message : "Could not load comments.");
      });
    return () => controller.abort();
  }, [commentsEndpoint]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(annotationsEndpoint, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as AnnotationPayload | { error?: string };
        if (!response.ok || !("annotations" in payload)) {
          throw new Error("error" in payload ? payload.error ?? "Could not load canvas notes." : "Could not load canvas notes.");
        }
        setAnnotations(payload.annotations);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setAnnotationError(cause instanceof Error ? cause.message : "Could not load canvas notes.");
      });
    return () => controller.abort();
  }, [annotationsEndpoint]);

  const updateLinkState = useCallback((frameId: string | null, nodeId: string | null, commentId?: string | null) => {
    const url = new URL(window.location.href);
    const hash = new URLSearchParams();
    if (frameId) hash.set("screen", frameId);
    if (nodeId) hash.set("element", nodeId);
    if (commentId) hash.set("comment", commentId);
    url.hash = hash.toString();
    window.history.replaceState(null, "", url.toString());
    window.dispatchEvent(new Event("handofflocationchange"));
  }, []);

  const previewSearchResult = useCallback((result: SearchResult) => {
    setSelectedFrameId(result.frame.id);
    setSelectedNodeId(result.node.sourceNodeId);
    setSelectedCommentId(null);
    setPanelMode("inspect");
    setCanvasModeOverride("inspect");
    setHighlightedNodeIds([]);
    updateLinkState(result.frame.id, result.node.sourceNodeId);
  }, [updateLinkState]);

  const selectSearchResult = useCallback((result: SearchResult) => {
    previewSearchResult(result);
    setSearchOpen(false);
    if (isMobile) {
      setStatesOpen(false);
      setMobilePanelOpenOverride(true);
    }
  }, [isMobile, previewSearchResult]);

  const copySearchHighlights = useCallback(() => {
    setHighlightedNodeIds(searchResults.map((result) => result.node.sourceNodeId));
    if (searchResults[0]) {
      setActiveSearchIndex(0);
      previewSearchResult(searchResults[0]);
    }
  }, [previewSearchResult, searchResults]);

  useEffect(() => {
    if (!searchOpen || activeSearchIndex < 0) return;
    document.getElementById(`handoff-search-result-${activeSearchIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [activeSearchIndex, searchOpen]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const editing = target?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "");
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setSearchOpen(true);
        setStatesOpen(true);
        setMobilePanelOpenOverride(false);
        searchInputRef.current?.focus();
        return;
      }
      if (searchOpen) {
        if (event.key === "Escape") {
          event.preventDefault();
          closeSearchPanel();
          return;
        }
        if (target?.id === "handoff-search-input" && event.key === "ArrowDown" && searchResults.length) {
          event.preventDefault();
          const nextIndex = activeSearchIndex < 0 ? 0 : Math.min(activeSearchIndex + 1, searchResults.length - 1);
          setActiveSearchIndex(nextIndex);
          previewSearchResult(searchResults[nextIndex]);
          return;
        }
        if (target?.id === "handoff-search-input" && event.key === "ArrowUp" && searchResults.length) {
          event.preventDefault();
          const nextIndex = activeSearchIndex < 0 ? searchResults.length - 1 : Math.max(activeSearchIndex - 1, 0);
          setActiveSearchIndex(nextIndex);
          previewSearchResult(searchResults[nextIndex]);
          return;
        }
        if (target?.id === "handoff-search-input" && event.key === "Enter" && searchResults.length) {
          event.preventDefault();
          if (event.shiftKey) copySearchHighlights();
          else selectSearchResult(searchResults[activeSearchIndex] ?? searchResults[0]);
          return;
        }
      }
      if (editing) return;
      if (event.key.toLowerCase() === "o") {
        setCanvasModeOverride("inspect");
        setPanelMode("inspect");
        setOutlinesVisible((current) => !current);
      }
      if (event.shiftKey && event.key === "1") viewportControls?.fitToFrame();
      if (event.key === "Escape") {
        setSearchOpen(false);
        setCommentMode(false);
        setAnnotationMode(false);
        setPendingAnnotationPoint(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeSearchIndex, closeSearchPanel, copySearchHighlights, previewSearchResult, searchOpen, searchResults, selectSearchResult, viewportControls]);

  if (!overviewFrame || !visualFrame) {
    return <p className="p-6 text-sm text-[#aaa]">This snapshot has no frames to display.</p>;
  }

  function selectFrame(frameId: string) {
    setSelectedFrameId(frameId);
    setSelectedNodeId(null);
    setCanvasModeOverride(canvasMode);
    setSelectedCommentId(null);
    setPendingPoint(null);
    setCommentMode(false);
    setAnnotationMode(false);
    setPendingAnnotationPoint(null);
    setSelectedAnnotationId(null);
    setPanelMode("inspect");
    if (isMobile) {
      setStatesOpen(false);
      setMobilePanelOpenOverride(true);
    }
    updateLinkState(frameId, null);
  }

  function selectNode(sourceNodeId: string) {
    const node = screens.flatMap((frame) => frame.nodes).find((entry) => entry.sourceNodeId === sourceNodeId);
    if (node) setSelectedFrameId(node.sourceFrameId);
    setSelectedNodeId(sourceNodeId);
    setSelectedCommentId(null);
    setPanelMode("inspect");
    setCanvasModeOverride("inspect");
    if (isMobile) {
      setStatesOpen(false);
      setMobilePanelOpenOverride(true);
    }
    updateLinkState(node?.sourceFrameId ?? selectedFrameId, sourceNodeId);
  }

  function placeComment(point: PendingCommentPoint) {
    setPendingPoint(point);
    setSelectedFrameId(point.frameId);
    setCommentMode(false);
    setAnnotationMode(false);
    setPanelMode("comments");
    if (isMobile) {
      setStatesOpen(false);
      setMobilePanelOpenOverride(true);
    }
    setCommentError(null);
    setCanvasModeOverride(canvasMode);
    updateLinkState(point.frameId, point.sourceNodeId);
  }

  async function createAnnotation(point: PendingCommentPoint, title: string, body: string) {
    const response = await fetch(annotationsEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...point, title, body }),
    });
    const payload = await response.json() as { annotation?: CanvasAnnotationRecord; error?: string };
    if (!response.ok || !payload.annotation) throw new Error(payload.error ?? "Could not save the canvas note.");
    setAnnotations((current) => [...current, payload.annotation!]);
    setSelectedAnnotationId(payload.annotation.id);
    setAnnotationError(null);
    await refreshAnnotations();
  }

  async function updateAnnotation(annotationId: string, title: string, body: string) {
    const response = await fetch(`${annotationsEndpoint}/${encodeURIComponent(annotationId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, body }),
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not update the canvas note.");
    setAnnotations((current) => current.map((annotation) => annotation.id === annotationId ? { ...annotation, title, body } : annotation));
    setAnnotationError(null);
  }

  async function deleteAnnotation(annotationId: string) {
    const response = await fetch(`${annotationsEndpoint}/${encodeURIComponent(annotationId)}`, { method: "DELETE" });
    const payload = await response.json() as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not delete the canvas note.");
    setAnnotations((current) => current.filter((annotation) => annotation.id !== annotationId));
    setSelectedAnnotationId(null);
    setAnnotationError(null);
  }

  function placeAnnotation(point: PendingCommentPoint) {
    setPendingAnnotationPoint(point);
    setSelectedAnnotationId(null);
    setSelectedFrameId(point.frameId);
    setAnnotationMode(false);
    setCommentMode(false);
    setPanelMode("annotations");
    setAnnotationError(null);
    if (isMobile) {
      setStatesOpen(false);
      setMobilePanelOpenOverride(true);
    }
    setCanvasModeOverride(canvasMode);
    updateLinkState(point.frameId, point.sourceNodeId);
  }

  function selectAnnotation(annotationId: string) {
    const annotation = annotations.find((entry) => entry.id === annotationId);
    if (!annotation) return;
    setSelectedAnnotationId(annotation.id);
    setSelectedFrameId(annotation.frameId);
    setSelectedNodeId(annotation.sourceNodeId);
    setPendingAnnotationPoint(null);
    setPanelMode("annotations");
    setAnnotationMode(false);
    if (isMobile) {
      setStatesOpen(false);
      setMobilePanelOpenOverride(true);
    }
    setCanvasModeOverride(canvasMode);
    updateLinkState(annotation.frameId, annotation.sourceNodeId);
  }

  async function sendComment(input: Record<string, unknown>) {
    const response = await fetch(commentsEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not save comment.");
    await refreshComments();
  }

  async function createComment(body: string, point: PendingCommentPoint) {
    await sendComment({ body, ...point });
    setPendingPoint(null);
    setCommentError(null);
  }

  async function replyToComment(parentCommentId: string, body: string) {
    await sendComment({ body, parentCommentId });
    setCommentError(null);
  }

  async function resolveComment(commentId: string, resolved: boolean) {
    const response = await fetch("" + commentsEndpoint + "/" + encodeURIComponent(commentId), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolved }),
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not update comment.");
    await refreshComments();
  }

  function selectComment(commentId: string) {
    const comment = comments.find((entry) => entry.id === commentId);
    if (!comment) return;
    setSelectedFrameId(comment.frameId);
    setSelectedCommentId(comment.parentCommentId ?? comment.id);
    setSelectedNodeId(comment.sourceNodeId);
    setPanelMode("comments");
    if (isMobile) {
      setStatesOpen(false);
      setMobilePanelOpenOverride(true);
    }
    setCanvasModeOverride(canvasMode);
    updateLinkState(comment.frameId, comment.sourceNodeId, comment.id);
  }

  function compareFrame(frameId: string) {
    onCompareScreen(frameId);
    setCommentMode(false);
    setStatesOpen(false);
    onOpenComparison(frameId);
  }

  function compareSelectedFrame() {
    if (!selectedFrame) return;
    compareFrame(selectedFrame.id);
  }

  function commentOnSelectedElement() {
    if (!selectedNode || !selectedFrame) return;
    const x = selectedNode.bounds.x.value;
    const y = selectedNode.bounds.y.value;
    const width = selectedNode.bounds.width.value;
    const height = selectedNode.bounds.height.value;
    if (x === null || y === null || width === null || height === null) return;
    setPendingPoint({
      frameId: selectedFrame.id,
      sourceNodeId: selectedNode.sourceNodeId,
      x: x - selectedFrame.sourceX + width / 2,
      y: y - selectedFrame.sourceY + height / 2,
    });
    setPanelMode("comments");
    setCommentMode(false);
    if (isMobile) {
      setStatesOpen(false);
      setMobilePanelOpenOverride(true);
    }
    setCanvasModeOverride(canvasMode);
    updateLinkState(selectedFrame.id, selectedNode.sourceNodeId);
  }

  function commentOnScreen(frameId: string) {
    const frame = screens.find((candidate) => candidate.id === frameId);
    if (!frame) return;
    setSelectedFrameId(frame.id);
    setSelectedNodeId(null);
    setPendingPoint({ frameId: frame.id, sourceNodeId: null, x: frame.sourceWidth / 2, y: frame.sourceHeight / 2 });
    setPanelMode("comments");
    setCommentMode(false);
    if (isMobile) {
      setStatesOpen(false);
      setMobilePanelOpenOverride(true);
    }
    setCanvasModeOverride(canvasMode);
    updateLinkState(frame.id, null);
  }

  function commentOnSelectedScreen() {
    if (selectedFrame) commentOnScreen(selectedFrame.id);
  }

  function annotateSelectedScreen() {
    if (!selectedFrame) return;
    placeAnnotation({
      frameId: selectedFrame.id,
      sourceNodeId: null,
      x: selectedFrame.sourceWidth / 2,
      y: selectedFrame.sourceHeight / 2,
    });
  }

  const metaParts = [
    metadata.projectName + " · " + metadata.handoffName,
    formatCapturedAt(metadata.capturedAt),
    metadata.source + (metadata.sourceRevisionId ? " @ " + metadata.sourceRevisionId : ""),
    metadata.captureScope ? "Capture scope: " + metadata.captureScope : "",
    summaryText(comparisonSummary) || screens.length + " screens",
    metadata.releaseNote ?? "",
  ].filter(Boolean);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#202020] text-[#e5e5e5]">
      <header className="relative z-20 flex h-12 min-w-0 items-center gap-3 border-b border-[#383838] bg-[#202020] px-3 text-[#c8c8c8]">
        <Link className="max-w-[180px] shrink-0 truncate text-[13px] font-semibold text-[#ededed] hover:text-white" href={metadata.projectHref}>
          Asbir <span className="font-normal text-[#929292]">Handoff</span>
        </Link>
        <span aria-hidden="true" className="h-6 w-px shrink-0 bg-[#3b3b3b]" />
        <label className="sr-only" htmlFor="review-version-select">Snapshot version</label>
        <select
          className="h-9 max-w-[340px] min-w-[210px] shrink-0 rounded-[8px] border border-transparent bg-[#303030] px-3 text-[13px] text-[#ececec] hover:bg-[#363636] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#b4b4b4]"
          id="review-version-select"
          onChange={(event) => window.location.assign(metadata.versionHrefPrefix + "?versionId=" + encodeURIComponent(event.target.value))}
          value={metadata.selectedVersionId}
        >
          {metadata.versions.map((version) => (
            <option key={version.id} value={version.id}>Version {version.versionLabel} · {metadata.handoffName}</option>
          ))}
        </select>
        <p className="hidden min-w-0 flex-1 truncate text-[12px] text-[#999] xl:block" title={metaParts.join(" · ")}>
          {metaParts.join(" · ")}
        </p>
        <nav aria-label="Handoff review tools" className="ml-auto flex shrink-0 items-center gap-1">
          <InstallAppButton compact />
          <button
            aria-pressed={statesOpen}
            className={"h-8 shrink-0 rounded-[7px] px-2 text-[11px] font-medium transition-colors lg:hidden " + (statesOpen ? "bg-[#444] text-white" : "text-[#c3c3c3] hover:bg-[#303030] hover:text-white")}
            id="canvas-mobile-screens-toggle"
            onClick={() => {
              setSearchOpen(false);
              setStatesOpen((current) => !current);
              setMobilePanelOpenOverride(false);
            }}
            title={statesOpen ? "Hide screens" : "Show screens"}
            type="button"
          >
            Screens {screens.length}
          </button>
          <div aria-label="Canvas mode" className="flex h-8 shrink-0 items-center rounded-[7px] bg-[#292929] p-0.5" role="group">
            {(["view", "inspect"] as const).map((mode) => (
              <button
                aria-pressed={canvasMode === mode}
                className={"h-7 rounded-[5px] px-2 text-[11px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#aaa] " + (canvasMode === mode ? "bg-[#444] text-white" : "text-[#a9a9a9] hover:bg-[#363636] hover:text-white")}
                key={mode}
                onClick={() => {
                  setCanvasModeOverride(mode);
                  if (mode === "inspect") setPanelMode("inspect");
                }}
                type="button"
              >
                {mode === "view" ? "View" : "Inspect"}
              </button>
            ))}
          </div>
          <button
            aria-pressed={panelMode === "comments"}
            className={"h-9 rounded-[7px] px-3 text-[12px] transition-colors " + (panelMode === "comments" ? "bg-[#444] text-white" : "text-[#c3c3c3] hover:bg-[#303030] hover:text-white")}
            onClick={() => {
              setPanelMode("comments");
              setCommentMode(false);
              if (isMobile) {
                setStatesOpen(false);
                setSearchOpen(false);
                setMobilePanelOpenOverride(true);
              }
            }}
            title="Every open comment on every screen"
            type="button"
          >
            Comments{commentCount ? " " + commentCount : ""}
          </button>
          <button
            aria-pressed={panelMode === "annotations"}
            className={"h-9 rounded-[7px] px-3 text-[12px] transition-colors " + (panelMode === "annotations" ? "bg-[#444] text-white" : "text-[#c3c3c3] hover:bg-[#303030] hover:text-white")}
            onClick={() => {
              setPanelMode("annotations");
              setCommentMode(false);
              setAnnotationMode(false);
              setSearchOpen(false);
              if (isMobile) {
                setStatesOpen(false);
                setMobilePanelOpenOverride(true);
              }
            }}
            title="Canvas notes and annotations"
            type="button"
          >
            Notes{annotations.length ? " " + annotations.length : ""}
          </button>
          {metadata.canManageIntegrations ? <button
            aria-pressed={panelMode === "mcp"}
            className={"h-9 rounded-[7px] px-3 text-[12px] transition-colors lg:hidden " + (panelMode === "mcp" ? "bg-[#444] text-white" : "text-[#c3c3c3] hover:bg-[#303030] hover:text-white")}
            onClick={() => {
              setPanelMode("mcp");
              setCommentMode(false);
              setAnnotationMode(false);
              setStatesOpen(false);
              setSearchOpen(false);
              setMobilePanelOpenOverride(true);
            }}
            title="MCP connection instructions"
            type="button"
          >
            MCP
          </button> : null}
          <button
            aria-pressed={outlinesVisible}
            className={"hidden h-9 rounded-[7px] px-3 text-[12px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#aaa] sm:inline-flex sm:items-center " + (outlinesVisible ? "bg-[#3b3b3b] text-white" : "text-[#c3c3c3] hover:bg-[#303030] hover:text-white")}
            onClick={() => {
              setCanvasModeOverride("inspect");
              setPanelMode("inspect");
              setOutlinesVisible((current) => !current);
            }}
            title="Outline every element on the screens (O)"
            type="button"
          >
            Outlines
          </button>
          <button
            aria-label="Toggle Figma layout grids"
            aria-pressed={layoutGridsVisible && hasLayoutGrids}
            className={"hidden h-9 rounded-[7px] px-3 text-[12px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#aaa] sm:inline-flex sm:items-center " + (layoutGridsVisible && hasLayoutGrids ? "bg-[#3b3b3b] text-white" : "text-[#c3c3c3] hover:bg-[#303030] hover:text-white") + (hasLayoutGrids ? "" : " cursor-not-allowed opacity-45")}
            disabled={!hasLayoutGrids}
            onClick={() => setLayoutGridsVisible((current) => !current)}
            title={hasLayoutGrids ? "Show captured Figma layout grids" : "No visible Figma layout grids were captured"}
            type="button"
          >
            Grid
          </button>
          {viewportControls ? (
            <CanvasToolbar
              scale={viewportControls.scale}
                exportTargets={exportTargets}
              onZoomOut={viewportControls.zoomOut}
              onFit={viewportControls.fitToFrame}
              onZoomIn={viewportControls.zoomIn}
            />
          ) : <span className="px-2 text-[11px] text-[#999]">Fit</span>}
        </nav>
      </header>
      {latestPublished && latestPublished.versionId !== metadata.selectedVersionId ? (
        <div className="flex min-h-10 items-center justify-between gap-3 border-b border-[#514127] bg-[#342a1a] px-4 py-2 text-[11px] text-[#f0c77b]">
          <p>{latestPublished.versionId !== metadata.publishedVersionId ? "A new version was published" : "Latest published version"} · Version {latestPublished.versionLabel}</p>
          <Link className="shrink-0 rounded-[4px] px-2 py-1 font-medium text-[#ffe0a4] hover:bg-white/10 hover:text-white" href={metadata.versionHrefPrefix + "?versionId=" + encodeURIComponent(latestPublished.versionId)}>View latest</Link>
        </div>
      ) : null}
      {comparisonSummary && (
        comparisonSummary.changed > 0 || comparisonSummary.added > 0 || comparisonSummary.removed > 0 ||
        comparisonSummary.onlyInAfterCapture > 0 || comparisonSummary.onlyInBeforeCapture > 0 || comparisonSummary.changeCount > 0
      ) ? (
        <div aria-live="polite" className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-[#514127] bg-[#342a1a] px-4 py-2 text-[11px] text-[#f0c77b]">
          <p>
            <span className="font-semibold text-[#ffe0a4]">{[
              comparisonSummary.changed ? `${comparisonSummary.changed} screen${comparisonSummary.changed === 1 ? "" : "s"} changed` : "",
              comparisonSummary.added ? `${comparisonSummary.added} new` : "",
              comparisonSummary.removed ? `${comparisonSummary.removed} removed` : "",
              comparisonSummary.onlyInAfterCapture ? `${comparisonSummary.onlyInAfterCapture} screen${comparisonSummary.onlyInAfterCapture === 1 ? "" : "s"} with no match in the earlier capture` : "",
              comparisonSummary.onlyInBeforeCapture ? `${comparisonSummary.onlyInBeforeCapture} screen${comparisonSummary.onlyInBeforeCapture === 1 ? "" : "s"} with no match in this capture` : "",
            ].filter(Boolean).join(" · ")}</span>
            {comparisonSummary.changeCount ? ` · ${formatComparisonChangeCount(comparisonSummary.changeCount, comparisonSummary.visualChangeCount)}` : ""}
            {` since ${comparisonSummary.earlierVersionLabel}`}
          </p>
          <button
            className="shrink-0 rounded-[5px] px-2.5 py-1 font-medium text-[#ffe0a4] hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f0c77b]"
            onClick={() => {
              setCommentMode(false);
              setStatesOpen(false);
              setSearchOpen(false);
              onOpenComparison();
            }}
            type="button"
          >
            Review changes
          </button>
        </div>
      ) : null}

      <div className={"relative grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)] overflow-hidden " + (statesOpen ? "lg:grid-cols-[240px_minmax(0,1fr)_320px]" : "lg:grid-cols-[minmax(0,1fr)_320px]")}>
        {isMobile && (statesOpen || mobilePanelOpen) ? (
          <button
            aria-label="Close canvas side panel"
            className="absolute inset-0 z-20 cursor-default bg-black/35 lg:hidden"
            onClick={() => {
              setStatesOpen(false);
              setSearchOpen(false);
              setMobilePanelOpenOverride(false);
            }}
            type="button"
          />
        ) : null}
        {statesOpen ? (
          <div
            aria-label={searchOpen ? "Search screens" : "Snapshot screens"}
            aria-modal={isMobile && statesOpen ? true : undefined}
            className="absolute inset-y-0 left-0 z-30 w-[min(260px,86vw)] shadow-2xl lg:static lg:z-auto lg:w-auto lg:shadow-none"
            ref={screenPanelRef}
            role={isMobile && statesOpen ? "dialog" : undefined}
            tabIndex={isMobile ? -1 : undefined}
          >
            {isMobile ? (
              <div className="flex justify-end border-b border-[#3a3a3a] bg-[#202020] px-2 py-1.5 lg:hidden">
                <button
                  aria-label="Close screens panel"
                  className="min-h-8 rounded-[5px] px-2.5 text-[11px] text-[#bdbdbd] hover:bg-[#303030] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#aaa]"
                  onClick={() => {
                    setStatesOpen(false);
                    setSearchOpen(false);
                    setMobilePanelOpenOverride(false);
                  }}
                  type="button"
                >
                  Close
                </button>
              </div>
            ) : null}
            {searchOpen ? (
              <nav aria-label="Search screens" className="flex h-full min-h-0 min-w-0 flex-col border-r border-[#3a3a3a] bg-[#202020] text-[#c4c4c4]">
                <div className="shrink-0 space-y-3 border-b border-[#3a3a3a] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <button
                      className="rounded-[5px] px-2 py-1 text-[11px] text-[#bdbdbd] hover:bg-[#303030] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#aaa]"
                      onClick={closeSearchPanel}
                      type="button"
                    >
                      ← Screens
                    </button>
                    <span className="font-mono text-[10px] text-[#888]">{searchQuery.trim() ? `${searchResults.length} found` : "Search"}</span>
                  </div>
                  <input
                    autoFocus
                    ref={searchInputRef}
                    aria-activedescendant={activeSearchIndex >= 0 ? `handoff-search-result-${activeSearchIndex}` : undefined}
                    aria-autocomplete="list"
                    aria-controls={searchResults.length ? "handoff-search-results" : undefined}
                    aria-expanded={Boolean(searchResults.length)}
                    aria-label="Search text, colours and elements"
                    className="h-9 w-full rounded-[7px] border border-[#3b3b3b] bg-[#292929] px-2.5 text-[12px] text-[#ededed] outline-none placeholder:text-[#a0a0a0] focus:border-[#5b5b5b] focus:bg-[#343434] focus:ring-2 focus:ring-[#8a8a8a]/40"
                    id="handoff-search-input"
                    onChange={(event) => {
                      setSearchQuery(event.target.value);
                      setActiveSearchIndex(-1);
                    }}
                    placeholder="Text, colours, elements"
                    role="combobox"
                    type="search"
                    value={searchQuery}
                  />
                  <div aria-label="Search categories" className="flex gap-1 overflow-x-auto" role="group">
                    {(["All", "Text", "Colours", "Elements"] as SearchCategory[]).map((category) => (
                      <button
                        aria-pressed={searchCategory === category}
                        className={"shrink-0 rounded-[5px] px-2.5 py-1 text-[11px] " + (searchCategory === category ? "bg-[#414141] text-white" : "text-[#aaa] hover:bg-[#333] hover:text-white")}
                        key={category}
                        onClick={() => {
                          setSearchCategory(category);
                          setActiveSearchIndex(-1);
                        }}
                        type="button"
                      >
                        {category}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-2">
                  {searchQuery.trim() ? (
                    searchResults.length ? (
                      <ul aria-label="Search results" className="space-y-0.5" id="handoff-search-results" role="listbox">
                        {searchResults.map((result, index) => (
                          <li
                            aria-selected={index === activeSearchIndex}
                            className={"cursor-pointer rounded-[6px] px-3 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#aaa] " + (index === activeSearchIndex ? "bg-[#414141] text-white ring-1 ring-[#676767]" : "text-[#ddd] hover:bg-[#353535]")}
                            id={`handoff-search-result-${index}`}
                            key={result.frame.id + result.node.sourceNodeId + result.category + index}
                            onClick={() => {
                              setActiveSearchIndex(index);
                              selectSearchResult(result);
                            }}
                            onMouseDown={(event) => event.preventDefault()}
                            role="option"
                          >
                            <span className="block truncate text-[12px]">{result.node.name || result.node.type}</span>
                            <span className="mt-0.5 block truncate text-[11px] text-[#999]">{result.frame.name} · {result.detail}</span>
                            <span className="mt-1 block text-[10px] text-[#888]">{result.category}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p aria-live="polite" className="px-2 py-3 text-[11px] text-[#999]">No matching text, colours, or elements.</p>
                    )
                  ) : (
                    <p className="px-2 py-3 text-[11px] leading-5 text-[#929292]">Search captured text, colours, element names, and types.</p>
                  )}
                  {searchResults.length ? (
                    <button className="mt-2 min-h-8 w-full rounded-[5px] text-[11px] text-[#b9b9b9] hover:bg-[#353535] hover:text-white" onClick={copySearchHighlights} type="button">
                      Highlight all on the canvas
                    </button>
                  ) : null}
                </div>
                <footer aria-live="polite" className="shrink-0 border-t border-[#3c3c3c] px-3 py-2.5 text-[10px] text-[#999]">
                  {activeSearchIndex >= 0 ? `${activeSearchIndex + 1} of ${searchResults.length} selected · ` : ""}↑ ↓ preview · Enter inspect · Esc screens
                </footer>
              </nav>
            ) : (
              <FrameNavigator
                frames={frames}
                activeFrameId={selectedFrameId}
                onSelect={selectFrame}
                selectedNodeId={selectedNodeId}
                onSelectNode={selectNode}
                onOpenSearch={() => {
                  setSearchQuery("");
                  setSearchCategory("All");
                  setActiveSearchIndex(-1);
                  setSearchOpen(true);
                  setStatesOpen(true);
                  setMobilePanelOpenOverride(false);
                }}
                frameStatuses={frameStatuses}
                comparisonSummary={comparisonSummary}
                changedOnly={changedOnlyActive}
                onChangedOnlyChange={setChangedOnly}
              />
            )}
          </div>
        ) : null}
        <div className="col-start-1 row-start-1 flex h-full min-h-0 min-w-0 lg:col-auto lg:row-auto">
        <CanvasViewport
          frame={visualFrame}
          overviewOrigin={{ sourceX: overviewFrame.sourceX, sourceY: overviewFrame.sourceY }}
          interactionMode={canvasMode}
          screens={canvasScreens}
          changedOnly={changedOnlyActive}
          selectedFrameId={selectedFrameId}
          frameStatuses={frameStatuses}
          canCompare={canCompare}
          onCompareScreen={compareFrame}
          outlinesVisible={outlinesVisible}
          layoutGridsVisible={layoutGridsVisible && hasLayoutGrids}
          highlightedNodeIds={highlightedNodeIds}
          showResolvedPins={showResolvedPins}
          selectedNodeId={selectedNodeId}
          onSelectNode={selectNode}
          onSelectFrame={selectFrame}
          annotations={annotations}
          selectedAnnotationId={selectedAnnotationId}
          annotationMode={annotationMode}
          onSelectAnnotation={selectAnnotation}
          onPlaceAnnotation={placeAnnotation}
          comments={comments}
          selectedCommentId={selectedCommentId}
          commentMode={commentMode}
          onSelectComment={selectComment}
          onPlaceComment={placeComment}
          onViewportChange={setViewportControls}
        />
        </div>
        <aside
          aria-label="Handoff details"
          aria-modal={isMobile && mobilePanelOpen ? true : undefined}
          className={"min-h-0 min-w-0 flex-col overflow-hidden border-l border-[#3a3a3a] bg-[#202020] " + (mobilePanelOpen ? "absolute inset-y-0 right-0 z-30 flex w-[min(340px,94vw)] shadow-2xl lg:static lg:z-auto lg:w-auto lg:shadow-none" : "hidden lg:static lg:flex")}
          ref={detailsPanelRef}
          role={isMobile && mobilePanelOpen ? "dialog" : undefined}
          tabIndex={isMobile && mobilePanelOpen ? -1 : undefined}
        >
          {isMobile && mobilePanelOpen ? (
            <div className="flex shrink-0 justify-end border-b border-[#393939] px-2 py-1.5 lg:hidden">
              <button
                aria-label="Close details panel"
                className="min-h-8 rounded-[5px] px-2.5 text-[11px] text-[#bdbdbd] hover:bg-[#303030] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#aaa]"
                onClick={() => setMobilePanelOpenOverride(false)}
                type="button"
              >
                Close
              </button>
            </div>
          ) : null}
          <nav aria-label="Details panels" className="grid shrink-0 grid-cols-4 gap-1 border-b border-[#393939] p-2">
            {([
              ["inspect", "Properties", true],
              ["compare", "Compare", canCompare],
              ["version", "Version", Boolean(dockPanels.version)],
              ["changelog", "Changelog", Boolean(dockPanels.changelog)],
              ["qa", "QA", Boolean(dockPanels.qa)],
              ["agent", "Agent", Boolean(metadata.canManageIntegrations && metadata.reviewHref && metadata.versionIsPublished)],
              ["local", "Local", metadata.canUseLocalPreview],
              ["mcp", "MCP", metadata.canManageIntegrations],
            ] as const).filter(([, , visible]) => visible).map(([mode, label]) => (
              <button
                aria-pressed={mode === "compare" ? comparisonOpen : panelMode === mode}
                className={"min-h-8 truncate rounded-[5px] px-1.5 text-[10px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#aaa] " + ((mode === "compare" ? comparisonOpen : panelMode === mode) ? "bg-[#3b3b3b] text-white" : "text-[#a9a9a9] hover:bg-[#2e2e2e] hover:text-white")}
                key={mode}
                onClick={() => {
                  if (mode === "compare") {
                    onOpenComparison();
                    return;
                  }
                  setPanelMode(mode);
                  setCommentMode(false);
                  setAnnotationMode(false);
                  if (mode === "inspect") setCanvasModeOverride("inspect");
                  if (isMobile) setMobilePanelOpenOverride(true);
                }}
                type="button"
              >
                {label}
              </button>
            ))}
          </nav>
          {panelMode === "annotations" ? (
            <CanvasAnnotationsPanel key={`${selectedAnnotationId ?? "new"}:${pendingAnnotationPoint?.frameId ?? ""}:${pendingAnnotationPoint?.x ?? ""}:${pendingAnnotationPoint?.y ?? ""}`} annotations={annotations} screenNames={{ [overviewCanvasFrameId]: "Canvas", ...Object.fromEntries(screens.map((screen) => [screen.id, screen.name])) }} selectedAnnotationId={selectedAnnotationId} pendingPoint={pendingAnnotationPoint} placing={annotationMode} canEdit={metadata.canAnnotate} hasSelectedScreen={Boolean(selectedFrame)} error={annotationError} onSelect={selectAnnotation} onStartPlacement={() => { setCommentMode(false); setSelectedAnnotationId(null); setPendingAnnotationPoint(null); setAnnotationMode(true); }} onPlaceAtSelectedScreen={annotateSelectedScreen} onCancel={() => { setAnnotationMode(false); setPendingAnnotationPoint(null); setSelectedAnnotationId(null); }} onCreate={createAnnotation} onUpdate={updateAnnotation} onDelete={deleteAnnotation} />
          ) : panelMode === "comments" ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <CommentThread
              comments={comments}
              frames={frames}
              pendingPoint={pendingPoint}
              selectedCommentId={selectedCommentId}
              error={commentError}
              openCount={openCommentCount}
              canWrite={metadata.canAnnotate}
              hasSelectedScreen={Boolean(selectedFrame)}
              showResolvedPins={showResolvedPins}
              commentMode={commentMode}
              onCreate={createComment}
              onReply={replyToComment}
              onResolve={resolveComment}
              onSelect={selectComment}
              onPlaceAtSelectedScreen={commentOnSelectedScreen}
              onStartComment={() => {
                if (!screens.length) return;
                if (commentMode) {
                  setCommentMode(false);
                  setPendingPoint(null);
                } else {
                  setPendingPoint(null);
                  setCommentMode(true);
                }
              }}
              onToggleResolvedPins={setShowResolvedPins}
            />
          </div>
          ) : panelMode === "qa" && dockPanels.qa ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-3">{dockPanels.qa}</div>
          ) : panelMode === "changelog" && dockPanels.changelog ? (
            <div className="min-h-0 flex-1 overflow-y-auto">{dockPanels.changelog}</div>
          ) : panelMode === "version" && dockPanels.version ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-3">{dockPanels.version}</div>
        ) : panelMode === "mcp" ? (
          <McpConnectionPanel workspaceId={workspaceId} canManageIntegrations={metadata.canManageIntegrations} />
        ) : panelMode === "agent" && metadata.reviewHref && metadata.versionIsPublished ? (
          <AgentHandoffPanel input={{
            workspaceId,
            projectId,
            handoffId,
            versionId: metadata.selectedVersionId,
            versionLabel: metadata.versionLabel,
            contentHash: metadata.contentHash,
            source: metadata.source,
            sourceRevisionId: metadata.sourceRevisionId,
            releaseNote: metadata.releaseNote,
            reviewHref: metadata.reviewHref,
            integrationHref: `/workspace/${encodeURIComponent(workspaceId)}/integrations`,
            canManageIntegrations: metadata.canManageIntegrations,
            versions: metadata.versions,
            frames,
            initialFrameId: selectedFrameId,
            initialNodeId: selectedNodeId,
          }} />
        ) : panelMode === "local" && metadata.canUseLocalPreview ? (
          <LocalPreviewPanel
            workspaceId={workspaceId}
            handoffId={handoffId}
            frames={frames}
            selectedFrameId={selectedFrameId}
            onSelectFrame={selectFrame}
            onCommentOnScreen={commentOnScreen}
          />
        ) : panelMode === "inspect" ? (
          <ElementInspector
            frame={selectedFrame ?? overviewFrame}
            selectedNode={selectedNode}
            frameCount={screens.length}
            totalNodeCount={screens.reduce((count, frame) => count + frame.nodes.length, 0)}
            comments={selectedNode ? comments.filter((comment) => comment.sourceNodeId === selectedNode.sourceNodeId) : []}
            canComment={metadata.canAnnotate}
            canCompare={canCompare}
            onCompare={compareSelectedFrame}
            onAddComment={commentOnSelectedElement}
            onSelectNode={selectNode}
            onCopyLink={() => navigator.clipboard?.writeText(window.location.href)}
          />
          ) : null}
        </aside>
      </div>

    </div>
  );
}
