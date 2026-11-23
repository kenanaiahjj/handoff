"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { buildOverviewOverlayFromScreens, type CanvasNodeSummary } from "./canvas-node-summary";
import { useFrameNodeDetails } from "./useFrameNodeDetails";
import { useConfirm } from "@/src/components/ConfirmDialog";
import { CommentThread, type PendingCommentPoint } from "../comments/CommentThread";
import type { CommentIdentity, HandoffComment } from "../comments/CommentPin";
import { CanvasToolbar, ZoomControls } from "./CanvasToolbar";
import { CanvasViewport, type CanvasViewportControls } from "./CanvasViewport";
import { InstallAppButton } from "@/src/components/shell/InstallAppButton";
import { BrandMark } from "@/src/components/shell/BrandMark";
import { AgentHandoffPanel } from "./AgentHandoffPanel";
import { ElementInspector } from "./ElementInspector";
import { LocalPreviewOverlay } from "./LocalPreviewPanel";
import { CommentMediaProvider } from "../comments/comment-media";
import { CanvasAnnotationsPanel, type CanvasAnnotationRecord } from "./CanvasAnnotationsPanel";
import { McpConnectionPanel } from "./McpConnectionPanel";
import { CanvasShortcuts } from "./CanvasShortcuts";
import { PublishChangesDialog } from "./PublishChangesDialog";
import { ChangesIcon, CommentIcon, CompareIcon, CursorIcon, GridIcon, HandIcon, InspectIcon, KeyboardIcon, MoreIcon, InfoIcon, NoteIcon, OutlineIcon, PanelLeftIcon, PanelRightIcon, VersionIcon } from "./canvas-icons";
import { ProjectInfoPanel } from "./ProjectInfoPanel";
import { showToast } from "@/src/components/shell/Toaster";
import type { ProjectTeamMember } from "@/src/server/services/project-access";
import { getMeasureUnit, measureUnits, setMeasureUnit } from "./measure-unit";
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
  canManageSharing: boolean;
  canAnnotate: boolean;
  canComment: boolean;
  commentIdentity: CommentIdentity | null;
  canUseLocalPreview: boolean;
  /** Project team for the Info tab; null hides the tab (e.g. anonymous public review links). */
  team: ProjectTeamMember[] | null;
};

export type ReviewDockPanels = Partial<Record<"version", ReactNode>>;

type HandoffCanvasProps = {
  frames: CanvasFrameOption[];
  commentsEndpoint: string;
  workspaceId: string;
  projectId: string;
  handoffId: string;
  frameStatuses: Record<string, CanvasFrameChangeStatus>;
  comparisonSummary: FrameComparisonSummary | null;
  /** Elements changed in this version (outlined when Changes is on). */
  changedNodeIds?: string[];
  /** Arrived from a "N new" link: start with only the changed screens. */
  startChangedOnly?: boolean;
  canCompare: boolean;
  onCompareScreen: (frameId: string) => void;
  onOpenComparison: (frameId?: string) => void;
  /** Opens the list of changed screens with before/after renders. */
  onOpenChangesList?: () => void;
  comparisonOpen: boolean;
  metadata: ReviewMetadata;
  dockPanels: ReviewDockPanels;
};

type CommentPayload = { comments: HandoffComment[] };
type AnnotationPayload = { annotations: CanvasAnnotationRecord[] };
type SearchCategory = "All" | "Text" | "Colors" | "Elements";
type SearchResult = {
  frame: CanvasFrameOption;
  node: CanvasNodeSummary;
  category: Exclude<SearchCategory, "All">;
  detail: string;
};

function summaryText(summary: FrameComparisonSummary | null) {
  if (!summary) return "";
  const parts = [];
  if (summary.changed) parts.push(summary.changed + " changed");
  const added = summary.added + summary.onlyInAfterCapture;
  const removed = summary.removed + summary.onlyInBeforeCapture;
  if (added) parts.push(added + " new");
  if (removed) parts.push(removed + " removed");
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

// The change summary can be hidden per version for this browser tab.
function subscribeToSummaryDismissals(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

function readSummaryDismissal(key: string) {
  try {
    return sessionStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function getServerLocationHash() {
  return "";
}

const MOBILE_PANEL_FOCUSABLE_SELECTOR = "a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex='-1'])";

/** Per-browser canvas preferences (side panels, change highlights). Storage can be unavailable. */
function readCanvasPreference(name: string, fallback: boolean) {
  try {
    const value = localStorage.getItem("asbir.canvas." + name);
    return value === null ? fallback : value === "1";
  } catch {
    return fallback;
  }
}

function writeCanvasPreference(name: string, value: boolean) {
  try {
    localStorage.setItem("asbir.canvas." + name, value ? "1" : "0");
  } catch {
    // Private mode or blocked storage: the preference lasts for this page only.
  }
}

function getFocusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(MOBILE_PANEL_FOCUSABLE_SELECTOR))
    .filter((element) => element.getClientRects().length > 0 && !element.closest("[hidden], [aria-hidden='true']"));
}

export function HandoffCanvas({
  frames: framesProp,
  commentsEndpoint,
  workspaceId,
  projectId,
  handoffId,
  frameStatuses,
  comparisonSummary,
  changedNodeIds = [],
  startChangedOnly = false,
  canCompare,
  onCompareScreen,
  onOpenComparison,
  onOpenChangesList,
  comparisonOpen,
  metadata,
  dockPanels,
}: HandoffCanvasProps) {
  // The server sends each element once (per screen); derive the overview's hit areas here.
  const frames = useMemo(() => framesProp.map((frame) => frame.kind === "overview" && frame.exact
    ? { ...frame, overlayNodes: buildOverviewOverlayFromScreens(framesProp.filter((candidate) => candidate.kind === "frame")) }
    : frame), [framesProp]);
  const sharingEndpoint = metadata.canManageSharing
    ? `/api/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/handoffs/${encodeURIComponent(handoffId)}`
    : null;
  const overviewFrame = frames.find((frame) => frame.kind === "overview") ?? frames[0];
  const latestVersion = metadata.versions[0];
  const canRemoveScreens = Boolean(sharingEndpoint) && !metadata.visualOnly && latestVersion?.id === metadata.selectedVersionId;
  const [removingScreen, setRemovingScreen] = useState(false);
  // Pending changes for the next version: screens marked for removal (Shift-click on the canvas,
  // the list's Select mode, or the inspector). Kept on this device until published or discarded.
  const [removalSelecting, setRemovalSelecting] = useState(false);
  const [removalPicked, setRemovalPicked] = useState<Set<string>>(() => new Set());
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const draftKey = `asbir-draft-removals:${handoffId}:${metadata.versions[0]?.id ?? ""}`;
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(draftKey) ?? "[]");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the draft lives in localStorage, only readable after mount.
      if (Array.isArray(saved) && saved.length) setRemovalPicked(new Set(saved.filter((id): id is string => typeof id === "string")));
    } catch {
      // No saved draft.
    }
  }, [draftKey]);
  const updateDraft = useCallback((next: Set<string>) => {
    setRemovalPicked(next);
    try {
      if (next.size) localStorage.setItem(draftKey, JSON.stringify([...next]));
      else localStorage.removeItem(draftKey);
    } catch {
      // Storage blocked: the draft lasts until the page reloads.
    }
  }, [draftKey]);
  const router = useRouter();
  const { confirm: confirmRemoval, dialog: removalDialog } = useConfirm();
  const screens = useMemo(() => frames.filter((frame) => frame.kind === "frame"), [frames]);
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
  const [changedOnly, setChangedOnly] = useState(startChangedOnly);
  const [showChanges, setShowChanges] = useState(true);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // Centres and zooms the canvas to a screen; each request gets a new seq so repeats still apply.
  const [focusRequest, setFocusRequest] = useState<{ frameId: string; seq: number } | null>(null);
  const focusScreen = useCallback((frameId: string) => {
    setFocusRequest((current) => ({ frameId, seq: (current?.seq ?? 0) + 1 }));
  }, []);
  const [moreOpen, setMoreOpen] = useState(false);
  const [panelMoreOpen, setPanelMoreOpen] = useState(false);
  const [comments, setComments] = useState<HandoffComment[]>([]);
  const [annotations, setAnnotations] = useState<CanvasAnnotationRecord[]>([]);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [localSelectedCommentId, setSelectedCommentId] = useState<string | null>(null);
  const [showResolvedPins, setShowResolvedPins] = useState(false);
  const [panelMode, setPanelMode] = useState<"inspect" | "comments" | "annotations" | "version" | "info" | "agent" | "mcp">("inspect");
  const [localPreviewOpen, setLocalPreviewOpen] = useState(false);
  const closeLocalPreview = useCallback(() => setLocalPreviewOpen(false), []);
  const [canvasModeOverride, setCanvasModeOverride] = useState<"view" | "inspect" | null>(null);
  // Open by default so the server render already has the desktop layout (screen list included);
  // until the real viewport is known, the list stays hidden below the desktop breakpoint.
  const [statesOpen, setStatesOpen] = useState(true);
  // The details panel on the right. Only used at desktop widths; below them it is a sheet
  // opened with mobilePanelOpenOverride.
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [layoutReady, setLayoutReady] = useState(false);
  const [mobilePanelOpenOverride, setMobilePanelOpenOverride] = useState<boolean | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const canvasMode = canvasModeOverride ?? (linkedNode ? "inspect" : "view");
  const mobilePanelOpen = mobilePanelOpenOverride ?? (isMobile && Boolean(linkedNode));
  const [commentMode, setCommentMode] = useState(false);
  const [commentThreadOpen, setCommentThreadOpen] = useState(false);
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
  // Only point at the published version when it is newer than the one open (versions are newest
  // first; one missing from the list was published after this page loaded, so it is newer too).
  const publishedIndex = latestPublished ? metadata.versions.findIndex((version) => version.id === latestPublished.versionId) : -1;
  const openIndex = metadata.versions.findIndex((version) => version.id === metadata.selectedVersionId);
  const newerPublished = latestPublished && latestPublished.versionId !== metadata.selectedVersionId
    && (publishedIndex === -1 || openIndex === -1 || publishedIndex < openIndex) ? latestPublished : null;
  const summaryDismissKey = `asbir-changes-dismissed:${metadata.selectedVersionId}`;
  const storedDismissal = useSyncExternalStore(subscribeToSummaryDismissals, () => readSummaryDismissal(summaryDismissKey), () => false);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const summaryDismissed = storedDismissal || dismissedKey === summaryDismissKey;
  function dismissSummary() {
    setDismissedKey(summaryDismissKey);
    try {
      sessionStorage.setItem(summaryDismissKey, "1");
    } catch {
      // Storage blocked: it stays hidden until the page reloads.
    }
  }

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
      // Desktop remembers which side panels were hidden; on small screens both start closed.
      setStatesOpen(!media.matches && readCanvasPreference("screensPanel", true));
      setDetailsOpen(readCanvasPreference("detailsPanel", true));
      setShowChanges(readCanvasPreference("showChanges", true));
      setMobilePanelOpenOverride(null);
      setLayoutReady(true);
    };
    updateLayout();
    media.addEventListener("change", updateLayout);
    return () => media.removeEventListener("change", updateLayout);
  }, []);

  useEffect(() => {
    if (!layoutReady || isMobile) return;
    writeCanvasPreference("screensPanel", statesOpen);
    writeCanvasPreference("detailsPanel", detailsOpen);
  }, [detailsOpen, isMobile, layoutReady, statesOpen]);

  useEffect(() => {
    if (layoutReady) writeCanvasPreference("showChanges", showChanges);
  }, [layoutReady, showChanges]);

  // Switching panels from the toolbar or a menu (comments, AI tools) brings a hidden details panel back.
  const previousPanelModeRef = useRef(panelMode);
  useEffect(() => {
    if (previousPanelModeRef.current === panelMode) return;
    previousPanelModeRef.current = panelMode;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reacts to panel switches made in many handlers.
    if (!isMobile) setDetailsOpen(true);
  }, [isMobile, panelMode]);

  const toggleScreensPanel = useCallback(() => {
    setSearchOpen(false);
    setStatesOpen((current) => !current);
    if (isMobile) setMobilePanelOpenOverride(false);
  }, [isMobile]);

  const toggleDetailsPanel = useCallback(() => {
    if (isMobile) {
      setStatesOpen(false);
      setSearchOpen(false);
      setMobilePanelOpenOverride((current) => !(current ?? Boolean(linkedNode)));
      return;
    }
    setDetailsOpen((current) => !current);
  }, [isMobile, linkedNode]);

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
  const requestedSelectedNode = useMemo<CanvasNodeSummary | null>(() => {
    if (!requestedSelectedNodeId) return null;
    return screens.flatMap((frame) => frame.nodes).find((node) => node.sourceNodeId === requestedSelectedNodeId) ?? null;
  }, [screens, requestedSelectedNodeId]);
  const selectedNode = changedOnlyActive && requestedSelectedNode &&
    !canvasScreens.some((frame) => frame.id === requestedSelectedNode.sourceFrameId)
    ? null
    : requestedSelectedNode;
  const selectedNodeId = selectedNode?.sourceNodeId ?? (changedOnlyActive ? null : requestedSelectedNodeId);

  // The canvas renders from element summaries; full details load per screen on demand.
  const frameNodesEndpoint = useCallback(
    (frameId: string) => commentsEndpoint.replace(/\/comments$/, `/frames/${encodeURIComponent(frameId)}/nodes`),
    [commentsEndpoint],
  );
  const frameDetails = useFrameNodeDetails(frameNodesEndpoint);
  const { ensure: ensureFrameNodes } = frameDetails;
  useEffect(() => {
    if (selectedNode) ensureFrameNodes(selectedNode.sourceFrameId);
  }, [ensureFrameNodes, selectedNode]);
  const selectedFrameNodes = selectedNode ? frameDetails.nodesFor(selectedNode.sourceFrameId) : null;
  const detailedSelectedNode = selectedNode
    ? selectedFrameNodes?.find((node) => node.sourceNodeId === selectedNode.sourceNodeId) ?? null
    : null;

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
          { category: "Colors", value: colorValue, detail: colorValue || "No captured color" },
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
    focusScreen(result.frame.id);
    updateLinkState(result.frame.id, result.node.sourceNodeId);
  }, [focusScreen, updateLinkState]);

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
      // ⌘+ / ⌘− / ⌘0 (Ctrl on Windows) zoom the canvas instead of the browser page. Matched by key
      // position too, so it works on layouts where "=" or "-" sit elsewhere.
      if ((event.metaKey || event.ctrlKey) && !event.altKey) {
        const zoomIn = event.key === "=" || event.key === "+" || event.code === "Equal" || event.code === "NumpadAdd";
        const zoomOut = event.key === "-" || event.key === "_" || event.code === "Minus" || event.code === "NumpadSubtract";
        const fit = event.key === "0" || event.code === "Digit0" || event.code === "Numpad0";
        if (zoomIn || zoomOut || fit) {
          event.preventDefault();
          if (zoomIn) viewportControls?.zoomIn();
          else if (zoomOut) viewportControls?.zoomOut();
          else viewportControls?.fitToFrame();
          return;
        }
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
      if (event.key === "Escape" && target instanceof Element && target.closest("[data-comment-popover]")) {
        event.preventDefault();
        setPendingPoint(null);
        setCommentThreadOpen(false);
        return;
      }
      if (editing) return;
      const modified = event.metaKey || event.ctrlKey || event.altKey;
      if (!modified && event.key.toLowerCase() === "c" && metadata.canComment) {
        event.preventDefault();
        setAnnotationMode(false);
        setPendingAnnotationPoint(null);
        setPendingPoint(null);
        setCommentThreadOpen(false);
        setCommentMode((current) => !current);
        return;
      }
      if (event.key === "?") {
        event.preventDefault();
        setShortcutsOpen(true);
        return;
      }
      // ⌘\ / Ctrl+\ shows or hides both side panels, as in Figma.
      if ((event.metaKey || event.ctrlKey) && event.key === "\\") {
        event.preventDefault();
        togglePanelsRef.current();
        return;
      }
      // ⌘L / Ctrl+L copies a link to the selected screen or element, as in Figma. Opening it selects
      // and zooms to that screen.
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "l") {
        event.preventDefault();
        const current = new URLSearchParams(window.location.hash.slice(1));
        const url = new URL(window.location.href);
        const hash = new URLSearchParams();
        const screenId = current.get("screen");
        const elementId = current.get("element");
        if (screenId) hash.set("screen", screenId);
        if (elementId) hash.set("element", elementId);
        url.hash = hash.toString();
        const screenName = screenId ? screens.find((screen) => screen.id === screenId)?.name : undefined;
        const label = elementId ? "Link to element copied" : screenName ? `Link to “${screenName}” copied` : "Link to handoff copied";
        navigator.clipboard?.writeText(url.toString()).then(() => showToast(label), () => showToast("Couldn’t copy the link"));
        return;
      }
      if (modified) return;
      const key = event.key.toLowerCase();
      if (key === "o") {
        setCanvasModeOverride("inspect");
        setPanelMode("inspect");
        setOutlinesVisible((current) => !current);
      }
      if (key === "v") setCanvasModeOverride("view");
      if (key === "i") {
        setCanvasModeOverride("inspect");
        setPanelMode("inspect");
      }
      if (key === "g") setLayoutGridsVisible((current) => !current);
      if (key === "d") setShowChanges((current) => !current);
      if (key === "u") {
        const current = measureUnits.indexOf(getMeasureUnit());
        setMeasureUnit(measureUnits[(current + 1) % measureUnits.length]);
      }
      if (event.key === "[" || event.key === "]") {
        event.preventDefault();
        stepScreenRef.current(event.key === "]" ? 1 : -1);
      }
      // Zoom works wherever focus is (not only on the canvas). Shift+digit is matched by key position,
      // because Shift+1 types "!" on most layouts.
      if (event.key === "+" || event.key === "=") viewportControls?.zoomIn();
      if (event.key === "-" || event.key === "_") viewportControls?.zoomOut();
      if (event.key === "0" || (event.shiftKey && event.code === "Digit1")) viewportControls?.fitToFrame();
      if (event.shiftKey && event.code === "Digit2" && selectedFrameIdRef.current) focusScreen(selectedFrameIdRef.current);
      if (event.key === "Escape") {
        setRemovalSelecting(false);
        setSearchOpen(false);
        setCommentMode(false);
        setAnnotationMode(false);
        setPendingAnnotationPoint(null);
        setPendingPoint(null);
        setCommentThreadOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeSearchIndex, closeSearchPanel, copySearchHighlights, focusScreen, metadata.canComment, previewSearchResult, screens, searchOpen, searchResults, selectSearchResult, viewportControls]);

  // Pinch and Ctrl+scroll over the toolbar or side panels would zoom the whole page. The canvas
  // handles its own pinch (and marks the event), so everywhere else just swallow it.
  useEffect(() => {
    const blockPageZoom = (event: WheelEvent) => {
      if (event.ctrlKey && !event.defaultPrevented) event.preventDefault();
    };
    const blockGesture = (event: Event) => {
      if (!event.defaultPrevented) event.preventDefault();
    };
    window.addEventListener("wheel", blockPageZoom, { passive: false });
    window.addEventListener("gesturestart", blockGesture, { passive: false });
    window.addEventListener("gesturechange", blockGesture, { passive: false });
    return () => {
      window.removeEventListener("wheel", blockPageZoom);
      window.removeEventListener("gesturestart", blockGesture);
      window.removeEventListener("gesturechange", blockGesture);
    };
  }, []);

  // Clicking anywhere outside the anchored comment (or another pin) closes it, like Figma.
  useEffect(() => {
    if (!pendingPoint && !commentThreadOpen) return;
    function closeOnOutsidePointer(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-comment-popover], [data-comment-pin], [data-comment-list]")) return;
      setPendingPoint(null);
      setCommentThreadOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [commentThreadOpen, pendingPoint]);

  // Live comments: poll every ten seconds while visible, never overlapping, and refresh as soon as
  // the tab becomes visible or focused again. Failures back off (up to a minute) so a struggling
  // server isn't hammered by every open tab; the last good list stays on screen.
  useEffect(() => {
    let active = true;
    let inFlight = false;
    let delay = 10_000;
    let timer: number | undefined;
    function schedule() {
      if (active) timer = window.setTimeout(() => void poll(), delay);
    }
    async function poll() {
      window.clearTimeout(timer);
      if (inFlight) return;
      if (document.visibilityState !== "visible") return schedule();
      inFlight = true;
      try {
        const response = await fetch(commentsEndpoint, { cache: "no-store" });
        if (!response.ok) throw new Error(String(response.status));
        const payload = await response.json() as CommentPayload;
        if (active && Array.isArray(payload.comments)) setComments(payload.comments);
        delay = 10_000;
      } catch {
        delay = Math.min(delay * 2, 60_000);
      } finally {
        inFlight = false;
        schedule();
      }
    }
    schedule();
    const onVisible = () => { if (document.visibilityState === "visible") void poll(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      active = false;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [commentsEndpoint]);

  // "[" and "]" step through the screens in list order (only the changed ones when filtered).
  const stepScreenRef = useRef<(direction: 1 | -1) => void>(() => {});
  const selectedFrameIdRef = useRef<string | null>(null);
  const togglePanelsRef = useRef<() => void>(() => {});
  useEffect(() => {
    stepScreenRef.current = (direction) => {
      const list = canvasScreens.length ? canvasScreens : screens;
      if (!list.length) return;
      const index = list.findIndex((frame) => frame.id === selectedFrameId);
      const next = index === -1 ? (direction === 1 ? 0 : list.length - 1) : (index + direction + list.length) % list.length;
      selectFrame(list[next].id);
      focusScreen(list[next].id);
    };
    selectedFrameIdRef.current = selectedFrameId;
    togglePanelsRef.current = () => {
      if (isMobile) {
        toggleScreensPanel();
        return;
      }
      const show = !statesOpen && !detailsOpen;
      setStatesOpen(show);
      setDetailsOpen(show);
    };
  });

  // "?comment=<id>" (from "Needs you" or a notification) opens that thread once comments load.
  const selectCommentRef = useRef(selectComment);
  useEffect(() => {
    selectCommentRef.current = selectComment;
  });
  const openedCommentFromUrl = useRef(false);
  useEffect(() => {
    if (openedCommentFromUrl.current || !comments.length) return;
    const target = new URLSearchParams(window.location.search).get("comment");
    openedCommentFromUrl.current = true;
    if (target && comments.some((comment) => comment.id === target)) selectCommentRef.current(target);
  }, [comments]);

  if (!overviewFrame || !visualFrame) {
    return <p className="p-6 text-sm text-foreground-muted">This snapshot has no frames to display.</p>;
  }

  const pendingRemovals = canRemoveScreens ? [...removalPicked].filter((id) => screens.some((frame) => frame.id === id)) : [];

  function toggleRemoval(frameId: string) {
    const next = new Set(removalPicked);
    if (next.has(frameId)) next.delete(frameId);
    else next.add(frameId);
    updateDraft(next);
  }

  // Publishing applies every pending change as ONE new version (versions never change), then
  // publishes it to reviewers. The comparison and changelog list the removed screens.
  async function publishChanges(input: { versionLabel: string; releaseNote: string }): Promise<string | null> {
    if (!canRemoveScreens || !sharingEndpoint || !latestVersion || !pendingRemovals.length) return "Nothing to publish.";
    if (pendingRemovals.length >= screens.length) return "A version needs at least one screen. Keep one and try again.";
    setRemovingScreen(true);
    try {
      const response = await fetch(`${sharingEndpoint}/versions/remove-screens`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseVersionId: latestVersion.id,
          frameIds: pendingRemovals,
          versionLabel: input.versionLabel || undefined,
          releaseNote: input.releaseNote || undefined,
        }),
      });
      const payload = await response.json() as { versionId?: string; error?: string };
      if (!response.ok || !payload.versionId) throw new Error(payload.error ?? "Could not publish this version.");
      await fetch(`${sharingEndpoint}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId: payload.versionId }),
      }).catch(() => null);
      updateDraft(new Set());
      router.push(`${metadata.versionHrefPrefix}?versionId=${encodeURIComponent(payload.versionId)}`);
      return null;
    } catch (cause) {
      setRemovingScreen(false);
      return cause instanceof Error ? cause.message : "Could not publish this version.";
    }
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
    setCommentThreadOpen(false);
    setSelectedCommentId(null);
    setSelectedFrameId(point.frameId);
    setCommentMode(false);
    setAnnotationMode(false);
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
    const payload = await response.json() as { error?: string; id?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not save comment.");
    await refreshComments();
    return payload;
  }

  async function createComment(body: string, point: PendingCommentPoint, attachmentIds: string[] = []) {
    const created = await sendComment({ body, ...point, attachmentIds });
    setPendingPoint(null);
    setCommentError(null);
    // Posting closes the popover; the new pin stays selected so a click reopens the thread.
    setCommentThreadOpen(false);
    if (created.id) setSelectedCommentId(created.id);
  }

  async function replyToComment(parentCommentId: string, body: string, attachmentIds: string[] = []) {
    await sendComment({ body, parentCommentId, attachmentIds });
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
    setPendingPoint(null);
    setCommentThreadOpen(true);
    setPanelMode("comments");
    if (isMobile) {
      setStatesOpen(false);
      setMobilePanelOpenOverride(false);
    }
    setCanvasModeOverride(canvasMode);
    updateLinkState(comment.frameId, comment.sourceNodeId, comment.id);
  }


  function compareFrame(frameId: string) {
    onCompareScreen(frameId);
    setCommentMode(false);
    if (isMobile) setStatesOpen(false);
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

  const hasChangeHighlights = changedNodeIds.length > 0 || Object.values(frameStatuses).some((status) => status === "changed" || status === "added");
  const detailsPanelVisible = isMobile ? mobilePanelOpen : detailsOpen;

  const metaParts = [
    metadata.projectName + " · " + metadata.handoffName,
    formatCapturedAt(metadata.capturedAt),
    metadata.source + (metadata.sourceRevisionId ? " @ " + metadata.sourceRevisionId : ""),
    metadata.captureScope ? "Capture scope: " + metadata.captureScope : "",
    summaryText(comparisonSummary) || screens.length + " screens",
    metadata.releaseNote ?? "",
  ].filter(Boolean);

  return (
    <CommentMediaProvider endpoint={commentsEndpoint}>
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface text-foreground">
      <header className="canvas-topbar relative z-20 flex min-h-12 min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-border bg-surface px-2.5 py-1.5 text-foreground-muted lg:flex-nowrap lg:py-0">
        <div className="flex min-w-0 flex-1 items-center gap-2 lg:flex-initial lg:shrink">
          <Link aria-label="Asbir Handoff home" className="flex min-h-9 shrink-0 items-center max-sm:hidden rounded-lg px-1 transition-opacity hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" href={metadata.projectHref.startsWith("/projects") ? "/workspace" : metadata.projectHref}>
            <BrandMark compact />
          </Link>
          <span aria-hidden="true" className="h-5 w-px shrink-0 bg-white/[0.08] max-sm:hidden" />
          <button
            aria-label={(statesOpen ? "Hide" : "Show") + " screens panel"}
            aria-pressed={statesOpen}
            className="canvas-tool hidden shrink-0 lg:inline-flex"
            onClick={toggleScreensPanel}
            title={(statesOpen ? "Hide" : "Show") + " the screens panel (⌘\\ hides both panels)"}
            type="button"
          >
            <PanelLeftIcon />
          </button>
          <div className="flex min-w-0 items-center gap-1.5" title={metaParts.join(" · ")}>
            <span className="min-w-0 truncate text-[13px] font-semibold tracking-[-0.01em] text-foreground max-sm:sr-only lg:max-w-[150px] xl:max-w-[220px]">{metadata.handoffName}</span>
            <label className="sr-only" htmlFor="review-version-select">Version</label>
            <span className="relative inline-flex min-w-[5.5rem] shrink items-center">
              <select
                className="h-7 w-full min-w-0 max-w-[260px] appearance-none truncate xl:max-w-[340px] 2xl:max-w-[420px] rounded-[7px] border border-white/[0.08] bg-white/[0.03] bg-[length:12px] bg-[position:right_7px_center] py-0 pl-2 !pr-7 font-mono text-[11px] text-foreground-muted transition-colors hover:border-white/[0.16] hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                id="review-version-select"
                title={metadata.versions.find((version) => version.id === metadata.selectedVersionId)?.versionLabel}
                onChange={(event) => window.location.assign(metadata.versionHrefPrefix + "?versionId=" + encodeURIComponent(event.target.value))}
                value={metadata.selectedVersionId}
              >
                {metadata.versions.map((version, index) => (
                  <option key={version.id} value={version.id}>{`${/^\d/.test(version.versionLabel) ? "v" : ""}${version.versionLabel}${index === 0 ? " · latest" : ""}`}</option>
                ))}
              </select>
            </span>
            {canCompare ? (
              <button
                className="canvas-tool hidden h-7 shrink-0 border border-white/[0.08] sm:inline-flex"
                onClick={() => {
                  setCommentMode(false);
                  if (isMobile) setStatesOpen(false);
                  setSearchOpen(false);
                  onOpenComparison();
                }}
                title="Compare with the previous version"
                type="button"
              >
                <CompareIcon className="size-3.5" />
                <span>Compare</span>
              </button>
            ) : null}
            {metadata.canUseLocalPreview ? (
              <button
                className="canvas-tool hidden h-7 shrink-0 border border-white/[0.08] sm:inline-flex"
                onClick={() => {
                  setCommentMode(false);
                  setSearchOpen(false);
                  setLocalPreviewOpen(true);
                }}
                title="Compare a screen with your local or test build"
                type="button"
              >
                <svg aria-hidden="true" className="size-3.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" viewBox="0 0 16 16"><rect height="9" rx="1.5" width="12" x="2" y="2.5" /><path d="M6 14h4M8 11.5V14" /></svg>
                <span>Local preview</span>
              </button>
            ) : null}
          </div>
        </div>

        <div aria-hidden="true" className="hidden flex-1 lg:block" />

        <div className="flex shrink-0 items-center gap-1">
          {/* Rendered before the viewport is ready too, so the toolbar doesn't jump when it mounts. */}
          <CanvasToolbar
            scale={viewportControls?.scale ?? null}
            shareUrl={metadata.reviewHref}
            shareTitle={metadata.projectName + " · " + metadata.handoffName}
            sharingEndpoint={sharingEndpoint}
            publishEndpoint={sharingEndpoint ? `${sharingEndpoint}/publish` : null}
            publishVersionId={metadata.selectedVersionId}
            latestVersionId={metadata.versions[0]?.id ?? metadata.selectedVersionId}
            publishedVersionId={metadata.publishedVersionId}
            pendingChanges={pendingRemovals.length}
            onReviewChanges={() => setPublishDialogOpen(true)}
            onZoomOut={() => viewportControls?.zoomOut()}
            onFit={() => viewportControls?.fitToFrame()}
            onZoomIn={() => viewportControls?.zoomIn()}
          />
          <button
            aria-label={(detailsPanelVisible ? "Hide" : "Show") + " the details panel"}
            aria-pressed={detailsPanelVisible}
            className="canvas-tool"
            onClick={toggleDetailsPanel}
            title={(detailsPanelVisible ? "Hide" : "Show") + " the details panel (⌘\\ hides both panels)"}
            type="button"
          >
            <PanelRightIcon />
          </button>
          <div className="relative">
            <button aria-expanded={moreOpen} aria-label="More" className="canvas-tool" onClick={() => setMoreOpen((current) => !current)} title="More" type="button">
              <MoreIcon />
            </button>
            {moreOpen ? (
              <>
                <button aria-label="Close menu" className="fixed inset-0 z-40 cursor-default" onClick={() => setMoreOpen(false)} tabIndex={-1} type="button" />
                <div className="dial-popover absolute right-0 top-10 z-50 w-56 p-1.5" role="menu">
                  <button className="flex w-full items-center gap-2.5 rounded-[7px] px-2 py-2 text-left text-[12px] text-foreground hover:bg-white/[0.06]" onClick={() => { setMoreOpen(false); setShortcutsOpen(true); }} role="menuitem" type="button">
                    <KeyboardIcon className="size-4 text-foreground-subtle" />
                    <span className="flex-1">Keyboard shortcuts</span>
                    <kbd className="canvas-kbd">?</kbd>
                  </button>
                  {metadata.canManageIntegrations ? (
                    <button className="flex w-full items-center gap-2.5 rounded-[7px] px-2 py-2 text-left text-[12px] text-foreground hover:bg-white/[0.06]" onClick={() => { setMoreOpen(false); setPanelMode("mcp"); setCommentMode(false); setAnnotationMode(false); if (isMobile) { setStatesOpen(false); setMobilePanelOpenOverride(true); } }} role="menuitem" type="button">
                      <span aria-hidden="true" className="grid size-4 place-items-center font-mono text-[9px] text-foreground-subtle">AI</span>
                      <span className="flex-1">Connect an AI coding tool</span>
                    </button>
                  ) : null}
                  <div className="px-1 pt-1 [&>button]:w-full [&>button]:justify-start"><InstallAppButton compact /></div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </header>
      {shortcutsOpen ? <CanvasShortcuts onClose={() => setShortcutsOpen(false)} /> : null}
      {localPreviewOpen && metadata.canUseLocalPreview ? (
        <LocalPreviewOverlay
          workspaceId={workspaceId}
          handoffId={handoffId}
          frames={frames}
          selectedFrameId={selectedFrameId}
          onSelectFrame={selectFrame}
          onCommentOnScreen={commentOnScreen}
          onClose={closeLocalPreview}
        />
      ) : null}
      {publishDialogOpen && pendingRemovals.length ? (
        <PublishChangesDialog
          defaultVersionLabel={`${metadata.versions[0]?.versionLabel ?? metadata.versionLabel} · ${pendingRemovals.length === 1 ? "1 screen" : `${pendingRemovals.length} screens`} removed`}
          onClose={() => setPublishDialogOpen(false)}
          onKeep={toggleRemoval}
          onPublish={publishChanges}
          removedScreens={pendingRemovals.map((id) => ({ id, name: screens.find((frame) => frame.id === id)?.name ?? id }))}
        />
      ) : null}
      {newerPublished ? (
        <div className="flex min-h-10 items-center justify-between gap-3 border-b border-border bg-surface px-4 py-2 text-[12px] text-foreground-muted">
          <p className="flex min-w-0 items-center gap-2"><span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-warning" /><span className="truncate">You&apos;re viewing an older version. {newerPublished.versionId !== metadata.publishedVersionId ? "A newer version was just published" : "The published version is newer"}: <span className="font-medium text-foreground">{newerPublished.versionLabel}</span></span></p>
          <Link className="dial-button shrink-0 px-3 py-1.5 text-[12px]" href={metadata.versionHrefPrefix + "?versionId=" + encodeURIComponent(newerPublished.versionId)}>Open it</Link>
        </div>
      ) : null}
      {comparisonSummary && !summaryDismissed && (
        comparisonSummary.changed > 0 || comparisonSummary.added > 0 || comparisonSummary.removed > 0 ||
        comparisonSummary.onlyInAfterCapture > 0 || comparisonSummary.onlyInBeforeCapture > 0 || comparisonSummary.changeCount > 0
      ) ? (
        <div aria-live="polite" className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border bg-surface px-4 py-2 text-[12px] text-foreground-muted">
          {(() => {
            const added = comparisonSummary.added + comparisonSummary.onlyInAfterCapture;
            const removed = comparisonSummary.removed + comparisonSummary.onlyInBeforeCapture;
            const realChanges = [
              comparisonSummary.changed ? `${comparisonSummary.changed} screen${comparisonSummary.changed === 1 ? "" : "s"} changed` : "",
              added ? `${added} new` : "",
              removed ? `${removed} removed` : "",
            ].filter(Boolean);
            return (
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-x-2">
                  <span aria-hidden="true" className={"size-1.5 shrink-0 rounded-full " + (realChanges.length || comparisonSummary.changeCount ? "bg-warning" : "bg-foreground-subtle")} />
                  <span className="font-semibold text-foreground">{realChanges.length ? realChanges.join(" · ") : comparisonSummary.changeCount ? "Screens changed" : "No changes"}</span>
                  {comparisonSummary.changeCount ? <span>· {formatComparisonChangeCount(comparisonSummary.changeCount, comparisonSummary.visualChangeCount)}</span> : null}
                  <span>since {comparisonSummary.earlierVersionLabel}</span>
                </p>
              </div>
            );
          })()}
          <span className="flex shrink-0 items-center gap-1.5">
          {onOpenChangesList ? (
            <button className="dial-button shrink-0 px-3 py-1.5 text-[12px]" onClick={() => { setCommentMode(false); setSearchOpen(false); onOpenChangesList(); }} type="button">
              List view
            </button>
          ) : null}
          <span className="glow-ring shrink-0">
          <span aria-hidden="true" className="glow-ring-halo" />
          <span aria-hidden="true" className="glow-ring-spin" />
          <button
            className="capture-primary-action shrink-0 px-3 py-1.5 text-[12px]"
            onClick={() => {
              setCommentMode(false);
              if (isMobile) setStatesOpen(false);
              setSearchOpen(false);
              onOpenComparison();
            }}
            type="button"
          >
            Review changes
          </button>
          </span>
          <button
            aria-label="Hide this summary for this version"
            className="grid size-7 shrink-0 place-items-center rounded-[7px] text-foreground-subtle hover:bg-white/[0.06] hover:text-foreground"
            onClick={dismissSummary}
            title="Hide for this version (Compare in the toolbar still shows the changes)"
            type="button"
          >
            <svg aria-hidden="true" className="size-3.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" viewBox="0 0 16 16"><path d="m4 4 8 8M12 4l-8 8" /></svg>
          </button>
          </span>
        </div>
      ) : null}

      <div className={"relative grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)] overflow-hidden " + (statesOpen && detailsOpen ? "lg:grid-cols-[240px_minmax(0,1fr)_320px]" : statesOpen ? "lg:grid-cols-[240px_minmax(0,1fr)]" : detailsOpen ? "lg:grid-cols-[minmax(0,1fr)_320px]" : "lg:grid-cols-[minmax(0,1fr)]")}>
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
            className={"absolute inset-y-0 left-0 z-30 w-[min(260px,86vw)] shadow-2xl lg:static lg:z-auto lg:w-auto lg:shadow-none" + (layoutReady ? "" : " max-lg:hidden")}
            ref={screenPanelRef}
            role={isMobile && statesOpen ? "dialog" : undefined}
            tabIndex={isMobile ? -1 : undefined}
          >
            {isMobile ? (
              <div className="flex justify-end border-b border-border bg-surface px-2 py-1.5 lg:hidden">
                <button
                  aria-label="Close screens panel"
                  className="dial-button min-h-8 px-2.5 text-[11px]"
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
              <nav aria-label="Search screens" className="flex h-full min-h-0 min-w-0 flex-col border-r border-border bg-surface text-foreground-muted">
                <div className="shrink-0 space-y-3 border-b border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <button
                      className="rounded-control px-2 py-1 text-[11px] text-foreground-muted hover:bg-surface-raised hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                      onClick={closeSearchPanel}
                      type="button"
                    >
                      ← Screens
                    </button>
                    <span className="font-mono text-[10px] text-foreground-subtle">{searchQuery.trim() ? `${searchResults.length} found` : "Search"}</span>
                  </div>
                  <input
                    autoFocus
                    ref={searchInputRef}
                    aria-activedescendant={activeSearchIndex >= 0 ? `handoff-search-result-${activeSearchIndex}` : undefined}
                    aria-autocomplete="list"
                    aria-controls={searchResults.length ? "handoff-search-results" : undefined}
                    aria-expanded={Boolean(searchResults.length)}
                    aria-label="Search text, colors and elements"
                    className="h-9 w-full rounded-control border border-border bg-surface-muted px-2.5 text-[12px] text-foreground outline-none placeholder:text-foreground-muted focus:border-border-strong focus:bg-surface-raised focus:ring-2 focus:ring-foreground-subtle/40"
                    id="handoff-search-input"
                    onChange={(event) => {
                      setSearchQuery(event.target.value);
                      setActiveSearchIndex(-1);
                    }}
                    placeholder="Text, colors, elements"
                    role="combobox"
                    type="search"
                    value={searchQuery}
                  />
                  <div aria-label="Search categories" className="flex gap-1 overflow-x-auto" role="group">
                    {(["All", "Text", "Colors", "Elements"] as SearchCategory[]).map((category) => (
                      <button
                        aria-pressed={searchCategory === category}
                        className={"shrink-0 rounded-control px-2.5 py-1 text-[11px] " + (searchCategory === category ? "bg-surface-strong text-white" : "text-foreground-muted hover:bg-surface-raised hover:text-white")}
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
                            className={"cursor-pointer rounded-control px-3 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary " + (index === activeSearchIndex ? "bg-surface-strong text-white ring-1 ring-foreground-subtle" : "text-foreground hover:bg-surface-raised")}
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
                            <span className="mt-0.5 block truncate text-[11px] text-foreground-subtle">{result.frame.name} · {result.detail}</span>
                            <span className="mt-1 block text-[10px] text-foreground-subtle">{result.category}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p aria-live="polite" className="px-2 py-3 text-[11px] text-foreground-subtle">No matching text, colors, or elements.</p>
                    )
                  ) : (
                    <p className="px-2 py-3 text-[11px] leading-5 text-foreground-subtle">Search captured text, colors, element names, and types.</p>
                  )}
                  {searchResults.length ? (
                    <button className="dial-button mt-2 min-h-8 w-full text-[11px]" onClick={copySearchHighlights} type="button">
                      Highlight all on the canvas
                    </button>
                  ) : null}
                </div>
                <footer aria-live="polite" className="shrink-0 border-t border-border px-3 py-2.5 text-[10px] text-foreground-subtle">
                  {activeSearchIndex >= 0 ? `${activeSearchIndex + 1} of ${searchResults.length} selected · ` : ""}↑ ↓ preview · Enter inspect · Esc screens
                </footer>
              </nav>
            ) : (
              <FrameNavigator
                frames={frames}
                activeFrameId={selectedFrameId}
                onSelect={(frameId) => {
                  selectFrame(frameId);
                  focusScreen(frameId);
                }}
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
                removal={canRemoveScreens ? {
                  onReview: () => setPublishDialogOpen(true),
                  removing: removingScreen,
                  selecting: removalSelecting,
                  picked: removalPicked,
                  onSelectingChange: (value) => {
                    setRemovalSelecting(value);
                    if (value) {
                      setCommentMode(false);
                      setAnnotationMode(false);
                    }
                  },
                  onPickedChange: updateDraft,
                } : undefined}
              />
            )}
          </div>
        ) : null}
        <div className="relative col-start-1 row-start-1 flex h-full min-h-0 min-w-0 lg:col-auto lg:row-auto">
        {/* Figma-style floating bar: canvas tools, overlays and zoom, kept off the top nav. */}
        <div aria-label="Canvas tools" className="canvas-floatbar" role="toolbar">
          <button
            aria-pressed={statesOpen}
            className="canvas-tool shrink-0 lg:hidden"
            id="canvas-mobile-screens-toggle"
            onClick={toggleScreensPanel}
            title={(statesOpen ? "Hide" : "Show") + " the screens panel (⌘\\ hides both panels)"}
            type="button"
          >
            <PanelLeftIcon />
            <span className="sr-only">Screens</span><span className="font-mono text-[10px] text-foreground-subtle">{screens.length}</span>
          </button>
          <span aria-hidden="true" className="canvas-floatbar-divider lg:hidden" />
          <div aria-label="Canvas mode" className="canvas-toolgroup shrink-0" role="group">
            <button aria-pressed={canvasMode === "view" && !commentMode} className="canvas-tool" onClick={() => { setCommentMode(false); setCanvasModeOverride("view"); }} title="View: pan without selecting (V)" type="button">
              <HandIcon /><span className="sr-only">View</span>
            </button>
            <button aria-pressed={canvasMode === "inspect" && !commentMode} className="canvas-tool" onClick={() => { setCommentMode(false); setCanvasModeOverride("inspect"); setPanelMode("inspect"); }} title="Inspect: select elements (I)" type="button">
              <CursorIcon /><span className="sr-only">Inspect</span>
            </button>
            {metadata.canComment ? (
              <button
                aria-pressed={commentMode}
                className="canvas-tool"
                onClick={() => {
                  setAnnotationMode(false);
                  setPendingPoint(null);
                  setCommentThreadOpen(false);
                  setPanelMode("comments");
                  setCommentMode((current) => !current);
                }}
                title="Comment: click the canvas to place one (C)"
                type="button"
              >
                <CommentIcon /><span className="sr-only">Comment</span>
              </button>
            ) : null}
          </div>
          <span aria-hidden="true" className="canvas-floatbar-divider" />
          <div aria-label="Overlays" className="canvas-toolgroup shrink-0" role="group">
            <button
              aria-pressed={outlinesVisible}
              className="canvas-tool"
              onClick={() => {
                setCanvasModeOverride("inspect");
                setPanelMode("inspect");
                setOutlinesVisible((current) => !current);
              }}
              title="Outline every element (O)"
              type="button"
            >
              <OutlineIcon /><span className="max-xl:sr-only">Outlines</span>
            </button>
            <button
              aria-label="Toggle Figma layout grids"
              aria-pressed={layoutGridsVisible && hasLayoutGrids}
              className="canvas-tool"
              disabled={!hasLayoutGrids}
              onClick={() => setLayoutGridsVisible((current) => !current)}
              title={hasLayoutGrids ? "Layout grids (G)" : "No layout grids in this capture"}
              type="button"
            >
              <GridIcon /><span className="max-xl:sr-only">Grids</span>
            </button>
            {hasChangeHighlights ? (
              <button
                aria-pressed={showChanges}
                className="canvas-tool"
                onClick={() => setShowChanges((current) => !current)}
                title={`${showChanges ? "Hide" : "Show"} the highlights on what changed since ${comparisonSummary?.earlierVersionLabel ?? "the previous version"} (D)`}
                type="button"
              >
                <ChangesIcon /><span className="max-xl:sr-only">Changes</span>
                {changedNodeIds.length ? <span className="canvas-tool-count">{changedNodeIds.length}</span> : null}
              </button>
            ) : null}
          </div>
          <span aria-hidden="true" className="canvas-floatbar-divider" />
          <ZoomControls
            scale={viewportControls?.scale ?? null}
            onZoomOut={() => viewportControls?.zoomOut()}
            onFit={() => viewportControls?.fitToFrame()}
            onZoomIn={() => viewportControls?.zoomIn()}
          />
        </div>
        <CanvasViewport
          frame={visualFrame}
          overviewOrigin={{ sourceX: overviewFrame.sourceX, sourceY: overviewFrame.sourceY }}
          interactionMode={removalSelecting ? "view" : canvasMode}
          screens={canvasScreens}
          changedOnly={changedOnlyActive}
          selectedFrameId={selectedFrameId}
          frameStatuses={frameStatuses}
          canCompare={canCompare}
          onCompareScreen={compareFrame}
          outlinesVisible={outlinesVisible}
          layoutGridsVisible={layoutGridsVisible && hasLayoutGrids}
          highlightedNodeIds={highlightedNodeIds}
          changedNodeIds={showChanges ? changedNodeIds : []}
          changesVisible={showChanges}
          viewMemoryKey={`${handoffId}:${metadata.selectedVersionId}:${visualFrame.id}`}
          focusRequest={focusRequest}
          showResolvedPins={showResolvedPins}
          selectedNodeId={selectedNodeId}
          onSelectNode={selectNode}
          onSelectFrame={(frameId, event) => {
            // Shift-click (or select mode) picks screens for removal instead of opening them.
            if (canRemoveScreens && (removalSelecting || event?.shiftKey)) {
              toggleRemoval(frameId);
              return;
            }
            selectFrame(frameId);
          }}
          pickedFrameIds={canRemoveScreens ? new Set(pendingRemovals) : undefined}
          pickingFrames={removalSelecting}
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
          commentPopover={{
            pendingPoint: metadata.canComment ? pendingPoint : null,
            threadOpen: commentThreadOpen,
            canWrite: metadata.canComment,
            canResolve: metadata.canComment,
            onCreate: createComment,
            onReply: replyToComment,
            onResolve: resolveComment,
            onClose: () => {
              setPendingPoint(null);
              setCommentThreadOpen(false);
            },
          }}
          onViewportChange={setViewportControls}
        />
        </div>
        <aside
          aria-label="Handoff details"
          aria-modal={isMobile && mobilePanelOpen ? true : undefined}
          className={"min-h-0 min-w-0 flex-col overflow-hidden border-l border-border bg-surface " + (mobilePanelOpen ? "absolute inset-0 z-30 flex w-full border-l-0 shadow-2xl lg:static lg:z-auto lg:w-auto lg:border-l lg:shadow-none" : "hidden lg:static") + (detailsOpen ? " lg:flex" : " lg:hidden")}
          ref={detailsPanelRef}
          role={isMobile && mobilePanelOpen ? "dialog" : undefined}
          tabIndex={isMobile && mobilePanelOpen ? -1 : undefined}
        >
          {isMobile && mobilePanelOpen ? (
            <div className="flex shrink-0 justify-end border-b border-border px-2 py-1.5 lg:hidden">
              <button
                aria-label="Close details panel"
                className="dial-button min-h-8 px-2.5 text-[11px]"
                onClick={() => setMobilePanelOpenOverride(false)}
                type="button"
              >
                Close
              </button>
            </div>
          ) : null}
          <div className="canvas-tabs shrink-0" role="tablist" aria-label="Details panels">
            {([
              ["inspect", "Inspect", InspectIcon, null],
              ["comments", "Comments", CommentIcon, openCommentCount || null],
              ["annotations", "Notes", NoteIcon, annotations.length || null],
              ...(dockPanels.version ? [["version", "Versions", VersionIcon, null] as const] : []),
              ...(metadata.team ? [["info", "Info", InfoIcon, null] as const] : []),
            ] as const).map(([mode, label, TabIcon, count]) => (
              <button
                aria-selected={panelMode === mode}
                className="canvas-tab"
                key={mode}
                onClick={() => {
                  setPanelMode(mode);
                  setPanelMoreOpen(false);
                  setCommentMode(false);
                  setAnnotationMode(false);
                  if (mode === "inspect") setCanvasModeOverride("inspect");
                  if (isMobile) setMobilePanelOpenOverride(true);
                }}
                role="tab"
                type="button"
              >
                <TabIcon className="canvas-tab-icon size-3.5" />
                <span>{label}</span>
                {count ? <span className="canvas-tab-count">{count}</span> : null}
              </button>
            ))}
            {(() => {
              const extras = ([
                ["agent", "Agent handoff", Boolean(metadata.canManageIntegrations && metadata.reviewHref && metadata.versionIsPublished)],
                ["local", "Local preview", metadata.canUseLocalPreview && isMobile],
                ["mcp", "AI coding tool (MCP)", metadata.canManageIntegrations],
              ] as const).filter(([, , visible]) => visible);
              if (!extras.length) return null;
              const activeExtra = extras.find(([mode]) => mode !== "local" && mode === panelMode);
              return (
                <div className="relative ml-auto flex">
                  <button aria-expanded={panelMoreOpen} aria-label={activeExtra ? `${activeExtra[1]} (more panels)` : "More panels"} aria-selected={Boolean(activeExtra)} className="canvas-tab" onClick={() => setPanelMoreOpen((current) => !current)} role="tab" title={activeExtra ? activeExtra[1] : "More panels"} type="button">
                    <svg aria-hidden="true" className="size-4" fill="currentColor" viewBox="0 0 16 16"><circle cx="3.5" cy="8" r="1.25" /><circle cx="8" cy="8" r="1.25" /><circle cx="12.5" cy="8" r="1.25" /></svg>
                  </button>
                  {panelMoreOpen ? (
                    <>
                      <button aria-label="Close menu" className="fixed inset-0 z-40 cursor-default" onClick={() => setPanelMoreOpen(false)} tabIndex={-1} type="button" />
                      <div className="dial-popover absolute right-0 top-11 z-50 w-52 p-1.5" role="menu">
                        {extras.map(([mode, label]) => (
                          <button
                            className="flex w-full items-center rounded-[7px] px-2 py-2 text-left text-[12px] text-foreground hover:bg-white/[0.06]"
                            key={mode}
                            onClick={() => {
                              setPanelMoreOpen(false);
                              if (mode === "local") {
                                setLocalPreviewOpen(true);
                                return;
                              }
                              setPanelMode(mode);
                              setCommentMode(false);
                              setAnnotationMode(false);
                              if (isMobile) setMobilePanelOpenOverride(true);
                            }}
                            role="menuitem"
                            type="button"
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </>
                  ) : null}
                </div>
              );
            })()}
          </div>
          {panelMode === "annotations" ? (
            <CanvasAnnotationsPanel key={`${selectedAnnotationId ?? "new"}:${pendingAnnotationPoint?.frameId ?? ""}:${pendingAnnotationPoint?.x ?? ""}:${pendingAnnotationPoint?.y ?? ""}`} annotations={annotations} screenNames={{ [overviewCanvasFrameId]: "Canvas", ...Object.fromEntries(screens.map((screen) => [screen.id, screen.name])) }} selectedAnnotationId={selectedAnnotationId} pendingPoint={pendingAnnotationPoint} placing={annotationMode} canEdit={metadata.canAnnotate} hasSelectedScreen={Boolean(selectedFrame)} error={annotationError} onSelect={selectAnnotation} onStartPlacement={() => { setCommentMode(false); setSelectedAnnotationId(null); setPendingAnnotationPoint(null); setAnnotationMode(true); }} onPlaceAtSelectedScreen={annotateSelectedScreen} onCancel={() => { setAnnotationMode(false); setPendingAnnotationPoint(null); setSelectedAnnotationId(null); }} onCreate={createAnnotation} onUpdate={updateAnnotation} onDelete={deleteAnnotation} />
          ) : panelMode === "comments" ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-3" data-comment-list>
            <CommentThread
              comments={comments}
              frames={frames}
              pendingPoint={null}
              selectedCommentId={selectedCommentId}
              error={commentError}
              openCount={openCommentCount}
              canWrite={metadata.canComment}
              canResolve={metadata.canComment}
              commentIdentity={metadata.commentIdentity}
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
          ) : panelMode === "version" && dockPanels.version ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-3">{dockPanels.version}</div>
        ) : panelMode === "info" && metadata.team ? (
          <ProjectInfoPanel projectName={metadata.projectName} handoffName={metadata.handoffName} team={metadata.team} />
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
            integrationHref: `/integrations`,
            canManageIntegrations: metadata.canManageIntegrations,
            versions: metadata.versions,
            frames,
            initialFrameId: selectedFrameId,
            initialNodeId: selectedNodeId,
            frameNodes: frameDetails.nodesFor,
            ensureFrameNodes,
          }} />
        ) : panelMode === "inspect" ? (
          <ElementInspector
            frame={selectedFrame ?? overviewFrame}
            selectedNode={detailedSelectedNode}
            frameNodes={selectedFrameNodes}
            pendingNode={selectedNode && !detailedSelectedNode ? { name: selectedNode.name, type: selectedNode.type, detailStatus: frameDetails.statusFor(selectedNode.sourceFrameId) } : null}
            frameCount={screens.length}
            totalNodeCount={screens.reduce((count, frame) => count + frame.nodes.length, 0)}
            comments={selectedNode ? comments.filter((comment) => comment.sourceNodeId === selectedNode.sourceNodeId) : []}
            canComment={metadata.canComment}
            canCompare={canCompare}
            onCompare={compareSelectedFrame}
            onAddComment={commentOnSelectedElement}
            onSelectNode={selectNode}
            onCopyLink={() => navigator.clipboard?.writeText(window.location.href)}
            inspecting={canvasMode === "inspect"}
            onRemoveScreen={canRemoveScreens && selectedFrame?.kind === "frame" ? () => toggleRemoval(selectedFrame.id) : undefined}
            screenMarkedForRemoval={Boolean(selectedFrame && removalPicked.has(selectedFrame.id))}
            removingScreen={removingScreen}
          />
          ) : null}
        </aside>
      </div>
      {removalDialog}

    </div>
    </CommentMediaProvider>
  );
}
