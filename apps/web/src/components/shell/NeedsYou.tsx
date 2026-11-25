"use client";

import { Avatar } from "@/src/components/Avatar";
import Link from "next/link";
import { useState } from "react";
import type { OpenMention } from "@/src/server/services/mentions";
import { refreshAppBadge } from "./AppBadgeSync";
import { showErrorToast } from "./Toaster";

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
    if (!response?.ok) {
      setMentions(previous);
      showErrorToast("Couldn't clear that mention. Try again.");
    }
    else refreshAppBadge();
  }

  if (!mentions.length) return null;

  return (
    <section aria-labelledby="needs-you-title" className={"needs-you @container " + className}>
      <div className="flex items-center gap-2.5 px-4 pb-1 pt-4 @md:px-5">
        <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-foreground" id="needs-you-title">Needs you</h2>
        <span className="needs-you-count">{mentions.length}</span>
      </div>
      <ul className="needs-you-list">
        {mentions.map((mention) => {
          const href = `/projects/${mention.projectId}/handoffs/${mention.handoffId}?versionId=${mention.versionId}&comment=${mention.commentId}`;
          return (
            <li className="needs-you-item flex flex-wrap items-start gap-x-3 gap-y-4 px-4 py-4 @md:flex-nowrap @md:gap-x-4 @md:px-5" key={mention.commentId}>
              <Avatar className="mt-0.5 shrink-0" name={mention.authorName} size={32} src={mention.authorImage} />
              <Link
                className="min-w-0 flex-1 basis-[calc(100%-3rem)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40 @md:basis-auto"
                href={href}
              >
                <span className="block text-[13px] leading-5 text-foreground @md:truncate">
                  <span className="font-semibold">{mention.authorName}</span>
                  <span className="text-foreground-muted"> mentioned you in </span>
                  <span className="font-semibold">{mention.handoffName}</span>
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-foreground-subtle" suppressHydrationWarning>
                  {mention.projectName} · {timeAgo(mention.createdAt)}
                </span>
                <span className="needs-you-quote mt-3 line-clamp-3 block w-fit max-w-full @md:max-w-[64ch] text-[13px] leading-5 text-foreground">{mention.excerpt}</span>
              </Link>
              <span className="needs-you-actions ml-11 flex shrink-0 items-center gap-2 @md:ml-0">
                <Link className="needs-you-reply" href={href}>Reply</Link>
                <button
                  className="needs-you-done"
                  onClick={() => void done(mention.commentId)}
                  title="Clear without replying"
                  type="button"
                >
                  Done
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
