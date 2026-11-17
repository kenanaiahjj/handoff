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
  /** Unpublished changes (screens marked for removal); Publish then opens the review dialog. */
  pendingChanges?: number;
  onReviewChanges?: () => void;
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
  pendingChanges = 0,
  onReviewChanges,
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
    <div className="flex flex-nowrap items-center gap-1 text-[12px] text-foreground-muted" role="group" aria-label="Canvas controls">
      <div aria-label="Zoom" className="canvas-toolgroup shrink-0" role="group">
        <button aria-label="Zoom out" className="canvas-tool !min-w-7 !px-0" onClick={onZoomOut} title="Zoom out (−)" type="button">
          <svg aria-hidden="true" className="size-3.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" viewBox="0 0 16 16"><path d="M3.5 8h9" /></svg>
        </button>
        <button
          aria-label={"Fit to screen. Current zoom " + zoomPercentage}
          className="canvas-tool !min-w-12 !px-1 font-mono !text-[11px] tabular-nums"
          onClick={onFit}
          title="Fit to screen (⇧1)"
          type="button"
        >
          {zoomPercentage}
        </button>
        <button aria-label="Zoom in" className="canvas-tool !min-w-7 !px-0" onClick={onZoomIn} title="Zoom in (+)" type="button">
          <svg aria-hidden="true" className="size-3.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" viewBox="0 0 16 16"><path d="M3.5 8h9M8 3.5v9" /></svg>
        </button>
      </div>
      <AssetExportMenu targets={exportTargets} />
      {publishEndpoint && pendingChanges > 0 && onReviewChanges ? (
        <button
          className="canvas-publish-action flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap px-3 text-[12px] font-semibold lg:h-8"
          onClick={onReviewChanges}
          title="Review and publish your changes as a new version"
          type="button"
        >
          Publish
          <span className="rounded-full bg-black/15 px-1.5 text-[10px] leading-4">{pendingChanges}</span>
        </button>
      ) : publishEndpoint ? (
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
            className="canvas-publish-action flex h-11 shrink-0 items-center whitespace-nowrap justify-center px-3 text-[12px] font-semibold lg:h-8 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
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
