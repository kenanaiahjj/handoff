"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SnapshotDiff } from "@/src/server/services/diff";
import { HandoffCanvas, type ReviewDockPanels, type ReviewMetadata } from "./HandoffCanvas";
import type { CanvasFrameChangeStatus, CanvasFrameOption, FrameComparisonSummary } from "./FrameNavigator";
import { VersionCompare, type CompareResult, type VersionOption } from "./VersionCompare";

type HandoffReviewProps = {
  frames: CanvasFrameOption[];
  commentsEndpoint: string;
  versions: VersionOption[];
  workspaceId: string;
  projectId: string;
  handoffId: string;
  selectedVersionId: string;
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
  metadata,
  dockPanels = {},
}: HandoffReviewProps) {
  const [comparison, setComparison] = useState<LoadedComparison | null>(null);
  const [initialCompareResult, setInitialCompareResult] = useState<CompareResult | null>(null);
  const [compareScreenRequest, setCompareScreenRequest] = useState<{ frameId: string; requestId: number } | null>(null);
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const openComparison = useCallback(() => setComparisonOpen(true), []);
  const closeComparison = useCallback(() => setComparisonOpen(false), []);

  const previousVersion = useMemo(() => {
    const chronological = [...versions].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const selectedIndex = chronological.findIndex((version) => version.id === selectedVersionId);
    return selectedIndex > 0 ? chronological[selectedIndex - 1] ?? null : null;
  }, [selectedVersionId, versions]);
  const visibleComparison = previousVersion ? comparison : null;
  const visibleInitialCompareResult = previousVersion ? initialCompareResult : null;

  useEffect(() => {
    if (!previousVersion) return;

    const controller = new AbortController();
    const endpoint = `/api/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/handoffs/${encodeURIComponent(handoffId)}/compare?from=${encodeURIComponent(previousVersion.id)}&to=${encodeURIComponent(selectedVersionId)}`;

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
  }, [handoffId, previousVersion, projectId, selectedVersionId, workspaceId]);

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
          workspaceId={workspaceId}
          projectId={projectId}
          handoffId={handoffId}
          selectedVersionId={selectedVersionId}
          initialResult={visibleInitialCompareResult}
          compareScreenRequest={compareScreenRequest}
          onComparisonChange={handleComparisonChange}
          onComparisonFrameSelect={handleComparisonFrameSelect}
          onClose={closeComparison}
        />
      ) : null}
    </main>
  );
}
