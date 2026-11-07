"use client";

import { useState } from "react";

type PublishResponse = { reviewUrl?: string; reviewShareId?: string; error?: string };

export function PublishCanvasLink({
  workspaceId,
  projectId,
  handoffId,
  versionId,
  latestVersionId,
  publishedVersionId,
  reviewShareId,
}: {
  workspaceId: string;
  projectId: string;
  handoffId: string;
  versionId: string;
  latestVersionId: string;
  publishedVersionId: string | null;
  reviewShareId: string | null;
}) {
  const [reviewUrl, setReviewUrl] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [shareId, setShareId] = useState(reviewShareId);
  const [publishedVersion, setPublishedVersion] = useState(publishedVersionId);
  const isLatest = versionId === latestVersionId;
  const isPublished = publishedVersion === versionId && shareId !== null;
  const sharePath = shareId ? `/review/${encodeURIComponent(shareId)}` : "";

  async function publish() {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/handoffs/${encodeURIComponent(handoffId)}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId }),
      });
      const payload = await response.json() as PublishResponse;
      if (!response.ok || !payload.reviewUrl || !payload.reviewShareId) {
        setMessage(payload.error ?? "We couldn't publish this canvas.");
        return;
      }
      setReviewUrl(payload.reviewUrl);
      setShareId(payload.reviewShareId);
      setPublishedVersion(versionId);
      setMessage("Canvas link is ready for your team.");
    } catch {
      setMessage("We couldn't reach the publishing service. Try again.");
    } finally {
      setPending(false);
    }
  }

  async function copyLink() {
    if (!sharePath) return;
    const link = reviewUrl || new URL(sharePath, window.location.origin).toString();
    try {
      await navigator.clipboard.writeText(link);
      setReviewUrl(link);
      setMessage("Canvas link copied.");
    } catch {
      setMessage("Select and copy the canvas link below.");
    }
  }

  return (
    <section aria-labelledby="publish-canvas-title" className="rounded-[6px] border border-[#3b3b3b] bg-[#202020] p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-[12px] font-semibold text-[#e5e5e5]" id="publish-canvas-title">Team review link</h3>
          <p className="mt-1 text-[11px] leading-5 text-[#999]">Recipients sign in with their work email and open the canvas directly.</p>
        </div>
        {isPublished && shareId ? (
          <button className="h-8 rounded-[5px] border border-[#464646] px-3 text-[11px] font-medium text-[#ddd] transition-colors hover:bg-[#303030] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#aaa]" onClick={copyLink} type="button">
            Copy canvas link
          </button>
        ) : (
          <button className="h-8 rounded-[5px] bg-[#d7d7d7] px-3 text-[11px] font-semibold text-[#222] transition-colors hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#aaa] disabled:cursor-not-allowed disabled:opacity-50" disabled={!isLatest || pending} onClick={publish} type="button">
            {pending ? "Publishing…" : publishedVersionId ? "Publish update" : "Publish canvas"}
          </button>
        )}
      </div>
      {!isLatest ? <p className="mt-2 text-[11px] text-[#888]">Select the latest version to publish an update.</p> : null}
      {sharePath ? (
        <div className="mt-3">
          {reviewUrl ? (
            <>
              <label className="sr-only" htmlFor="published-review-url">Published canvas link</label>
              <input className="h-8 w-full rounded-[5px] border border-[#3b3b3b] bg-[#171717] px-2.5 font-mono text-[10px] text-[#c8c8c8] outline-none focus-visible:border-[#777]" id="published-review-url" readOnly value={reviewUrl} />
            </>
          ) : (
            <p className="text-[11px] text-[#999]">Your canvas link is ready to copy and share.</p>
          )}
        </div>
      ) : null}
      {message ? <p className="mt-2 text-[11px] text-[#aaa]" role="status">{message}</p> : null}
    </section>
  );
}
