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

/** Who else has this handoff open. Clicking someone zooms to the screen they're on. */
export function PresenceAvatars({ viewers, versionId, versionLabels, screenNames, onJump }: {
  viewers: PresenceViewer[];
  versionId: string;
  versionLabels: Record<string, string>;
  screenNames: Record<string, string>;
  onJump: (screenId: string) => void;
}) {
  if (!viewers.length) return null;
  const shown = viewers.slice(0, 4);
  const extra = viewers.length - shown.length;
  return (
    <div aria-label={`${viewers.length} other ${viewers.length === 1 ? "person" : "people"} here`} className="flex items-center -space-x-1.5" role="group">
      {shown.map((viewer) => {
        const elsewhere = viewer.versionId !== versionId;
        const where = elsewhere
          ? `on v${versionLabels[viewer.versionId] ?? "another version"}`
          : viewer.screenId && screenNames[viewer.screenId] ? `on ${screenNames[viewer.screenId]}` : "here";
        const label = `${viewer.name || "Someone"} · ${where}`;
        const canJump = !elsewhere && viewer.screenId && screenNames[viewer.screenId];
        return (
          <button
            aria-label={canJump ? `${label}. Go to their screen` : label}
            className={"relative rounded-full ring-2 ring-[var(--color-surface,#111)] transition-transform hover:z-10 hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-default " + (elsewhere ? "opacity-50" : "")}
            disabled={!canJump}
            key={viewer.userId}
            onClick={() => canJump && onJump(viewer.screenId!)}
            title={label}
            type="button"
          >
            <Face viewer={viewer} />
          </button>
        );
      })}
      {extra > 0 ? <span className="grid size-7 place-items-center rounded-full bg-surface-raised text-[11px] text-foreground-muted ring-2 ring-[var(--color-surface,#111)]" title={viewers.slice(4).map((viewer) => viewer.name).join(", ")}>+{extra}</span> : null}
    </div>
  );
}
