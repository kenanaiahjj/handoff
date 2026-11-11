"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { SnapshotDiff } from "@/src/server/services/diff";
import { formatComparisonValue, formatPixelValue } from "./format-captured-measurement";
import {
  comparisonCategories,
  comparisonCategoryLabel,
  comparisonChangeLabel,
  countComparisonChangesByCategory,
  formatComparisonChangeCount,
  comparisonValueLabel,
  captureScopeNotice,
  captureCoverageAvailabilityLabel,
  comparisonFrameStatusLabel,
  groupComparisonChanges,
  separateSupplementalChanges,
  sourceIdentityNotice,
} from "./compare-presentation";
import { PixelDiffView } from "./PixelDiffView";
import {
  compareResultForPair,
  defaultCompareViewMode,
  preferredCompareFrameId,
  type CompareRouteState,
  type CompareViewMode,
} from "./compare-state";

export type VersionOption = {
  id: string;
  versionLabel: string;
  releaseNote: string | null;
  createdAt: string;
};

type Preview = {
  name: string;
  imageUrl: string;
  width: number | null;
  height: number | null;
  sourceWidth: number;
  sourceHeight: number;
  dimensionsSource: "design" | "image";
} | null;

export type CompareFrame = SnapshotDiff["frames"][number] & {
  before: Preview;
  after: Preview;
};

export type CompareResult = {
  diff: SnapshotDiff;
  frames: CompareFrame[];
};

type PairResultState = {
  fromVersionId: string;
  toVersionId: string;
  result: CompareResult | null;
  error: string | null;
};

type PairFrameSelection = {
  fromVersionId: string;
  toVersionId: string;
  frameId: string;
};

type PairViewPreference = {
  fromVersionId: string;
  toVersionId: string;
  mode: CompareViewMode;
};

type VersionCompareProps = {
  versions: VersionOption[];
  selectedVersionId: string;
  compareEndpointBase: string;
  initialRouteState: CompareRouteState | null;
  initialResult?: CompareResult | null;
  compareScreenRequest: { frameId: string; requestId: number } | null;
  onComparisonChange: (diff: SnapshotDiff | null, fromVersionId: string, toVersionId: string) => void;
  onComparisonFrameSelect: () => void;
  onRouteStateChange: (state: CompareRouteState) => void;
  onClose: () => void;
};

function defaultComparedVersions(versions: VersionOption[], selectedVersionId: string) {
  const chronological = [...versions].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const selectedIndex = chronological.findIndex((version) => version.id === selectedVersionId);
  if (selectedIndex < 0 || chronological.length < 2) {
    return { fromVersionId: selectedVersionId, toVersionId: selectedVersionId };
  }
  if (selectedIndex === 0) {
    return { fromVersionId: chronological[0].id, toVersionId: chronological[1].id };
  }
  return { fromVersionId: chronological[selectedIndex - 1].id, toVersionId: chronological[selectedIndex].id };
}

function versionLabel(versions: VersionOption[], id: string) {
  const version = versions.find((item) => item.id === id);
  return version ? "Version " + version.versionLabel : "Select a version";
}

export function VersionCompare({
  versions,
  selectedVersionId,
  compareEndpointBase,
  initialRouteState,
  initialResult = null,
  compareScreenRequest,
  onComparisonChange,
  onComparisonFrameSelect,
  onRouteStateChange,
  onClose,
}: VersionCompareProps) {
  const [defaultFromVersionId, defaultToVersionId] = useMemo(() => {
    const defaults = defaultComparedVersions(versions, selectedVersionId);
    return [defaults.fromVersionId, defaults.toVersionId] as const;
  }, [selectedVersionId, versions]);
  const validInitialRouteState = initialRouteState &&
    initialRouteState.fromVersionId !== initialRouteState.toVersionId &&
    versions.some((version) => version.id === initialRouteState.fromVersionId) &&
    versions.some((version) => version.id === initialRouteState.toVersionId)
    ? initialRouteState
    : null;
  const [toVersionId, setToVersionId] = useState(validInitialRouteState?.toVersionId ?? defaultToVersionId);
  const [fromVersionId, setFromVersionId] = useState(validInitialRouteState?.fromVersionId ?? defaultFromVersionId);
  const [pairResultState, setPairResultState] = useState<PairResultState | null>(null);
  const [pairFrameSelection, setPairFrameSelection] = useState<PairFrameSelection | null>(null);
  const [pairViewPreference, setPairViewPreference] = useState<PairViewPreference | null>(() =>
    validInitialRouteState?.mode
      ? { fromVersionId: validInitialRouteState.fromVersionId, toVersionId: validInitialRouteState.toVersionId, mode: validInitialRouteState.mode }
      : null,
  );
  const [overlayAmount, setOverlayAmount] = useState(50);
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const endpoint = useMemo(() =>
    compareEndpointBase + "?from=" + encodeURIComponent(fromVersionId) + "&to=" + encodeURIComponent(toVersionId),
  [compareEndpointBase, fromVersionId, toVersionId]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.focus();
    const focusableElements = () => Array.from(dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])',
    )).filter((element) => element.getClientRects().length > 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab") return;
      const focusable = focusableElements();
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === dialog || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  useEffect(() => {
    if (!fromVersionId || !toVersionId || fromVersionId === toVersionId) return;

    if (initialResult?.diff.fromVersionId === fromVersionId && initialResult.diff.toVersionId === toVersionId) {
      return;
    }

    const controller = new AbortController();
    fetch(endpoint, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as CompareResult | { error?: string };
        if (!response.ok || !("diff" in payload)) {
          throw new Error("error" in payload ? payload.error ?? "Could not load this comparison." : "Could not load this comparison.");
        }
        if (controller.signal.aborted) return;
        setPairResultState({ fromVersionId, toVersionId, result: payload, error: null });
        onComparisonChange(payload.diff, fromVersionId, toVersionId);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted || (cause instanceof DOMException && cause.name === "AbortError")) return;
        setPairResultState({
          fromVersionId,
          toVersionId,
          result: null,
          error: cause instanceof Error ? cause.message : "Could not load this comparison.",
        });
      });
    return () => controller.abort();
  }, [endpoint, fromVersionId, initialResult, onComparisonChange, toVersionId]);

  const pairResult = fromVersionId === toVersionId
    ? { result: null, error: null }
    : compareResultForPair(initialResult, pairResultState, fromVersionId, toVersionId);
  const currentResult = pairResult.result;
  const error = pairResult.error;
  const requestedFrameId = compareScreenRequest?.frameId ?? validInitialRouteState?.frameId ?? null;
  const preferredFrameId = pairFrameSelection?.fromVersionId === fromVersionId && pairFrameSelection.toVersionId === toVersionId
    ? pairFrameSelection.frameId
    : preferredCompareFrameId(currentResult);
  const focusedFrameId = requestedFrameId && currentResult?.frames.some((frame) => frame.frameId === requestedFrameId)
    ? requestedFrameId
    : preferredFrameId;
  const viewMode = pairViewPreference?.fromVersionId === fromVersionId && pairViewPreference.toVersionId === toVersionId
    ? pairViewPreference.mode
    : defaultCompareViewMode(currentResult);
  const activeFrame = currentResult?.frames.find((frame) => frame.frameId === focusedFrameId) ?? null;
  const loading = Boolean(
    versions.length >= 2 && fromVersionId && toVersionId && fromVersionId !== toVersionId &&
    !error && !currentResult,
  );
  const selectionError = versions.length >= 2 && fromVersionId === toVersionId ? "Choose two different versions." : null;
  const changesForFrame = currentResult?.diff.changes.filter((change) => change.frameId === focusedFrameId) ?? [];
  const changeGroupsForFrame = groupComparisonChanges(changesForFrame, activeFrame?.name ?? "Screen");
  const captureCoverage = currentResult?.diff.captureCoverage ?? [];
  const captureCoverageForFrame = captureCoverage.filter((difference) => difference.frameId === focusedFrameId);
  const captureCoverageFieldCount = new Set(captureCoverage.map((difference) => difference.path)).size;
  const captureCoverageFieldCountForFrame = new Set(captureCoverageForFrame.map((difference) => difference.path)).size;
  const selectedFrameCategoryCounts = currentResult
    ? countComparisonChangesByCategory(currentResult.diff.changes, focusedFrameId)
    : null;
  const categoryCounts = comparisonCategories.map((category) => ({
    category,
    count: selectedFrameCategoryCounts?.[category] ?? 0,
  }));
  const frameCounts = currentResult ? {
    changed: currentResult.diff.frames.filter((frame) => frame.status === "changed").length,
    added: currentResult.diff.frames.filter((frame) => frame.status === "added").length,
    removed: currentResult.diff.frames.filter((frame) => frame.status === "removed").length,
    onlyInAfterCapture: currentResult.diff.frames.filter((frame) => frame.status === "only-in-after-capture").length,
    onlyInBeforeCapture: currentResult.diff.frames.filter((frame) => frame.status === "only-in-before-capture").length,
  } : null;
  const frameSummary = frameCounts
    ? [
        frameCounts.changed ? frameCounts.changed + " screen" + (frameCounts.changed === 1 ? "" : "s") + " changed" : "",
        frameCounts.added ? frameCounts.added + " new" : "",
        frameCounts.removed ? frameCounts.removed + " removed" : "",
        frameCounts.onlyInAfterCapture ? frameCounts.onlyInAfterCapture + " screen" + (frameCounts.onlyInAfterCapture === 1 ? "" : "s") + " with no match in the before capture" : "",
        frameCounts.onlyInBeforeCapture ? frameCounts.onlyInBeforeCapture + " screen" + (frameCounts.onlyInBeforeCapture === 1 ? "" : "s") + " with no match in the after capture" : "",
      ].filter(Boolean).join(" · ") || "No screen changes"
    : "";
  const comparisonSummary = currentResult
    ? [
        frameSummary,
        formatComparisonChangeCount(
          currentResult.diff.changes.length,
          currentResult.diff.changes.filter((change) => change.category === "visual").length,
        ),
        captureCoverageFieldCount ? captureCoverageFieldCount + " capture fields available in only one version" : "",
      ].filter(Boolean).join(" · ")
    : "Version comparison";

  function updateToVersion(value: string) {
    let nextFromVersionId = fromVersionId;
    if (value === fromVersionId) {
      const replacement = versions.find((version) => version.id !== value);
      nextFromVersionId = replacement?.id ?? "";
    }
    setFromVersionId(nextFromVersionId);
    setToVersionId(value);
    setPairFrameSelection(null);
    onComparisonChange(null, nextFromVersionId, value);
    onRouteStateChange({ fromVersionId: nextFromVersionId, toVersionId: value, frameId: null, mode: null });
  }

  function updateFromVersion(value: string) {
    let nextToVersionId = toVersionId;
    if (value === toVersionId) {
      const replacement = versions.find((version) => version.id !== value);
      nextToVersionId = replacement?.id ?? "";
    }
    setFromVersionId(value);
    setToVersionId(nextToVersionId);
    setPairFrameSelection(null);
    onComparisonChange(null, value, nextToVersionId);
    onRouteStateChange({ fromVersionId: value, toVersionId: nextToVersionId, frameId: null, mode: null });
  }

  function selectComparedFrame(frameId: string) {
    setPairFrameSelection({ fromVersionId, toVersionId, frameId });
    onComparisonFrameSelect();
    onRouteStateChange({ fromVersionId, toVersionId, frameId, mode: viewMode });
  }

  const fromLabel = versionLabel(versions, fromVersionId);
  const toLabel = versionLabel(versions, toVersionId);
  const sourceIdentityMessage = currentResult ? sourceIdentityNotice(currentResult.diff.sourceIdentity) : null;
  const captureScopeMessage = currentResult ? captureScopeNotice(
    currentResult.diff.captureScopeComparison,
    currentResult.diff.frames.some((frame) => frame.status === "only-in-before-capture" || frame.status === "only-in-after-capture"),
  ) : null;

  return (
    <div className="fixed inset-0 z-[70] bg-[#111]/90 backdrop-blur-[2px]">
      <section
        aria-labelledby="compare-title"
        aria-modal="true"
        className="flex h-[100dvh] min-h-0 w-full flex-col bg-[#1d1d1d] text-[#e5e5e5]"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="flex min-h-[68px] shrink-0 flex-wrap items-center gap-x-5 gap-y-2 border-b border-[#3b3b3b] bg-[#202020] px-4 py-2.5 sm:px-6">
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-medium text-[#d4d4d4]" id="compare-title">{fromLabel} <span aria-hidden="true" className="px-1 text-[#999]">→</span> {toLabel}</p>
            <p aria-live="polite" className="mt-1 truncate text-[12px] text-[#949494]">
              {loading ? "Calculating the version diff…" : comparisonSummary}
            </p>
            {!loading && sourceIdentityMessage ? <p className="mt-1 text-[11px] text-[#d7b775]" role="status">{sourceIdentityMessage}</p> : null}
            {!loading && captureScopeMessage ? <p className="mt-1 text-[11px] leading-4 text-[#d7b775]" role="status">{captureScopeMessage}</p> : null}
          </div>
          <div aria-label="Comparison view" className="flex rounded-[7px] border border-[#414141] p-0.5" role="group">
            {([
              ["side-by-side", "Side by side"],
              ["overlay", "Overlay"],
              ["pixel-diff", "Pixel diff"],
            ] as const).map(([mode, label]) => (
              <button
                aria-pressed={viewMode === mode}
                className={"min-h-8 rounded-[5px] px-2.5 text-[12px] transition-colors sm:px-3 " + (viewMode === mode ? "bg-[#414141] text-white" : "text-[#aaa] hover:text-white")}
                key={mode}
                onClick={() => {
                  setPairViewPreference({ fromVersionId, toVersionId, mode });
                  onRouteStateChange({ fromVersionId, toVersionId, frameId: focusedFrameId || null, mode });
                }}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
          <button
            className="min-h-9 shrink-0 rounded-[6px] px-3 text-[12px] text-[#c9c9c9] hover:bg-[#333] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#aaa]"
            onClick={onClose}
            type="button"
          >
            Close <span className="ml-1 text-[#8c8c8c]">Esc</span>
          </button>
        </header>
        {versions.length < 2 ? (
          <div className="m-6 rounded-[8px] border border-[#3b3b3b] bg-[#242424] p-5 text-[13px] text-[#aaa]">Add another version to compare screen and layout changes.</div>
        ) : null}
        {error || selectionError ? <p aria-live="assertive" className="mx-4 mt-3 rounded-[6px] border border-[#7c5d37] bg-[#392c1d] p-3 text-[12px] text-[#f0c77b] sm:mx-6">{error ?? selectionError}</p> : null}

        {currentResult ? (
          <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[210px_minmax(0,1fr)_300px]">
            <nav aria-label="Compared screens" className="hidden min-h-0 overflow-y-auto border-r border-[#383838] bg-[#202020] px-2 py-3 lg:block">
              <div className="flex items-center justify-between px-2 pb-2">
                <h3 className="text-[12px] font-semibold text-[#bcbcbc]">Screens</h3>
                <span className="font-mono text-[11px] text-[#999]">{currentResult.frames.length}</span>
              </div>
              <ul className="space-y-0.5">
                {currentResult.frames.map((frame) => (
                  <li key={frame.sourceFileId + frame.frameId}>
                    <button
                      aria-pressed={frame.frameId === focusedFrameId}
                      className={"min-h-9 w-full rounded-[5px] px-2.5 py-2 text-left transition-colors " + (frame.frameId === focusedFrameId ? "bg-[#3a3a3a] text-white" : "text-[#aaa] hover:bg-[#2d2d2d] hover:text-white")}
                      data-compare-frame-id={frame.frameId}
                      onClick={() => selectComparedFrame(frame.frameId)}
                      type="button"
                    >
                      <span className="flex items-center justify-between gap-2 text-[12px]">
                        <span className="truncate">{frame.name}</span>
                        <span className="shrink-0 font-mono text-[10px] uppercase text-[#bdbdbd]">{comparisonFrameStatusLabel(frame.status)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </nav>

            <main className="flex min-h-0 min-w-0 flex-col overflow-hidden">
              <div className="shrink-0 border-b border-[#383838] px-4 py-3 sm:px-6">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-[14px] font-medium text-[#ededed]">{activeFrame?.name ?? "Select a screen"}</h2>
                    {activeFrame ? <p className="mt-0.5 text-[12px] text-[#929292]">{comparisonFrameStatusLabel(activeFrame.status)} · {changesForFrame.length} recorded {changesForFrame.length === 1 ? "change" : "changes"}</p> : null}
                  </div>
                  {categoryCounts.some((item) => item.count > 0) ? (
                    <div className="hidden flex-wrap justify-end gap-1.5 xl:flex">
                      {categoryCounts.filter((item) => item.count > 0).map((item) => (
                        <span className="rounded-[4px] bg-[#303030] px-2 py-1 font-mono text-[11px] text-[#aaa]" key={item.category}>{item.category} {item.count}</span>
                      ))}
                    </div>
                  ) : null}
                </div>
                {captureCoverageForFrame.length ? (
                  <details className="mt-2 rounded-[6px] border border-[#393939] bg-[#222] text-[12px]">
                    <summary className="cursor-pointer list-none px-3 py-2 text-[#c8c8c8]">
                      Capture coverage differs · {captureCoverageFieldCountForFrame} fields
                    </summary>
                    <div className="border-t border-[#383838] px-3 py-2.5">
                      <p className="text-[11px] leading-5 text-[#999]">
                        Raw source fields present in only one snapshot are listed here and excluded from design changes.
                      </p>
                      <ul className="mt-2 max-h-48 space-y-1.5 overflow-y-auto">
                        {captureCoverageForFrame.map((difference) => (
                          <li className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5" key={difference.path + difference.availableIn}>
                            <code className="break-all text-[11px] text-[#bdbdbd]">{difference.path}</code>
                            <span className="shrink-0 text-[11px] text-[#888]">
                              {captureCoverageAvailabilityLabel(difference.availableIn)} · {difference.nodeCount} {difference.nodeCount === 1 ? "layer" : "layers"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </details>
                ) : null}
                <div className="mt-3 flex gap-2 overflow-x-auto pb-0.5 lg:hidden" aria-label="Compared screens" role="group">
                  {currentResult.frames.map((frame) => (
                    <button
                      aria-label={`${frame.name}, ${comparisonFrameStatusLabel(frame.status)}`}
                      aria-pressed={frame.frameId === focusedFrameId}
                      className={"min-h-8 shrink-0 rounded-[5px] px-2.5 text-[12px] " + (frame.frameId === focusedFrameId ? "bg-[#414141] text-white" : "bg-[#292929] text-[#aaa]")}
                      data-compare-frame-id={frame.frameId}
                      key={frame.sourceFileId + frame.frameId}
                      onClick={() => selectComparedFrame(frame.frameId)}
                      type="button"
                    >
                      {frame.name}
                    </button>
                  ))}
                </div>
              </div>

              {activeFrame ? (
                <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-5 sm:py-4">
                  <div className="mb-3 grid grid-cols-2 gap-3">
                    <VersionSelect side="Before" value={fromVersionId} versions={versions} onChange={updateFromVersion} />
                    <VersionSelect side="After" value={toVersionId} versions={versions} onChange={updateToVersion} />
                  </div>

                  {viewMode === "side-by-side" ? (
                    <div className="grid items-start gap-3 md:grid-cols-2">
                      <PreviewPanel label="Before" preview={activeFrame.before} />
                      <PreviewPanel label="After" preview={activeFrame.after} />
                    </div>
                  ) : viewMode === "overlay" ? (
                    <div>
                      <div className="relative grid min-h-[360px] place-items-center overflow-hidden rounded-[8px] border border-[#393939] bg-[#171717] p-4 sm:min-h-[min(68vh,760px)]">
                        {activeFrame.before ? <PreviewImage alt={"Before: " + activeFrame.name} preview={activeFrame.before} className="pointer-events-none max-h-[min(68vh,760px)] w-full object-contain" /> : <p className="text-[12px] text-[#929292]">No earlier screen</p>}
                        {activeFrame.after ? <PreviewImage alt={"After: " + activeFrame.name} preview={activeFrame.after} className="pointer-events-none absolute inset-4 m-auto max-h-[min(68vh,760px)] w-[calc(100%-32px)] object-contain" style={{ opacity: overlayAmount / 100 }} /> : null}
                      </div>
                      <label className="mt-3 flex items-center gap-3 text-[12px] text-[#aaa]">
                        <span>Before</span>
                        <input aria-label="After image opacity" className="min-w-24 flex-1 accent-[#d7d7d7]" max="100" min="0" onChange={(event) => setOverlayAmount(Number(event.target.value))} type="range" value={overlayAmount} />
                        <span>After {overlayAmount}%</span>
                      </label>
                    </div>
                  ) : activeFrame.before && activeFrame.after ? (
                    <PixelDiffView key={activeFrame.before.imageUrl + activeFrame.after.imageUrl} before={activeFrame.before} after={activeFrame.after} />
                  ) : (
                    <p className="rounded-[6px] bg-[#252525] p-4 text-[12px] text-[#aaa]">Pixel diff needs a screen image in both versions.</p>
                  )}

                  <details className="mt-4 rounded-[6px] border border-[#393939] lg:hidden">
                    <summary className="cursor-pointer list-none px-3 py-3 text-[12px] font-medium text-[#c8c8c8]">
                      Changes on this screen <span className="ml-1 font-mono text-[#888]">{changesForFrame.length.toString().padStart(2, "0")}</span>
                    </summary>
                    {changesForFrame.length ? (
                      <RecordedChanges groups={changeGroupsForFrame} />
                    ) : <p className="px-3 pb-3 text-[12px] text-[#999]">No structured changes were captured for this screen.</p>}
                  </details>
                </div>
              ) : (
                <p className="m-5 rounded-[6px] bg-[#252525] p-4 text-[12px] text-[#aaa]">No matching screens were found in these versions.</p>
              )}
            </main>

            <aside aria-label="Comparison details" className="hidden min-h-0 flex-col overflow-y-auto border-l border-[#383838] bg-[#202020] lg:flex">
              <div className="flex items-center justify-between border-b border-[#383838] px-4 py-3">
                <h3 className="text-[12px] font-semibold text-[#c8c8c8]">Changes</h3>
                <span className="font-mono text-[11px] text-[#898989]">{changesForFrame.length.toString().padStart(2, "0")}</span>
              </div>
              {changesForFrame.length ? (
                <RecordedChanges groups={changeGroupsForFrame} />
              ) : <p className="p-4 text-[12px] text-[#999]">No structured changes were captured for this screen.</p>}
            </aside>
          </div>
        ) : loading ? (
          <p aria-live="polite" className="m-auto p-6 text-[13px] text-[#aaa]">Calculating the version diff…</p>
        ) : error || selectionError ? null : null}
      </section>
    </div>
  );
}

function rawChangeValue(value: unknown) {
  if (value === undefined) return "Not present";
  if (value === null) return "Unavailable";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function RecordedChanges({ groups }: { groups: ReturnType<typeof groupComparisonChanges> }) {
  return (
    <ul className="divide-y divide-[#383838] px-3 sm:px-4">
      {groups.map((group) => {
        const { visible, supplemental } = separateSupplementalChanges(group.changes);
        return (
          <li className="py-3" key={group.id}>
            <div className="flex items-baseline justify-between gap-2">
              <h4 className="min-w-0 truncate text-[12px] font-medium text-[#e0e0e0]" title={group.label}>{group.label}</h4>
              <span className="shrink-0 font-mono text-[10px] text-[#929292]">
                {visible.length ? `${visible.length} ${visible.length === 1 ? "change" : "changes"}` : ""}
                {visible.length && supplemental.length ? " · " : ""}
                {supplemental.length ? `${supplemental.length} capture fields` : ""}
              </span>
            </div>
            {visible.length ? (
              <ul className="mt-2 space-y-3">
                {visible.map((change, index) => (
                  <li className="border-l border-[#505050] pl-2.5" key={change.path + index}>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-[9px] uppercase tracking-[0.08em] text-[#929292]">{comparisonCategoryLabel(change.category)}</span>
                      <span className="text-[11px] text-[#d4d4d4]">{comparisonChangeLabel(change)}</span>
                    </div>
                    <div className="mt-1.5 grid grid-cols-[42px_minmax(0,1fr)] items-baseline gap-x-2 gap-y-1">
                      <span className="text-[10px] text-[#929292]">Before</span>
                      <p className="break-words font-mono text-[11px] leading-4 text-[#aaa]">{comparisonValueLabel(change, "before", formatComparisonValue)}</p>
                      <span className="text-[10px] text-[#929292]">After</span>
                      <p className="break-words font-mono text-[11px] leading-4 text-[#ededed]">{comparisonValueLabel(change, "after", formatComparisonValue)}</p>
                    </div>
                    <details className="mt-1.5 text-[10px] text-[#888]">
                      <summary className="w-fit cursor-pointer rounded-[3px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#aaa]">Captured source details</summary>
                      <div className="mt-1.5 max-h-40 space-y-1 overflow-auto rounded-[4px] bg-[#171717] p-2">
                        <p className="break-all font-mono">Path: {change.path}</p>
                        {group.sourceNodeId ? <p className="break-all font-mono">Layer ID: {group.sourceNodeId}</p> : null}
                        {change.path !== "node" ? (
                          <>
                            <p className="break-all font-mono">Before: {rawChangeValue(change.before)}</p>
                            <p className="break-all font-mono">After: {rawChangeValue(change.after)}</p>
                          </>
                        ) : null}
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            ) : null}
            {supplemental.length ? (
              <details className="mt-2 text-[10px] text-[#888]">
                <summary className="w-fit cursor-pointer rounded-[3px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#aaa]">Show captured paint data ({supplemental.length})</summary>
                <ul className="mt-1.5 max-h-40 space-y-2 overflow-auto rounded-[4px] bg-[#171717] p-2">
                  {supplemental.map((change, index) => (
                    <li className="space-y-1" key={change.path + index}>
                      <p className="break-all font-mono">{change.path}</p>
                      <p className="break-all font-mono">Before: {rawChangeValue(change.before)}</p>
                      <p className="break-all font-mono">After: {rawChangeValue(change.after)}</p>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function VersionSelect({
  side,
  value,
  versions,
  onChange,
  disabled = false,
}: {
  side: "Before" | "After";
  value: string;
  versions: VersionOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="grid min-w-0 gap-1.5 rounded-[6px] border border-[#3c3c3c] bg-[#222] p-2.5 text-[12px] text-[#aaa]">
      <span>{side} version</span>
      <select
        aria-label={side + " version"}
        className="min-h-9 w-full min-w-0 rounded-[5px] border border-[#414141] bg-[#303030] px-2 text-[12px] text-[#ececec] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#aaa]"
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {versions.map((version) => (
          <option key={version.id} value={version.id}>Version {version.versionLabel}</option>
        ))}
      </select>
    </label>
  );
}

function PreviewPanel({ label, preview }: { label: string; preview: Preview }) {
  const rasterSizeDiffers = preview !== null
    && preview.width !== null
    && preview.height !== null
    && (preview.width !== preview.sourceWidth || preview.height !== preview.sourceHeight);

  return (
    <section aria-label={label + " screen"} className="min-w-0">
      <div className="mb-2 flex items-center justify-between gap-2 text-[12px] text-[#aaa]">
        <span>{label}</span>
        {preview ? (
          <span className="flex flex-col items-end font-mono text-[10px] leading-4 text-[#888]">
            <span>{formatPixelValue(preview.sourceWidth)} × {formatPixelValue(preview.sourceHeight)} {preview.dimensionsSource === "design" ? "design px" : "image px"}</span>
            {preview.dimensionsSource === "design" && rasterSizeDiffers ? (
              <span>Raster export {preview.width} × {preview.height} px</span>
            ) : null}
          </span>
        ) : null}
      </div>
      <div className="grid min-h-[340px] place-items-center overflow-hidden rounded-[8px] border border-[#393939] bg-[#171717] p-3 sm:min-h-[min(68vh,760px)]">
        {preview ? <PreviewImage alt={label + ": " + preview.name} preview={preview} className="max-h-[min(68vh,760px)] w-full object-contain" /> : <p className="text-[12px] text-[#929292]">No screen in this version</p>}
      </div>
    </section>
  );
}

function PreviewImage({
  alt,
  preview,
  className,
  style,
}: {
  alt: string;
  preview: NonNullable<Preview>;
  className: string;
  style?: CSSProperties;
}) {
  return (
    <Image
      alt={alt}
      className={className}
      height={preview.height ?? 900}
      src={preview.imageUrl}
      style={style}
      unoptimized
      width={preview.width ?? 1280}
    />
  );
}
