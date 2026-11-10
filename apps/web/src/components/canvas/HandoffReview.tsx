"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SnapshotDiff } from "@/src/server/services/diff";
import { HandoffCanvas, type ReviewDockPanels, type ReviewMetadata } from "./HandoffCanvas";
import type { CanvasFrameChangeStatus, CanvasFrameOption, FrameComparisonSummary } from "./FrameNavigator";
import { VersionCompare, type CompareResult, type VersionOption } from "./VersionCompare";
import { updateCompareRouteUrl, type CompareRouteState } from "./compare-state";

type HandoffReviewProps = {
  frames: CanvasFrameOption[];
  commentsEndpoint: string;
  versions: VersionOption[];
  workspaceId: string;
  projectId: string;
  handoffId: string;
  selectedVersionId: string;
  initialCompareRouteState: CompareRouteState | null;
  compareEndpointBase: string;
  canConfirmFrameMatches: boolean;
  visualOnly: boolean;
  metadata: ReviewMetadata;
  dockPanels?: ReviewDockPanels;
};

type LoadedComparison = {
  diff: SnapshotDiff;
  fromVersionId: string;
  toVersionId: string;
};

export function HandoffReview({
  frames,
  commentsEndpoint,
  versions,
  workspaceId,
  projectId,
  handoffId,
  selectedVersionId,
  initialCompareRouteState,
  compareEndpointBase,
  canConfirmFrameMatches,
  metadata,
  dockPanels = {},
}: HandoffReviewProps) {
  const [comparison, setComparison] = useState<LoadedComparison | null>(null);
  const [initialCompareResult, setInitialCompareResult] = useState<CompareResult | null>(null);
  const [compareScreenRequest, setCompareScreenRequest] = useState<{ frameId: string; requestId: number } | null>(null);
  const [comparisonOpen, setComparisonOpen] = useState(Boolean(initialCompareRouteState));
  const [compareRouteState, setCompareRouteState] = useState<CompareRouteState | null>(initialCompareRouteState);

  const previousVersion = useMemo(() => {
    const chronological = [...versions].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const selectedIndex = chronological.findIndex((version) => version.id === selectedVersionId);
    return selectedIndex > 0 ? chronological[selectedIndex - 1] ?? null : null;
  }, [selectedVersionId, versions]);

  const writeCompareRouteState = useCallback((state: CompareRouteState | null) => {
    window.history.replaceState(null, "", updateCompareRouteUrl(window.location.href, state));
    setCompareRouteState(state);
  }, []);

  const openComparison = useCallback((frameId?: string) => {
    const chronological = [...versions].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const selectedIndex = chronological.findIndex((version) => version.id === selectedVersionId);
    const fromVersion = selectedIndex > 0 ? chronological[selectedIndex - 1] : chronological[0];
    const toVersion = selectedIndex > 0 ? chronological[selectedIndex] : chronological[1];
    if (!fromVersion || !toVersion || fromVersion.id === toVersion.id) return;
    setComparisonOpen(true);
    writeCompareRouteState({
      fromVersionId: fromVersion.id,
      toVersionId: toVersion.id,
      frameId: frameId ?? null,
      mode: null,
    });
  }, [selectedVersionId, versions, writeCompareRouteState]);

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

  return (
    <main className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#202020] text-[#dedede]">
      <HandoffCanvas
        frames={frames}
        commentsEndpoint={commentsEndpoint}
          workspaceId={workspaceId}
          projectId={projectId}
          handoffId={handoffId}
        frameStatuses={frameStatuses}
        comparisonSummary={comparisonSummary}
        canCompare={versions.length > 1}
        onCompareScreen={handleCompareScreen}
        onOpenComparison={openComparison}
        comparisonOpen={comparisonOpen}
        metadata={metadata}
        dockPanels={dockPanels}
      />
      {comparisonOpen ? (
        <VersionCompare
          key={selectedVersionId}
          versions={versions}
          selectedVersionId={selectedVersionId}
          compareEndpointBase={compareEndpointBase}
          canConfirmFrameMatches={canConfirmFrameMatches}
          initialRouteState={compareRouteState}
          initialResult={visibleInitialCompareResult}
          compareScreenRequest={compareScreenRequest}
          onComparisonChange={handleComparisonChange}
          onComparisonFrameSelect={handleComparisonFrameSelect}
          onRouteStateChange={handleCompareRouteStateChange}
          onClose={closeComparison}
        />
      ) : null}
    </main>
  );
}
