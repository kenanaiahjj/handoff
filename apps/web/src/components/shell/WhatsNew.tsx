"use client";

import { useEffect, useRef, useState } from "react";
import { changelog, latestChangelogId, type ChangelogRelease } from "@/src/changelog";

const seenKey = "asbir-whats-new-seen";
const seenEvent = "asbir-whats-new-seen";

const groups = [
  { key: "new", label: "New", tone: "bg-primary/15 text-primary" },
  { key: "improved", label: "Improved", tone: "bg-sky-400/15 text-sky-300" },
  { key: "fixed", label: "Fixed", tone: "bg-emerald-400/15 text-emerald-300" },
] as const;

function releaseDate(id: string) {
  const date = new Date(`${id}T00:00:00`);
  return Number.isNaN(date.getTime()) ? id : date.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

export function markWhatsNewSeen() {
  try {
    if (latestChangelogId) localStorage.setItem(seenKey, latestChangelogId);
  } catch {
    // Storage blocked: the dot shows again next visit.
  }
  window.dispatchEvent(new Event(seenEvent));
}

/** Releases grouped into New, Improved and Fixed, newest first. */
export function ReleaseList({ releases }: { releases: ChangelogRelease[] }) {
  return (
    <ol className="space-y-6">
      {releases.map((release) => (
        <li key={release.id}>
          <h3 className="text-[12px] font-medium text-foreground-subtle">
            <time dateTime={release.id}>{releaseDate(release.id)}</time>
          </h3>
          <div className="mt-2.5 space-y-3">
            {groups.map(({ key, label, tone }) => {
              const items = release[key];
              if (!items?.length) return null;
              return (
                <section aria-label={label} key={key}>
                  <span className={"inline-flex h-5 items-center rounded-full px-2 text-[11px] font-semibold " + tone}>{label}</span>
                  <ul className="mt-1.5 space-y-1.5">
                    {items.map((item) => (
                      <li className="flex gap-2 text-[13px] leading-5 text-foreground-muted" key={item}>
                        <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-foreground-subtle" />
                        <span className="text-pretty">{item}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** A modal with the release notes. Escape, the close button or a click outside closes it. */
export function WhatsNewDialog({ releases = changelog, onClose }: { releases?: ChangelogRelease[]; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    markWhatsNewSeen();
  }, []);
  return (
    <dialog
      aria-labelledby="whats-new-title"
      className="m-auto flex max-h-[min(720px,calc(100dvh-32px))] w-[min(560px,calc(100vw-32px))] flex-col overflow-hidden rounded-[16px] border border-white/[0.09] bg-[#121212] p-0 text-foreground shadow-[0_24px_64px_-12px_rgb(0_0_0/0.85)] backdrop:bg-black/60"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onClose={onClose}
      ref={ref}
    >
      <header className="flex items-center justify-between gap-3 border-b border-white/[0.07] px-5 py-4">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]" id="whats-new-title">What&apos;s new</h2>
        <button
          aria-label="Close"
          className="grid size-8 place-items-center rounded-[8px] text-foreground-subtle transition-colors hover:bg-white/[0.06] hover:text-foreground"
          onClick={onClose}
          type="button"
        >
          <svg aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" viewBox="0 0 16 16"><path d="m4 4 8 8M12 4l-8 8" /></svg>
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <ReleaseList releases={releases} />
      </div>
    </dialog>
  );
}

/** Sidebar button for the full release notes, with a dot until the newest release has been opened. */
export function WhatsNewButton() {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(false);
  useEffect(() => {
    // Read after mount so the server render and the first client render agree.
    const timer = window.setTimeout(() => {
      try {
        setUnread(Boolean(latestChangelogId) && localStorage.getItem(seenKey) !== latestChangelogId);
      } catch {
        setUnread(false);
      }
    }, 0);
    const clear = () => setUnread(false);
    window.addEventListener(seenEvent, clear);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(seenEvent, clear);
    };
  }, []);
  return (
    <>
      <button
        aria-label={unread ? "What's new (unread updates)" : "What's new"}
        className="relative grid size-8 place-items-center rounded-control text-foreground-subtle transition-colors hover:bg-white/[0.07] hover:text-foreground"
        onClick={() => {
          setOpen(true);
          setUnread(false);
        }}
        title="What's new"
        type="button"
      >
        <svg aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" viewBox="0 0 16 16">
          <path d="M7 2.5 8.2 5.8 11.5 7 8.2 8.2 7 11.5 5.8 8.2 2.5 7l3.3-1.2L7 2.5ZM12 10.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6.6-1.4Z" />
        </svg>
        {unread ? <span aria-hidden="true" className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-primary" /> : null}
      </button>
      {open ? <WhatsNewDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}
