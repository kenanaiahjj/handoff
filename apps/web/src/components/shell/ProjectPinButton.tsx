"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

/** Pins a project to the top of this person's project list. */
export function ProjectPinButton({ projectId, projectName, pinned: initial }: { projectId: string; projectName: string; pinned: boolean }) {
  const router = useRouter();
  const [pinned, setPinned] = useState(initial);
  const [, startRefresh] = useTransition();

  async function toggle() {
    const next = !pinned;
    setPinned(next);
    const response = await fetch("/api/me/pins", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "project", targetId: projectId, pinned: next }),
    }).catch(() => null);
    if (!response?.ok) {
      setPinned(!next);
      return;
    }
    startRefresh(() => router.refresh());
  }

  return (
    <button
      aria-label={pinned ? `Unpin ${projectName}` : `Pin ${projectName} to the top`}
      aria-pressed={pinned}
      className={"grid size-8 shrink-0 place-items-center rounded-control transition-colors hover:bg-white/[0.07] hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary " + (pinned ? "text-foreground" : "project-actions text-foreground-subtle")}
      onClick={() => void toggle()}
      title={pinned ? "Unpin" : "Pin to top"}
      type="button"
    >
      <svg aria-hidden="true" className="size-3.5" fill={pinned ? "currentColor" : "none"} stroke="currentColor" strokeLinejoin="round" strokeWidth="1.4" viewBox="0 0 16 16">
        <path d="M6 2.5h4l-.5 4 2.5 2.5H4l2.5-2.5zM8 9v4.5" />
      </svg>
    </button>
  );
}
