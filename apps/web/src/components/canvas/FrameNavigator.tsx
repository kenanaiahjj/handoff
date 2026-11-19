"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { SnapshotNode } from "@asbir/snapshot-contract";
import { filterChangedFrames } from "./changed-frame-filter";
import { comparisonFrameStatusLabel, comparisonFrameStatusShortLabel } from "./compare-presentation";
import type { CanvasNodeSummary } from "./canvas-node-summary";

type CanvasFrameOption = {
  id: string;
  name: string;
  pageName?: string;
  imageSrc: string;
  fileName: string;
  sourceWidth: number;
  sourceHeight: number;
  pixelWidth: number;
  pixelHeight: number;
  sourceX: number;
  sourceY: number;
  /** Lightweight element summaries; full details load per screen (see useFrameNodeDetails). */
  nodes: CanvasNodeSummary[];
  overlayNodes?: CanvasOverlayNode[];
  /** Areas of this frame's image to cut out (screens removed after the image was rendered). */
  maskRects?: Array<{ x: number; y: number; width: number; height: number }>;
  /** Areas of this frame's image to keep (the overview's current screens); everything else is stale. */
  keepRects?: Array<{ x: number; y: number; width: number; height: number }>;
  layerExports?: Record<string, { downloadUrl: string; fileName: string; contentType: "image/png" | "image/svg+xml" }>;
  exact: boolean;
  kind: "overview" | "frame";
};

export type CanvasOverlayNode = Pick<CanvasNodeSummary, "sourceNodeId" | "sourceFrameId" | "name" | "type" | "visible" | "bounds">;

export type { CanvasFrameOption };
export type CanvasFrameChangeStatus = "added" | "removed" | "changed" | "unchanged" | "only-in-before-capture" | "only-in-after-capture";

export type FrameComparisonSummary = {
  earlierVersionLabel: string;
  changed: number;
  added: number;
  removed: number;
  changeCount: number;
  visualChangeCount: number;
  onlyInAfterCapture: number;
  onlyInBeforeCapture: number;
};

type FrameNavigatorProps = {
  frames: CanvasFrameOption[];
  activeFrameId: string | null;
  onSelect: (frameId: string) => void;
  selectedNodeId: string | null;
  onSelectNode: (sourceNodeId: string) => void;
  onOpenSearch: () => void;
  frameStatuses: Record<string, CanvasFrameChangeStatus>;
  comparisonSummary: FrameComparisonSummary | null;
  changedOnly: boolean;
  onChangedOnlyChange: (changedOnly: boolean) => void;
  /** Owners and designers on the latest version: tick several screens and remove them in one version. */
  removal?: {
    /** Opens the publish dialog with the pending changes. */
    onReview: () => void;
    removing: boolean;
    /** Shared with the canvas, where screens can be clicked to select them too. */
    selecting: boolean;
    picked: Set<string>;
    onSelectingChange: (selecting: boolean) => void;
    onPickedChange: (picked: Set<string>) => void;
  };
};

const emptyPicked = new Set<string>();

export function FrameNavigator({
  frames,
  activeFrameId,
  onSelect,
  selectedNodeId,
  onSelectNode,
  onOpenSearch,
  frameStatuses,
  comparisonSummary,
  changedOnly,
  onChangedOnlyChange,
  removal,
}: FrameNavigatorProps) {
  const [screenQuery, setScreenQuery] = useState("");
  const selecting = Boolean(removal?.selecting);
  const picked = removal?.picked ?? emptyPicked;
  const setPicked = (update: (current: Set<string>) => Set<string>) => removal?.onPickedChange(update(picked));
  const [elementQuery, setElementQuery] = useState("");
  const listRef = useRef<HTMLUListElement>(null);
  // Keep the open screen visible in the list when it is chosen elsewhere (canvas, search, [ and ]).
  useEffect(() => {
    if (!activeFrameId) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-frame-id="${CSS.escape(activeFrameId)}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [activeFrameId]);
  const screens = useMemo(() => frames.filter((frame) => frame.kind === "frame"), [frames]);
  const activeFrame = filterChangedFrames(
    screens.filter((frame) => frame.id === activeFrameId),
    changedOnly,
    frameStatuses,
    Boolean(comparisonSummary),
  )[0] ?? null;
  const nodeIndex = new Map(activeFrame?.nodes.map((node) => [node.sourceNodeId, node]) ?? []);
  const visibleFrames = filterChangedFrames(screens, changedOnly, frameStatuses, Boolean(comparisonSummary)).filter((frame) => {
    const searchText = `${frame.name} ${frame.pageName ?? ""}`.toLowerCase();
    return searchText.includes(screenQuery.trim().toLowerCase());
  });
  const pickedCount = [...picked].filter((id) => screens.some((frame) => frame.id === id)).length;
  const allVisiblePicked = visibleFrames.length > 0 && visibleFrames.every((frame) => picked.has(frame.id));
  function togglePicked(frameId: string) {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(frameId)) next.delete(frameId);
      else next.add(frameId);
      return next;
    });
  }
  function stopSelecting() {
    removal?.onSelectingChange(false);
  }

  const filteredNodes = (activeFrame?.nodes ?? []).filter((node) =>
    (node.name + " " + node.type + " " + node.sourceNodeId).toLowerCase().includes(elementQuery.toLowerCase()),
  );

  function depthForNode(node: CanvasNodeSummary) {
    let depth = 0;
    let parentId = node.parentSourceNodeId;
    const seen = new Set([node.sourceNodeId]);
    while (parentId && nodeIndex.has(parentId) && depth < 12 && !seen.has(parentId)) {
      seen.add(parentId);
      depth += 1;
      parentId = nodeIndex.get(parentId)?.parentSourceNodeId ?? null;
    }
    return depth;
  }

  return (
    <nav aria-label="Snapshot screens" className="flex h-full min-h-0 min-w-0 flex-col border-r border-border bg-surface text-foreground-muted">
      <div className="shrink-0 space-y-3 p-3">
        <button
          className="dial-button h-9 w-full !justify-start px-2.5 text-left text-[13px]"
          id="canvas-search-screens-trigger"
          onClick={onOpenSearch}
          title="Search captured text, colors, and elements"
          type="button"
        >
          <svg aria-hidden="true" className="size-3.5 shrink-0 text-foreground-subtle" fill="none" viewBox="0 0 16 16">
            <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="m10.5 10.5 3 3" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
          </svg>
          <span className="min-w-0 flex-1 truncate">Search all screens</span>
          <kbd className="rounded-chip bg-surface-raised px-1.5 py-0.5 font-mono text-[10px] text-foreground-muted">⌘ F</kbd>
        </button>
        <input
          aria-label="Filter screens"
            className="h-9 w-full rounded-control border border-transparent bg-surface-inset px-2.5 text-[13px] text-foreground outline-none placeholder:text-foreground-subtle hover:bg-surface-raised focus:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/60"
          id="review-screen-filter"
          onChange={(event) => setScreenQuery(event.target.value)}
          placeholder="Filter screens"
          type="search"
          value={screenQuery}
        />
        <label className="flex min-h-7 cursor-pointer items-center gap-2 text-[12px] leading-5 text-foreground-muted">
          <input
            checked={changedOnly}
            className="size-3.5 accent-[var(--foreground)]"
            disabled={!comparisonSummary}
            onChange={(event) => onChangedOnlyChange(event.target.checked)}
            title={comparisonSummary ? undefined : "Compare versions to filter changed screens."}
            type="checkbox"
          />
          <span>{comparisonSummary?.onlyInAfterCapture ? "Changed or no before match" : "Changed in this version"}</span>
          {comparisonSummary ? <span className="ml-auto font-mono text-[10px] text-foreground-subtle">{comparisonSummary.changed + comparisonSummary.added + comparisonSummary.onlyInAfterCapture}</span> : null}
        </label>
      </div>

      {selecting ? (
        <div className="mx-2 mb-2 flex items-center gap-1.5 rounded-[9px] bg-white/[0.04] px-2 py-1.5">
          <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground" title="Click screens here or on the canvas">{pickedCount ? `${pickedCount} to remove` : "Click screens to remove"}</span>
          <button
            className="rounded-[6px] px-1.5 py-1 text-[11px] text-foreground-muted hover:bg-white/[0.06] hover:text-foreground"
            onClick={() => setPicked((current) => {
              const next = new Set(current);
              for (const frame of visibleFrames) {
                if (allVisiblePicked) next.delete(frame.id);
                else next.add(frame.id);
              }
              return next;
            })}
            type="button"
          >
            {allVisiblePicked ? "Clear" : screenQuery.trim() || changedOnly ? "Select shown" : "Select all"}
          </button>
          <button className="rounded-[6px] px-1.5 py-1 text-[11px] text-foreground-muted hover:bg-white/[0.06] hover:text-foreground" onClick={stopSelecting} type="button">Done</button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2 px-3 pb-2 pt-1">
          <h2 className="dial-section-title">Screens</h2>
          <span className="ml-auto font-mono text-[10px] text-foreground-subtle">{visibleFrames.length}/{screens.length}</span>
          {removal ? (
            <button className="rounded-[6px] px-1.5 py-0.5 text-[11px] text-foreground-muted hover:bg-white/[0.06] hover:text-foreground" onClick={() => removal.onSelectingChange(true)} title="Mark screens to remove in the next version (or Shift-click screens on the canvas)" type="button">
              Select
            </button>
          ) : null}
        </div>
      )}

      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3" ref={listRef}>
        {visibleFrames.map((frame, index) => {
          // In select mode "selected" means marked for removal; otherwise it's the open screen.
          const selected = selecting ? picked.has(frame.id) : frame.id === activeFrameId;
          const status = frameStatuses[frame.id];
          const statusLabel = comparisonFrameStatusShortLabel(status);
          const statusTone = statusLabel === "New" ? "bg-[#183a2d] text-success" : "bg-[#43331f] text-[#efae3d]";
          return (
            <li data-frame-id={frame.id} key={frame.id}>
              <button
                aria-pressed={selected}
                className={"flex min-h-9 w-full items-center gap-2 rounded-control px-2.5 text-left text-[13px] font-medium transition-colors " + (selected ? "bg-surface-strong text-foreground" : "text-foreground-muted hover:bg-surface-inset hover:text-foreground")}
                onClick={() => (selecting ? togglePicked(frame.id) : onSelect(frame.id))}
                title={frame.pageName ? `${frame.name} · ${frame.pageName}` : frame.name}
                type="button"
              >
                {selecting ? (
                  <span aria-hidden="true" className={"grid size-4 shrink-0 place-items-center rounded-[4px] border " + (picked.has(frame.id) ? "border-foreground bg-foreground text-background" : "border-white/25")}>
                    {picked.has(frame.id) ? <svg className="size-3" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 16 16"><path d="m3.5 8.2 2.8 2.8 6.2-6.2" /></svg> : null}
                  </span>
                ) : null}
                <span className="min-w-0 flex-1 truncate">
                  {frame.name}
                  {frame.pageName ? <span className="ml-1.5 text-[10px] text-foreground-subtle">· {frame.pageName}</span> : null}
                </span>
                {!selecting && picked.has(frame.id) ? (
                  <span className="shrink-0 rounded-control bg-danger/15 px-1.5 py-0.5 text-[10px] font-medium leading-4 text-danger">Removing</span>
                ) : statusLabel ? (
                  <span className={"shrink-0 whitespace-nowrap rounded-control px-1.5 py-0.5 text-[10px] font-medium leading-4 " + statusTone} title={status ? comparisonFrameStatusLabel(status) : undefined}>{statusLabel}</span>
                ) : null}
                <span className="sr-only">Screen {index + 1} of {screens.length}</span>
              </button>
            </li>
          );
        })}
        {!visibleFrames.length ? <li className="px-2 py-3 text-xs text-foreground-subtle">{changedOnly ? "No changed screens match this view." : "No screens match this filter."}</li> : null}
      </ul>

      {removal && pickedCount ? (
        <div className="shrink-0 border-t border-border p-2.5">
          <button
            className="flex h-9 w-full items-center justify-center rounded-[9px] bg-[#ececec] text-[12px] font-semibold text-[#141414] transition-colors hover:bg-white disabled:opacity-50"
            disabled={removal.removing}
            onClick={removal.onReview}
            type="button"
          >
            Review &amp; publish · {pickedCount} {pickedCount === 1 ? "change" : "changes"}
          </button>
          <p className="mt-1.5 text-center text-[10px] leading-4 text-foreground-subtle">Nothing changes for reviewers until you publish.</p>
        </div>
      ) : null}

      {activeFrame?.exact && activeFrame.nodes.length ? (
        <details className="shrink-0 border-t border-border px-3 py-2">
          <summary className="cursor-pointer select-none text-[11px] font-medium text-foreground-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
            Elements <span className="ml-1 font-mono text-foreground-subtle">{activeFrame.nodes.length}</span>
          </summary>
          <input
            aria-label="Filter elements on selected screen"
            className="mt-2 h-8 w-full rounded-control border border-border bg-surface-muted px-2 text-xs text-foreground placeholder:text-foreground-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            onChange={(event) => setElementQuery(event.target.value)}
            placeholder="Name, type, or source ID"
            type="search"
            value={elementQuery}
          />
          <ul className="mt-2 max-h-44 space-y-0.5 overflow-y-auto">
            {filteredNodes.map((node) => (
              <li key={node.sourceNodeId}>
                <button
                  aria-pressed={node.sourceNodeId === selectedNodeId}
                  className={"flex min-h-8 w-full items-center gap-2 truncate rounded px-1.5 text-left text-[11px] " + (node.sourceNodeId === selectedNodeId ? "bg-surface-raised text-white" : "text-foreground-muted hover:bg-surface-raised hover:text-white")}
                  onClick={() => onSelectNode(node.sourceNodeId)}
                  style={{ paddingInlineStart: 6 + depthForNode(node) * 8 }}
                  type="button"
                >
                  <span aria-hidden="true" className={"size-1.5 shrink-0 rounded-full " + (node.visible ? "bg-[#a0c66b]" : "bg-[#777]")} />
                  <span className="min-w-0 flex-1 truncate">{node.name || node.type}</span>
                  <span className="shrink-0 font-mono text-[10px] text-foreground-subtle">{node.type}</span>
                </button>
              </li>
            ))}
            {!filteredNodes.length ? <li className="px-2 py-2 text-[11px] text-foreground-subtle">No matching elements.</li> : null}
          </ul>
        </details>
      ) : null}
    </nav>
  );
}
