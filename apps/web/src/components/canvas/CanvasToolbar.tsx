"use client";

import { AssetExportMenu, type AssetExportTarget } from "./AssetExportMenu";

type CanvasToolbarProps = {
  scale: number;
  exportTargets: AssetExportTarget[];
  onZoomOut: () => void;
  onFit: () => void;
  onZoomIn: () => void;
};

export function CanvasToolbar({ scale, exportTargets, onZoomOut, onFit, onZoomIn }: CanvasToolbarProps) {
  const zoomPercentage = Math.round(scale * 100) + "%";

  return (
    <div className="flex shrink-0 items-center gap-1 text-[12px] text-[#c8c8c8]" role="group" aria-label="Canvas controls">
      <button
        className="min-h-8 rounded-[5px] px-2.5 hover:bg-[#3b3b3b] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#aaa]"
        onClick={onFit}
        type="button"
      >
        Fit
      </button>
      <div className="flex h-8 items-center gap-0.5 rounded-[5px] bg-[#303030] px-0.5">
        <button
          aria-label="Zoom out"
          className="grid size-7 place-items-center rounded text-[16px] text-[#bcbcbc] hover:bg-[#454545] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#aaa]"
          onClick={onZoomOut}
          type="button"
        >
          −
        </button>
        <button
          aria-label={"Fit canvas to view. Current zoom " + zoomPercentage}
          className="min-h-6 min-w-10 px-1 font-mono text-[11px] text-[#ddd] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#aaa]"
          onClick={onFit}
          type="button"
        >
          {zoomPercentage}
        </button>
        <button
          aria-label="Zoom in"
          className="grid size-7 place-items-center rounded text-[16px] text-[#bcbcbc] hover:bg-[#454545] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#aaa]"
          onClick={onZoomIn}
          type="button"
        >
          +
        </button>
      </div>
      <AssetExportMenu targets={exportTargets} />
    </div>
  );
}
