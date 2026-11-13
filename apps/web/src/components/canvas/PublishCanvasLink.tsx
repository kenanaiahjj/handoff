"use client";

import { useState } from "react";
import { HandoffSharingControls } from "./HandoffSharingControls";

type SharingMode = "workspace" | "invited" | "anyone";
type PublishResponse = { reviewUrl?: string; reviewShareId?: string; error?: string };

export function PublishCanvasLink({
  workspaceId,
  projectId,
  handoffId,
  versionId,
  latestVersionId,
  publishedVersionId,
  reviewShareId,
  canManage,
}: {
  workspaceId: string;
  projectId: string;
  handoffId: string;
  versionId: string;
  latestVersionId: string;
  publishedVersionId: string | null;
  reviewShareId: string | null;
  sharingMode: SharingMode;
  canManage: boolean;
}) {
  const [shareId, setShareId] = useState(reviewShareId);
  const [publishedVersion, setPublishedVersion] = useState(publishedVersionId);
  const [refreshKey, setRefreshKey] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const isLatest = versionId === latestVersionId;
  const hasPublishedCanvas = Boolean(publishedVersion && shareId);
  const endpoint = `/api/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/handoffs/${encodeURIComponent(handoffId)}`;

  async function publish() {
    setPending(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`${endpoint}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId }),
      });
      const payload = await response.json() as PublishResponse;
      if (!response.ok || !payload.reviewUrl || !payload.reviewShareId) {
        throw new Error(payload.error ?? "We couldn't publish this canvas.");
      }
      setShareId(payload.reviewShareId);
      setPublishedVersion(versionId);
      setRefreshKey((current) => current + 1);
      setMessage("Canvas link is ready. Choose who can open it below.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We couldn't reach the publishing service. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-labelledby="publish-canvas-title" className="rounded-panel bg-surface p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-xs font-semibold text-foreground" id="publish-canvas-title">Team review link</h3>
          <p className="mt-1 text-xs leading-5 text-foreground-muted">Publish a stable link to the frozen canvas for your team.</p>
        </div>
        {canManage ? (
          <button className="h-8 rounded-control bg-primary px-3 text-[11px] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50" disabled={!isLatest || pending} onClick={() => void publish()} type="button">
            {pending ? "Working…" : hasPublishedCanvas ? "Publish update" : "Publish canvas"}
          </button>
        ) : null}
      </div>

        {!isLatest && canManage ? <p className="mt-2 text-xs text-foreground-subtle">Select the latest version to publish an update.</p> : null}
      {canManage ? <HandoffSharingControls endpoint={endpoint} refreshKey={refreshKey} /> : (
          <p className="mt-3 border-t border-border pt-3 text-xs leading-5 text-foreground-muted">Sharing controls are available to workspace owners and designers.</p>
      )}
      {error ? <p className="mt-3 text-xs text-warning" role="alert">{error}</p> : null}
      {message ? <p className="mt-3 text-xs text-foreground-muted" role="status">{message}</p> : null}
      {publishedVersion ? <p className="mt-2 font-mono text-[10px] text-foreground-subtle">Published version {publishedVersion}</p> : null}
      {!hasPublishedCanvas && !canManage ? <p className="mt-2 text-xs text-foreground-subtle">No canvas has been published yet.</p> : null}
    </section>
  );
}
