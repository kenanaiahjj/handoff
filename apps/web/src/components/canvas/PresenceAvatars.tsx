"use client";

import { useState } from "react";
import { firstName, presenceColor, type PresenceViewer } from "./useCanvasPresence";

function Face({ viewer }: { viewer: PresenceViewer }) {
  const [failed, setFailed] = useState(false);
  const color = presenceColor(viewer.userId);
  return (
    <span className="grid size-7 place-items-center overflow-hidden rounded-full border-2 text-[11px] font-semibold text-white" style={{ borderColor: color, backgroundColor: color }}>
      {viewer.image && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element -- small photo from the sign-in provider.
        <img alt="" className="size-full object-cover" onError={() => setFailed(true)} referrerPolicy="no-referrer" src={viewer.image} />
      ) : (
        firstName(viewer.name).charAt(0).toUpperCase()
      )}
    </span>
  );
}

/** Who else has this handoff open. Clicking someone follows their view; clicking again stops. */
export function PresenceAvatars({ viewers, versionId, versionLabels, screenNames, following, followers, onFollow }: {
  viewers: PresenceViewer[];
  versionId: string;
  versionLabels: Record<string, string>;
  screenNames: Record<string, string>;
  following: string | null;
  followers: string[];
  onFollow: (userId: string) => void;
}) {
  if (!viewers.length) return null;
  // Whoever you follow, then whoever follows you, stays in the first four.
  const ordered = [...viewers].sort((a, b) => rank(b, following, followers) - rank(a, following, followers));
  const shown = ordered.slice(0, 4);
  const extra = viewers.length - shown.length;
  return (
    <div aria-label={`${viewers.length} other ${viewers.length === 1 ? "person" : "people"} here`} className="flex items-center -space-x-1.5" role="group">
      {shown.map((viewer) => {
        const elsewhere = viewer.versionId !== versionId;
        const where = elsewhere
          ? `on v${versionLabels[viewer.versionId] ?? "another version"}`
          : viewer.screenId && screenNames[viewer.screenId] ? `on ${screenNames[viewer.screenId]}` : "here";
        const isFollowed = following === viewer.userId;
        const followsYou = followers.includes(viewer.userId);
        const name = viewer.name || "Someone";
        const label = `${name} · ${where}${followsYou ? " · following you" : ""}`;
        const canFollow = !elsewhere;
        const action = isFollowed ? "Stop following" : "Follow their view";
        return (
          <button
            aria-label={canFollow ? `${label}. ${action}` : label}
            aria-pressed={canFollow ? isFollowed : undefined}
            className={"relative rounded-full ring-2 transition-transform hover:z-10 hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-default " + (isFollowed ? "z-10 ring-offset-2 ring-offset-[var(--color-surface,#111)] " : "ring-[var(--color-surface,#111)] ") + (elsewhere ? "opacity-50" : "")}
            disabled={!canFollow}
            key={viewer.userId}
            onClick={() => canFollow && onFollow(viewer.userId)}
            style={isFollowed ? { ["--tw-ring-color" as string]: presenceColor(viewer.userId) } : undefined}
            title={canFollow ? `${label} — click to ${action.toLowerCase()}` : label}
            type="button"
          >
            <Face viewer={viewer} />
            {followsYou ? (
              <span aria-hidden="true" className="absolute -bottom-0.5 -right-0.5 grid size-3 place-items-center rounded-full bg-[var(--color-surface,#111)]">
                <svg className="size-2.5" fill="none" stroke={presenceColor(viewer.userId)} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" viewBox="0 0 12 12"><path d="M1.5 6s1.8-3.2 4.5-3.2S10.5 6 10.5 6 8.7 9.2 6 9.2 1.5 6 1.5 6Z" /><circle cx="6" cy="6" r="1" /></svg>
              </span>
            ) : null}
          </button>
        );
      })}
      {extra > 0 ? <span className="grid size-7 place-items-center rounded-full bg-surface-raised text-[11px] text-foreground-muted ring-2 ring-[var(--color-surface,#111)]" title={ordered.slice(4).map((viewer) => viewer.name).join(", ")}>+{extra}</span> : null}
    </div>
  );
}

function rank(viewer: PresenceViewer, following: string | null, followers: string[]) {
  return (viewer.userId === following ? 2 : 0) + (followers.includes(viewer.userId) ? 1 : 0);
}
