"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { comparisonFrameStatusLabel } from "./compare-presentation";
import { fitView, ZoomControls, ZoomPane, type ZoomView } from "./SyncedZoom";
import type { CompareFrame, CompareResult } from "./VersionCompare";

type ChangeFilter = "all" | "changed" | "added" | "removed";

const filterLabels: Record<ChangeFilter, string> = { all: "All", changed: "Changed", added: "New", removed: "Removed" };

const statusTone: Record<string, string> = {
  changed: "bg-warning/15 text-warning",
  added: "bg-success/15 text-success",
  removed: "bg-danger/15 text-danger",
};

function ScreenImage({ preview, label, missing, view, onViewChange }: {
  preview: CompareFrame["before"];
  label: string;
  missing: string;
  view: ZoomView;
  onViewChange: (update: (view: ZoomView) => ZoomView) => void;
}) {
  return (
    <figure className="min-w-0">
      <figcaption className="mb-2 text-[12px] font-medium text-foreground-subtle">{label}</figcaption>
      <div data-zoom-pane="">
        <ZoomPane className="review-dot-grid h-[min(60vh,520px)] min-h-48 rounded-control" onViewChange={onViewChange} view={view}>
          <div className="flex h-full w-full items-center justify-center p-3">
            {preview ? (
              <Image
                alt={`${label}: ${preview.name}`}
                className="pointer-events-none h-full min-h-0 w-full min-w-0 select-none object-contain drop-shadow-lg"
                draggable={false}
                height={preview.height ?? preview.sourceHeight}
                loading="lazy"
                src={preview.imageUrl}
                unoptimized
                width={preview.width ?? preview.sourceWidth}
              />
            ) : (
              <p className="text-[12px] text-foreground-subtle">{missing}</p>
            )}
          </div>
        </ZoomPane>
      </div>
    </figure>
  );
}

/** Before and after for one screen. Both panes share one zoom, so the same spot stays lined up. */
function ScreenPair({ frame }: { frame: CompareFrame }) {
  const [view, setView] = useState<ZoomView>(fitView);
  const pairRef = useRef<HTMLDivElement>(null);
  return (
    <>
      <div className="mt-3 flex items-center justify-end gap-2">
        <span className="hidden text-[11px] text-foreground-subtle sm:inline">Ctrl/⌘ + scroll or pinch to zoom · drag to pan · double-click to zoom in or reset</span>
        <ZoomControls
          onViewChange={setView}
          paneSize={() => {
            const rect = pairRef.current?.querySelector("[data-zoom-pane]")?.getBoundingClientRect();
            return rect ? { width: rect.width, height: rect.height } : null;
          }}
          view={view}
        />
      </div>
      <div className="mt-2 grid gap-4 md:grid-cols-2" ref={pairRef}>
        <ScreenImage label="Before" missing="Not in the earlier version" onViewChange={setView} preview={frame.before} view={view} />
        <ScreenImage label="After" missing="Removed in this version" onViewChange={setView} preview={frame.after} view={view} />
      </div>
    </>
  );
}

/**
 * A scrollable list of only the screens that changed between two versions, each with its
 * before and after render side by side. An alternative to finding changes on the canvas.
 */
export function ChangesListView({
  result,
  fromLabel,
  toLabel,
  onCompareScreen,
  onClose,
}: {
  result: CompareResult | null;
  fromLabel: string;
  toLabel: string;
  onCompareScreen: (frameId: string) => void;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState<ChangeFilter>("all");

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const changesByFrame = useMemo(() => {
    const map = new Map<string, { count: number; categories: Set<string> }>();
    for (const change of result?.diff.changes ?? []) {
      const entry = map.get(change.frameId) ?? { count: 0, categories: new Set<string>() };
      entry.count += 1;
      entry.categories.add(change.category);
      map.set(change.frameId, entry);
    }
    return map;
  }, [result]);

  const changedFrames = useMemo(
    () => (result?.frames ?? []).filter((frame) => frame.status === "changed" || frame.status === "added" || frame.status === "removed"),
    [result],
  );
  const counts = {
    all: changedFrames.length,
    changed: changedFrames.filter((frame) => frame.status === "changed").length,
    added: changedFrames.filter((frame) => frame.status === "added").length,
    removed: changedFrames.filter((frame) => frame.status === "removed").length,
  };
  const visibleFrames = filter === "all" ? changedFrames : changedFrames.filter((frame) => frame.status === filter);

  return (
    <div aria-labelledby="changes-list-title" aria-modal="true" className="fixed inset-0 z-40 flex flex-col bg-background text-foreground" role="dialog">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-surface px-4 py-3 sm:px-6">
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold" id="changes-list-title">Changes</h2>
          <p className="mt-0.5 truncate text-[12px] text-foreground-subtle">
            Version {fromLabel} → {toLabel} · {counts.changed} changed · {counts.added} new · {counts.removed} removed
          </p>
        </div>
        <div aria-label="Filter changes" className="dial-segmented" role="group">
          {(Object.keys(filterLabels) as ChangeFilter[]).map((key) => (
            <button aria-pressed={filter === key} className="min-h-8 px-2.5 text-[12px]" key={key} onClick={() => setFilter(key)} type="button">
              {filterLabels[key]} <span className="ml-0.5 font-mono text-[11px] text-foreground-subtle">{counts[key]}</span>
            </button>
          ))}
        </div>
        <button className="dial-button min-h-8 px-3 text-[12px]" onClick={onClose} type="button">
          Close <kbd className="touch-hidden font-mono text-[10px] text-foreground-subtle">Esc</kbd>
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-6 sm:px-6">
          {!result ? (
            <p className="py-16 text-center text-[13px] text-foreground-subtle" role="status">Loading changes…</p>
          ) : !visibleFrames.length ? (
            <p className="py-16 text-center text-[13px] text-foreground-subtle">
              {changedFrames.length ? "No screens match this filter." : `No screens changed between version ${fromLabel} and ${toLabel}.`}
            </p>
          ) : visibleFrames.map((frame) => {
            const changes = changesByFrame.get(frame.frameId);
            return (
              <article className="rounded-panel border border-border bg-surface p-4 shadow-[var(--shadow-panel)]" key={frame.frameId}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <h3 className="min-w-0 flex-1 truncate text-[14px] font-semibold" title={frame.name}>{frame.name}</h3>
                  <span className={"rounded-chip px-2 py-0.5 text-[11px] font-semibold " + (statusTone[frame.status] ?? "bg-surface-inset text-foreground-muted")}>
                    {comparisonFrameStatusLabel(frame.status)}
                  </span>
                  {changes ? (
                    <span className="text-[12px] text-foreground-subtle">
                      {changes.count} {changes.count === 1 ? "change" : "changes"} · {[...changes.categories].join(", ")}
                    </span>
                  ) : null}
                  {frame.status === "changed" ? (
                    <button className="dial-button min-h-8 px-3 text-[12px]" onClick={() => onCompareScreen(frame.frameId)} type="button">
                      Compare in detail
                    </button>
                  ) : null}
                </div>
                <ScreenPair frame={frame} />
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}
