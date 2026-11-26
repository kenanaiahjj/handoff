"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SnapshotDiff } from "@/src/server/services/diff";
import { HandoffCanvas, type ReviewDockPanels, type ReviewMetadata } from "./HandoffCanvas";
import type { CanvasFrameChangeStatus, CanvasFrameOption, FrameComparisonSummary } from "./FrameNavigator";
import { VersionCompare, type CompareResult, type VersionOption } from "./VersionCompare";
import { updateCompareRouteUrl, type CompareRouteState } from "./compare-state";
import { ChangesListView } from "./ChangesListView";
import { unpackCanvasNodes, type PackedCanvasNode } from "./canvas-node-summary";

/** A screen as the server sends it: element summaries packed (see packCanvasNodes). */
export type PackedCanvasFrameOption = Omit<CanvasFrameOption, "nodes"> & { packedNodes: PackedCanvasNode[] };

type HandoffReviewProps = {
  frames: PackedCanvasFrameOption[];
  commentsEndpoint: string;
  versions: VersionOption[];
  workspaceId: string;
  projectId: string;
  handoffId: string;
  selectedVersionId: string;
  initialCompareRouteState: CompareRouteState | null;
  compareEndpointBase: string;
  visualOnly: boolean;
  metadata: ReviewMetadata;
  dockPanels?: ReviewDockPanels;
  /** Records the version this person opened; null where nobody is signed in (public links). */
  seenEndpoint?: string | null;
};

type LoadedComparison = {
  diff: SnapshotDiff;
  fromVersionId: string;
  toVersionId: string;
};

export function HandoffReview({
  frames: packedFrames,
  commentsEndpoint,
  versions,
  workspaceId,
  projectId,
  handoffId,
  selectedVersionId,
  initialCompareRouteState,
  compareEndpointBase,
  metadata,
  dockPanels = {},
  seenEndpoint = null,
}: HandoffReviewProps) {
  // Unpacked once per version; the objects match what the server used to send field for field.
  const frames = useMemo<CanvasFrameOption[]>(
    () => packedFrames.map(({ packedNodes, ...frame }) => ({ ...frame, nodes: unpackCanvasNodes(packedNodes, frame.id) })),
    [packedFrames],
  );
  const [comparison, setComparison] = useState<LoadedComparison | null>(null);
  const [initialCompareResult, setInitialCompareResult] = useState<CompareResult | null>(null);
  const [compareScreenRequest, setCompareScreenRequest] = useState<{ frameId: string; requestId: number } | null>(null);
  const [comparisonOpen, setComparisonOpen] = useState(Boolean(initialCompareRouteState));
  const [compareRouteState, setCompareRouteState] = useState<CompareRouteState | null>(initialCompareRouteState);

  const versionBefore = useMemo(() => {
    const chronological = [...versions].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const selectedIndex = chronological.findIndex((version) => version.id === selectedVersionId);
    return selectedIndex > 0 ? chronological[selectedIndex - 1] ?? null : null;
  }, [selectedVersionId, versions]);

  // "Changed since you last looked": opening the newest version records it, and returns the version
  // this person had open on their previous visit. When that is older than the version just before
  // this one, the canvas compares with it instead, so everything new to them is highlighted.
  const [seenBaselineId, setSeenBaselineId] = useState<string | null>(null);
  const [sinceLastVisit, setSinceLastVisit] = useState(true);
  const newestVersionId = useMemo(
    () => [...versions].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]?.id ?? null,
    [versions],
  );
  useEffect(() => {
    if (!seenEndpoint || selectedVersionId !== newestVersionId) return;
    const controller = new AbortController();
    fetch(seenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionId: selectedVersionId }),
      signal: controller.signal,
    })
      .then(async (response) => response.ok ? (await response.json() as { baselineVersionId?: string | null }).baselineVersionId ?? null : null)
      .then((baselineVersionId) => setSeenBaselineId(baselineVersionId))
      .catch(() => undefined);
    return () => controller.abort();
  }, [newestVersionId, seenEndpoint, selectedVersionId]);
  const lastVisitVersion = useMemo(() => {
    const seen = seenBaselineId ? versions.find((version) => version.id === seenBaselineId) : null;
    const selected = versions.find((version) => version.id === selectedVersionId);
    if (!seen || !selected || !versionBefore || seen.id === versionBefore.id) return null;
    return seen.createdAt < versionBefore.createdAt ? seen : null;
  }, [seenBaselineId, selectedVersionId, versionBefore, versions]);
  const previousVersion = sinceLastVisit && lastVisitVersion ? lastVisitVersion : versionBefore;
  const baselineChoice = lastVisitVersion && versionBefore ? {
    sinceLastVisit,
    lastVisitLabel: lastVisitVersion.versionLabel,
    previousLabel: versionBefore.versionLabel,
    onToggle: () => setSinceLastVisit((current) => !current),
  } : null;

  const writeCompareRouteState = useCallback((state: CompareRouteState | null) => {
    window.history.replaceState(null, "", updateCompareRouteUrl(window.location.href, state));
    setCompareRouteState(state);
  }, []);

  const openComparison = useCallback((frameId?: string) => {
    const chronological = [...versions].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const selectedIndex = chronological.findIndex((version) => version.id === selectedVersionId);
    const fromVersion = selectedIndex > 0 ? previousVersion ?? chronological[selectedIndex - 1] : chronological[0];
    const toVersion = selectedIndex > 0 ? chronological[selectedIndex] : chronological[1];
    if (!fromVersion || !toVersion || fromVersion.id === toVersion.id) return;
    setComparisonOpen(true);
    writeCompareRouteState({
      fromVersionId: fromVersion.id,
      toVersionId: toVersion.id,
      frameId: frameId ?? null,
      mode: null,
    });
  }, [previousVersion, selectedVersionId, versions, writeCompareRouteState]);

  const closeComparison = useCallback(() => {
    const url = new URL(updateCompareRouteUrl(window.location.href, null));
    const nextVersionId = compareRouteState?.toVersionId ?? selectedVersionId;
    url.searchParams.set("versionId", nextVersionId);
    if (nextVersionId !== selectedVersionId) {
      window.location.assign(url.toString());
      return;
    }
    window.history.replaceState(null, "", url.toString());
    setCompareRouteState(null);
    setComparisonOpen(false);
  }, [compareRouteState, selectedVersionId]);

  const handleCompareRouteStateChange = useCallback((state: CompareRouteState) => {
    writeCompareRouteState(state);
  }, [writeCompareRouteState]);

  const visibleComparison = previousVersion ? comparison : null;
  const visibleInitialCompareResult = previousVersion ? initialCompareResult : null;

  useEffect(() => {
    if (!previousVersion) return;

    const controller = new AbortController();
    const endpoint = `${compareEndpointBase}?from=${encodeURIComponent(previousVersion.id)}&to=${encodeURIComponent(selectedVersionId)}`;

    fetch(endpoint, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as CompareResult | { error?: string };
        if (!response.ok || !("diff" in payload) || !("frames" in payload)) {
          throw new Error("error" in payload ? payload.error ?? "Could not load this comparison." : "Could not load this comparison.");
        }
        setInitialCompareResult(payload);
        setComparison({
          diff: payload.diff,
          fromVersionId: previousVersion.id,
          toVersionId: selectedVersionId,
        });
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setComparison(null);
        setInitialCompareResult(null);
      });

    return () => controller.abort();
  }, [compareEndpointBase, previousVersion, selectedVersionId]);

  const frameStatuses = useMemo<Record<string, CanvasFrameChangeStatus>>(() => Object.fromEntries(
    (visibleComparison?.toVersionId === selectedVersionId ? visibleComparison.diff.frames : []).map((frame) => [frame.frameId, frame.status]),
  ), [selectedVersionId, visibleComparison]);

  // Elements that changed in this version, outlined on the canvas.
  const changedNodeIds = useMemo(() => {
    if (!visibleComparison || visibleComparison.toVersionId !== selectedVersionId) return [];
    return [...new Set(visibleComparison.diff.changes.flatMap((change) => change.sourceNodeId ? [change.sourceNodeId] : []))];
  }, [selectedVersionId, visibleComparison]);

  const changeHighlightBoundsByFrame = useMemo<Record<string, Array<{ x: number; y: number; width: number; height: number }>>>(() => {
    if (!visibleComparison || visibleComparison.toVersionId !== selectedVersionId) return {};

    const changedNodeIdsByFrame = new Map<string, Set<string>>();
    for (const change of visibleComparison.diff.changes) {
      if (!change.sourceNodeId) continue;
      const nodeIds = changedNodeIdsByFrame.get(change.frameId) ?? new Set<string>();
      nodeIds.add(change.sourceNodeId);
      changedNodeIdsByFrame.set(change.frameId, nodeIds);
    }

    const boundsByFrame: Record<string, Array<{ x: number; y: number; width: number; height: number }>> = {};
    for (const [frameId, nodeIds] of changedNodeIdsByFrame) {
      const frame = frames.find((candidate) => candidate.id === frameId);
      if (!frame) continue;

      const rects = frame.nodes.flatMap((node) => {
        if (!nodeIds.has(node.sourceNodeId)) return [];
        const { x, y, width, height } = node.bounds;
        const left = x.value;
        const top = y.value;
        const rectWidth = width.value;
        const rectHeight = height.value;
        if (
          typeof left !== "number" || !Number.isFinite(left) ||
          typeof top !== "number" || !Number.isFinite(top) ||
          typeof rectWidth !== "number" || !Number.isFinite(rectWidth) || rectWidth <= 0 ||
          typeof rectHeight !== "number" || !Number.isFinite(rectHeight) || rectHeight <= 0
        ) return [];
        return [{
          x: left - (frame.kind === "overview" ? frame.sourceX : 0),
          y: top - (frame.kind === "overview" ? frame.sourceY : 0),
          width: rectWidth,
          height: rectHeight,
        }];
      });
      if (rects.length) boundsByFrame[frameId] = rects;
    }
    return boundsByFrame;
  }, [frames, selectedVersionId, visibleComparison]);

  const versionChanges = useMemo(
    () => visibleComparison && visibleComparison.toVersionId === selectedVersionId ? visibleComparison.diff.changes : [],
    [selectedVersionId, visibleComparison],
  );

  const comparisonSummary = useMemo<FrameComparisonSummary | null>(() => {
    if (!visibleComparison || visibleComparison.toVersionId !== selectedVersionId) return null;
    const earlierVersionLabel = versions.find((version) => version.id === visibleComparison.fromVersionId)?.versionLabel ?? "the earlier version";
    return {
      earlierVersionLabel,
      changed: visibleComparison.diff.frames.filter((frame) => frame.status === "changed").length,
      added: visibleComparison.diff.frames.filter((frame) => frame.status === "added").length,
      removed: visibleComparison.diff.frames.filter((frame) => frame.status === "removed").length,
      onlyInAfterCapture: visibleComparison.diff.frames.filter((frame) => frame.status === "only-in-after-capture").length,
      onlyInBeforeCapture: visibleComparison.diff.frames.filter((frame) => frame.status === "only-in-before-capture").length,
      changeCount: visibleComparison.diff.changes.length,
      visualChangeCount: visibleComparison.diff.changes.filter((change) => change.category === "visual").length,
    };
  }, [selectedVersionId, versions, visibleComparison]);

  const handleComparisonChange = useCallback((diff: SnapshotDiff | null, fromVersionId: string, toVersionId: string) => {
    if (!diff || toVersionId !== selectedVersionId) {
      setComparison(null);
      setInitialCompareResult((current) => current?.diff.fromVersionId === fromVersionId && current.diff.toVersionId === toVersionId ? current : null);
      return;
    }
    setComparison({ diff, fromVersionId, toVersionId });
    setInitialCompareResult((current) => current?.diff.fromVersionId === fromVersionId && current.diff.toVersionId === toVersionId ? current : null);
  }, [selectedVersionId]);

  const handleCompareScreen = useCallback((frameId: string) => {
    setCompareScreenRequest((current) => ({ frameId, requestId: (current?.requestId ?? 0) + 1 }));
  }, []);

  const handleComparisonFrameSelect = useCallback(() => {
    setCompareScreenRequest(null);
  }, []);

  const [changesListOpen, setChangesListOpen] = useState(false);
  const closeChangesList = useCallback(() => setChangesListOpen(false), []);
  const compareFromList = useCallback((frameId: string) => {
    setChangesListOpen(false);
    handleCompareScreen(frameId);
    openComparison(frameId);
  }, [handleCompareScreen, openComparison]);

  return (
    <main className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface text-foreground">
      <HandoffCanvas
        frames={frames}
        commentsEndpoint={commentsEndpoint}
          workspaceId={workspaceId}
          projectId={projectId}
          handoffId={handoffId}
        frameStatuses={frameStatuses}
        comparisonSummary={comparisonSummary}
        changedNodeIds={changedNodeIds}
        versionChanges={versionChanges}
        startChangedOnly={Boolean(initialCompareRouteState)}
        canCompare={versions.length > 1}
        onCompareScreen={handleCompareScreen}
        onOpenComparison={openComparison}
        onOpenChangesList={previousVersion ? () => setChangesListOpen(true) : undefined}
        comparisonOpen={comparisonOpen}
        baselineChoice={baselineChoice}
        metadata={metadata}
        dockPanels={dockPanels}
      />
      {changesListOpen && previousVersion ? (
        <ChangesListView
          fromLabel={previousVersion.versionLabel}
          onClose={closeChangesList}
          onCompareScreen={compareFromList}
          result={visibleInitialCompareResult}
          toLabel={versions.find((version) => version.id === selectedVersionId)?.versionLabel ?? ""}
        />
      ) : null}
      {comparisonOpen ? (
        <VersionCompare
          key={selectedVersionId}
          versions={versions}
          selectedVersionId={selectedVersionId}
          compareEndpointBase={compareEndpointBase}
          initialRouteState={compareRouteState}
          initialResult={visibleInitialCompareResult}
          compareScreenRequest={compareScreenRequest}
          changeHighlightBoundsByFrame={changeHighlightBoundsByFrame}
          onComparisonChange={handleComparisonChange}
          onComparisonFrameSelect={handleComparisonFrameSelect}
          onRouteStateChange={handleCompareRouteStateChange}
          onClose={closeComparison}
        />
      ) : null}
    </main>
  );
}
