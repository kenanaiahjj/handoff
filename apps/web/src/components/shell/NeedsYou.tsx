"use client";

import Link from "next/link";
import { useState } from "react";
import type { OpenMention } from "@/src/server/services/mentions";

const relativeTime = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function timeAgo(iso: string) {
  const minutes = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  if (Math.abs(minutes) < 1) return "just now";
  if (Math.abs(minutes) < 60) return relativeTime.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relativeTime.format(hours, "hour");
  return relativeTime.format(Math.round(hours / 24), "day");
}

/** Comments that mention this person and still need a reply. Done clears one without replying. */
export function NeedsYou({ initial, className = "" }: { initial: OpenMention[]; className?: string }) {
  const [mentions, setMentions] = useState(initial);

  async function done(commentId: string) {
    const previous = mentions;
    setMentions((current) => current.filter((mention) => mention.commentId !== commentId));
    const response = await fetch(`/api/me/mentions/${encodeURIComponent(commentId)}`, { method: "DELETE" }).catch(() => null);
    if (!response?.ok) setMentions(previous);
  }

  if (!mentions.length) return null;

  return (
    <section aria-labelledby="needs-you-title" className={className}>
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-[14px] font-semibold tracking-[-0.01em]" id="needs-you-title">Needs you</h2>
        <span className="viewer-count">{mentions.length}</span>
      </div>
      <ul className="needs-you-list overflow-hidden rounded-panel border border-border bg-surface">
        {mentions.map((mention) => (
          <li className="group flex items-start gap-3 border-b border-border px-4 py-3 last:border-b-0" key={mention.commentId}>
            <span aria-hidden="true" className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-surface-strong text-[11px] font-semibold">
              {mention.authorName.trim().slice(0, 1).toUpperCase()}
            </span>
            <Link
              className="min-w-0 flex-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40"
              href={`/workspace/${mention.workspaceId}/projects/${mention.projectId}/handoffs/${mention.handoffId}?versionId=${mention.versionId}&comment=${mention.commentId}`}
            >
              <span className="block truncate text-[13px] text-foreground">
                <span className="font-medium">{mention.authorName}</span>
                <span className="text-foreground-subtle"> mentioned you in </span>
                <span className="font-medium">{mention.handoffName}</span>
                <span className="text-foreground-subtle"> · {mention.projectName}</span>
              </span>
              <span className="mt-0.5 line-clamp-2 block text-[12px] leading-5 text-foreground-muted">{mention.excerpt}</span>
              <span className="mt-1 block text-[11px] text-foreground-subtle" suppressHydrationWarning>{timeAgo(mention.createdAt)}</span>
            </Link>
            <button
              className="dial-button min-h-7 shrink-0 px-2.5 text-[12px]"
              onClick={() => void done(mention.commentId)}
              title="Clear without replying"
              type="button"
            >
              Done
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
