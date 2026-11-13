"use client";

import { useEffect, useState } from "react";
import { AssetExportMenu, type AssetExportTarget } from "./AssetExportMenu";

type CanvasToolbarProps = {
  scale: number;
  exportTargets: AssetExportTarget[];
  shareUrl: string | null;
  shareTitle: string;
  onZoomOut: () => void;
  onFit: () => void;
  onZoomIn: () => void;
};

type ShareStatus = "idle" | "shared" | "copied" | "failed";

export function CanvasToolbar({ scale, exportTargets, shareUrl, shareTitle, onZoomOut, onFit, onZoomIn }: CanvasToolbarProps) {
  const zoomPercentage = Math.round(scale * 100) + "%";
  const [shareStatus, setShareStatus] = useState<ShareStatus>("idle");

  useEffect(() => {
    if (shareStatus === "idle") return;
    const timeout = window.setTimeout(() => setShareStatus("idle"), 1800);
    return () => window.clearTimeout(timeout);
  }, [shareStatus]);

  async function shareCanvas() {
    const url = new URL(shareUrl ?? window.location.href, window.location.origin).toString();
    setShareStatus("idle");

    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: shareTitle, url });
        setShareStatus("shared");
        return;
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      setShareStatus("copied");
    } catch {
      setShareStatus("failed");
    }
  }

  return (
    <div className="flex shrink-0 items-center gap-1 text-[12px] text-[#c8c8c8]" role="group" aria-label="Canvas controls">
      <button
        className="min-h-11 shrink-0 rounded-[5px] px-2.5 hover:bg-[#3b3b3b] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#aaa] lg:min-h-8"
        onClick={onFit}
        type="button"
      >
        Fit
      </button>
      <div className="flex h-11 shrink-0 items-center gap-0.5 rounded-[5px] bg-[#303030] px-0.5 lg:h-8">
        <button
          aria-label="Zoom out"
          className="grid size-11 shrink-0 place-items-center rounded text-[16px] text-[#bcbcbc] hover:bg-[#454545] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#aaa] lg:size-7"
          onClick={onZoomOut}
          type="button"
        >
          −
        </button>
        <button
          aria-label={"Fit canvas to view. Current zoom " + zoomPercentage}
          className="min-h-11 min-w-11 shrink-0 px-1 font-mono text-[11px] text-[#ddd] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#aaa] lg:min-h-6 lg:min-w-10"
          onClick={onFit}
          type="button"
        >
          {zoomPercentage}
        </button>
        <button
          aria-label="Zoom in"
          className="grid size-11 shrink-0 place-items-center rounded text-[16px] text-[#bcbcbc] hover:bg-[#454545] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#aaa] lg:size-7"
          onClick={onZoomIn}
          type="button"
        >
          +
        </button>
      </div>
      <AssetExportMenu targets={exportTargets} />
      <button
        aria-label="Share canvas"
        className="flex h-11 shrink-0 items-center gap-1.5 rounded-[5px] px-2.5 hover:bg-[#3b3b3b] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#aaa] lg:h-8"
        onClick={() => void shareCanvas()}
        title={shareStatus === "failed" ? "Could not share or copy the link. Try again." : "Share or copy the canvas link"}
        type="button"
      >
        <svg aria-hidden="true" className="size-3.5" fill="none" viewBox="0 0 16 16">
          <path d="m5.4 8 5.2-2.8M5.4 8l5.2 2.8" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
          <circle cx="3.8" cy="8" r="1.65" stroke="currentColor" strokeWidth="1.3" />
          <circle cx="12.2" cy="3.6" r="1.65" stroke="currentColor" strokeWidth="1.3" />
          <circle cx="12.2" cy="12.4" r="1.65" stroke="currentColor" strokeWidth="1.3" />
        </svg>
        {shareStatus === "shared" ? "Shared" : shareStatus === "copied" ? "Copied" : shareStatus === "failed" ? "Try again" : "Share"}
      </button>
      <span aria-live="polite" className="sr-only">
        {shareStatus === "shared" ? "Canvas link shared." : shareStatus === "copied" ? "Canvas link copied to clipboard." : shareStatus === "failed" ? "Could not share or copy the canvas link." : ""}
      </span>
    </div>
  );
}
