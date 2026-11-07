"use client";

import { useMemo, useState } from "react";
import type { SnapshotNode } from "@asbir/snapshot-contract";

type CanvasFrameOption = {
  id: string;
  name: string;
  imageSrc: string;
  fileName: string;
  sourceWidth: number;
  sourceHeight: number;
  pixelWidth: number;
  pixelHeight: number;
  sourceX: number;
  sourceY: number;
  nodes: SnapshotNode[];
  layerExports?: Record<string, { downloadUrl: string; fileName: string; contentType: "image/png" | "image/svg+xml" }>;
  exact: boolean;
  kind: "overview" | "frame";
};

export type { CanvasFrameOption };
export type CanvasFrameChangeStatus = "added" | "removed" | "changed" | "unchanged";

export type FrameComparisonSummary = {
  earlierVersionLabel: string;
  changed: number;
  added: number;
  removed: number;
  changeCount: number;
  visualChangeCount: number;
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
};

export function FrameNavigator({
  frames,
  activeFrameId,
  onSelect,
  selectedNodeId,
  onSelectNode,
  onOpenSearch,
  frameStatuses,
  comparisonSummary,
}: FrameNavigatorProps) {
  const [screenQuery, setScreenQuery] = useState("");
  const [changedOnly, setChangedOnly] = useState(false);
  const [elementQuery, setElementQuery] = useState("");
  const screens = useMemo(() => frames.filter((frame) => frame.kind === "frame"), [frames]);
  const activeFrame = screens.find((frame) => frame.id === activeFrameId) ?? null;
  const nodeIndex = new Map(activeFrame?.nodes.map((node) => [node.sourceNodeId, node]) ?? []);
  const visibleFrames = screens.filter((frame) => {
    if (!frame.name.toLowerCase().includes(screenQuery.trim().toLowerCase())) return false;
    if (changedOnly && comparisonSummary) {
      const status = frameStatuses[frame.id];
      return status === "changed" || status === "added";
    }
    return true;
  });
  const filteredNodes = (activeFrame?.nodes ?? []).filter((node) =>
    (node.name + " " + node.type + " " + node.sourceNodeId).toLowerCase().includes(elementQuery.toLowerCase()),
  );

  function depthForNode(node: SnapshotNode) {
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
    <nav aria-label="Snapshot screens" className="flex h-full min-h-0 min-w-0 flex-col border-r border-[#3a3a3a] bg-[#202020] text-[#c4c4c4]">
      <div className="shrink-0 space-y-3 p-3">
        <button
          className="flex h-9 w-full items-center gap-2 rounded-[7px] border border-[#3b3b3b] bg-[#292929] px-2.5 text-left text-[12px] text-[#c3c3c3] hover:border-[#555] hover:bg-[#303030] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#aaa]"
          onClick={onOpenSearch}
          title="Search captured text, colours, and elements"
          type="button"
        >
          <svg aria-hidden="true" className="size-3.5 shrink-0 text-[#999]" fill="none" viewBox="0 0 16 16">
            <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="m10.5 10.5 3 3" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
          </svg>
          <span className="min-w-0 flex-1 truncate">Search all screens</span>
          <kbd className="rounded-[4px] bg-[#353535] px-1.5 py-0.5 font-mono text-[10px] text-[#aaa]">⌘ F</kbd>
        </button>
        <input
          aria-label="Filter screens"
            className="h-9 w-full rounded-[7px] border border-transparent bg-[#303030] px-2.5 text-[13px] text-[#ededed] outline-none placeholder:text-[#a0a0a0] focus:border-[#5b5b5b] focus:bg-[#343434] focus:ring-2 focus:ring-[#8a8a8a]/40"
          id="review-screen-filter"
          onChange={(event) => setScreenQuery(event.target.value)}
          placeholder="Filter screens"
          type="search"
          value={screenQuery}
        />
        <label className="flex min-h-7 cursor-pointer items-center gap-2 text-[12px] leading-5 text-[#bdbdbd]">
          <input
            checked={changedOnly}
            className="size-3.5 accent-[#d99a32]"
            disabled={!comparisonSummary}
            onChange={(event) => setChangedOnly(event.target.checked)}
            title={comparisonSummary ? undefined : "Compare versions to filter changed screens."}
            type="checkbox"
          />
          <span>Changed in this version</span>
          {comparisonSummary ? <span className="ml-auto font-mono text-[10px] text-[#888]">{comparisonSummary.changed + comparisonSummary.added}</span> : null}
        </label>
      </div>

      <div className="flex items-center justify-between px-3 pb-2 pt-1">
        <h2 className="text-[12px] font-semibold text-[#aaa]">Screens</h2>
          <span className="font-mono text-[10px] text-[#999]">{visibleFrames.length}/{screens.length}</span>
      </div>

      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
        {visibleFrames.map((frame, index) => {
          const selected = frame.id === activeFrameId;
          const status = frameStatuses[frame.id];
          const statusLabel = status === "added" ? "New" : status === "changed" ? "Changed" : status === "removed" ? "Removed" : null;
          return (
            <li key={frame.id}>
              <button
                aria-pressed={selected}
                className={"flex min-h-9 w-full items-center gap-2 rounded-[5px] border px-2.5 text-left text-[13px] transition-colors " + (selected ? "border-[#454545] bg-[#343434] text-[#f0f0f0]" : "border-transparent text-[#bdbdbd] hover:bg-[#2b2b2b] hover:text-[#f2f2f2]")}
                onClick={() => onSelect(frame.id)}
                type="button"
              >
                <span className="min-w-0 flex-1 truncate">{frame.name}</span>
                {statusLabel ? (
                  <span className={"shrink-0 rounded-[5px] px-1.5 py-0.5 text-[10px] font-medium leading-4 " + (status === "added" ? "bg-[#183a2d] text-[#67d59a]" : status === "removed" ? "bg-[#3b2525] text-[#e58b83]" : "bg-[#43331f] text-[#efae3d]")}>{statusLabel}</span>
                ) : null}
                <span className="sr-only">Screen {index + 1} of {screens.length}</span>
              </button>
            </li>
          );
        })}
        {!visibleFrames.length ? <li className="px-2 py-3 text-xs text-[#999]">{changedOnly ? "No changed screens match this view." : "No screens match this filter."}</li> : null}
      </ul>

      {activeFrame?.exact && activeFrame.nodes.length ? (
        <details className="shrink-0 border-t border-[#3a3a3a] px-3 py-2">
          <summary className="cursor-pointer select-none text-[11px] font-medium text-[#aaa] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#aaa]">
            Elements <span className="ml-1 font-mono text-[#888]">{activeFrame.nodes.length}</span>
          </summary>
          <input
            aria-label="Filter elements on selected screen"
            className="mt-2 h-8 w-full rounded-[5px] border border-[#3b3b3b] bg-[#292929] px-2 text-xs text-[#eee] placeholder:text-[#a0a0a0] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#aaa]"
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
                  className={"flex min-h-8 w-full items-center gap-2 truncate rounded px-1.5 text-left text-[11px] " + (node.sourceNodeId === selectedNodeId ? "bg-[#343434] text-white" : "text-[#bdbdbd] hover:bg-[#2c2c2c] hover:text-white")}
                  onClick={() => onSelectNode(node.sourceNodeId)}
                  style={{ paddingInlineStart: 6 + depthForNode(node) * 8 }}
                  type="button"
                >
                  <span aria-hidden="true" className={"size-1.5 shrink-0 rounded-full " + (node.visible ? "bg-[#a0c66b]" : "bg-[#777]")} />
                  <span className="min-w-0 flex-1 truncate">{node.name || node.type}</span>
                  <span className="shrink-0 font-mono text-[10px] text-[#888]">{node.type}</span>
                </button>
              </li>
            ))}
            {!filteredNodes.length ? <li className="px-2 py-2 text-[11px] text-[#888]">No matching elements.</li> : null}
          </ul>
        </details>
      ) : null}
    </nav>
  );
}
