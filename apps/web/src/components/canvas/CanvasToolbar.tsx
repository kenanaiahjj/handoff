"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AssetExportMenu, type AssetExportTarget } from "./AssetExportMenu";
import { HandoffAccessDialog } from "./HandoffAccessDialog";

type CanvasToolbarProps = {
  scale: number;
  exportTargets: AssetExportTarget[];
  shareUrl: string | null;
  shareTitle: string;
  sharingEndpoint: string | null;
  publishEndpoint: string | null;
  publishVersionId: string;
  latestVersionId: string;
  publishedVersionId: string | null;
  onZoomOut: () => void;
  onFit: () => void;
  onZoomIn: () => void;
};

type ShareStatus = "idle" | "copied" | "failed";
type PublishResponse = { reviewUrl?: string; reviewShareId?: string; error?: string };

export function CanvasToolbar({
  scale,
  exportTargets,
  shareUrl,
  shareTitle,
  sharingEndpoint,
  publishEndpoint,
  publishVersionId,
  latestVersionId,
  publishedVersionId,
  onZoomOut,
  onFit,
  onZoomIn,
}: CanvasToolbarProps) {
  const router = useRouter();
  const zoomPercentage = Math.round(scale * 100) + "%";
  const [shareStatus, setShareStatus] = useState<ShareStatus>("idle");
  const [locallyPublishedVersionId, setLocallyPublishedVersionId] = useState<string | null>(null);
  const [publishPending, setPublishPending] = useState(false);
  const [publishError, setPublishError] = useState("");
  const currentPublishedVersionId =
    locallyPublishedVersionId === latestVersionId ? locallyPublishedVersionId : publishedVersionId;
  const isLatestVersion = publishVersionId === latestVersionId;
  const latestIsPublished = currentPublishedVersionId === latestVersionId;

  useEffect(() => {
    if (shareStatus === "idle") return;
    const timeout = window.setTimeout(() => setShareStatus("idle"), 1800);
    return () => window.clearTimeout(timeout);
  }, [shareStatus]);

  async function copyCanvasLink() {
    if (!shareUrl) {
      setShareStatus("failed");
      return;
    }

    const url = new URL(shareUrl, window.location.origin).toString();
    setShareStatus("idle");

    try {
      await navigator.clipboard.writeText(url);
      setShareStatus("copied");
    } catch {
      setShareStatus("failed");
    }
  }

  async function publishCanvas() {
    if (!publishEndpoint || !isLatestVersion || publishPending || latestIsPublished) return;

    setPublishPending(true);
    setPublishError("");
    try {
      const response = await fetch(publishEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId: publishVersionId }),
      });
      const payload = await response.json() as PublishResponse;
      if (!response.ok || !payload.reviewUrl || !payload.reviewShareId) {
        throw new Error(payload.error ?? "Could not publish this canvas.");
      }
      setLocallyPublishedVersionId(publishVersionId);
      router.refresh();
    } catch (cause) {
      setPublishError(cause instanceof Error ? cause.message : "Could not reach the publishing service. Try again.");
    } finally {
      setPublishPending(false);
    }
  }

  return (
    <div className="contents text-[12px] text-foreground-muted lg:flex lg:flex-nowrap lg:items-center lg:gap-1" role="group" aria-label="Canvas controls">
      <button
        className="min-h-11 shrink-0 rounded-control px-2.5 hover:bg-surface-strong hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary lg:min-h-8"
        onClick={onFit}
        type="button"
      >
        Fit
      </button>
      <div className="flex h-11 shrink-0 items-center gap-0.5 rounded-control bg-surface-raised px-0.5 lg:h-8">
        <button
          aria-label="Zoom out"
          className="grid size-11 shrink-0 place-items-center rounded text-[16px] text-foreground-muted hover:bg-surface-strong hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary lg:size-7"
          onClick={onZoomOut}
          type="button"
        >
          −
        </button>
        <button
          aria-label={"Fit canvas to view. Current zoom " + zoomPercentage}
          className="min-h-11 min-w-11 shrink-0 px-1 font-mono text-[11px] text-foreground hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary lg:min-h-6 lg:min-w-10"
          onClick={onFit}
          type="button"
        >
          {zoomPercentage}
        </button>
        <button
          aria-label="Zoom in"
          className="grid size-11 shrink-0 place-items-center rounded text-[16px] text-foreground-muted hover:bg-surface-strong hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary lg:size-7"
          onClick={onZoomIn}
          type="button"
        >
          +
        </button>
      </div>
      <AssetExportMenu targets={exportTargets} />
      {publishEndpoint ? (
        latestIsPublished ? (
          <span className="canvas-publish-status" role="status">
            <svg aria-hidden="true" className="size-3.5" fill="none" viewBox="0 0 16 16">
              <path d="m3.5 8.2 2.8 2.8 6.2-6.2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
            </svg>
            Published
          </span>
        ) : (
          <button
            aria-busy={publishPending}
            aria-describedby={!isLatestVersion ? "canvas-publish-version-hint" : undefined}
            className="canvas-publish-action flex h-11 shrink-0 items-center justify-center rounded-full px-3 text-[12px] font-semibold lg:h-8 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f4d994] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!isLatestVersion || publishPending}
            onClick={() => void publishCanvas()}
            title={!isLatestVersion ? "Select the latest version to publish." : undefined}
            type="button"
          >
            {publishPending ? "Publishing…" : currentPublishedVersionId ? "Publish update" : "Publish"}
          </button>
        )
      ) : null}
      {publishEndpoint && !isLatestVersion ? <span className="sr-only" id="canvas-publish-version-hint">Select the latest version to publish.</span> : null}
      {publishError ? <span aria-live="polite" className="max-w-48 text-[11px] leading-4 text-danger" role="status">{publishError}</span> : null}
      {sharingEndpoint ? (
        <HandoffAccessDialog endpoint={sharingEndpoint} handoffName={shareTitle} publishTarget={{ versionId: publishVersionId, isLatestVersion }} variant="share" />
      ) : (
        <button
          aria-label="Copy canvas link"
          className="flex h-11 shrink-0 items-center gap-1.5 rounded-control px-2.5 hover:bg-surface-strong hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50 lg:h-8"
          disabled={!shareUrl}
          onClick={() => void copyCanvasLink()}
          title={shareStatus === "failed" ? "Could not copy the link. Try again." : shareUrl ? "Copy the published canvas link" : "Publish a version to create a shareable link"}
          type="button"
        >
          <svg aria-hidden="true" className="size-3.5" fill="none" viewBox="0 0 16 16">
            <path d="m5.4 8 5.2-2.8M5.4 8l5.2 2.8" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
            <circle cx="3.8" cy="8" r="1.65" stroke="currentColor" strokeWidth="1.3" />
            <circle cx="12.2" cy="3.6" r="1.65" stroke="currentColor" strokeWidth="1.3" />
            <circle cx="12.2" cy="12.4" r="1.65" stroke="currentColor" strokeWidth="1.3" />
          </svg>
          {shareStatus === "copied" ? "Copied" : shareStatus === "failed" ? "Try again" : "Share"}
        </button>
      )}
      <span aria-live="polite" className="sr-only">
        {shareStatus === "copied" ? "Canvas link copied to clipboard." : shareStatus === "failed" ? "Could not copy the canvas link." : ""}
      </span>
    </div>
  );
}
