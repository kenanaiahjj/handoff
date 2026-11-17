"use client";

import { RetryingImg } from "./RetryingImage";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

export type MobileScreen = { id: string; name: string; imageUrl: string; width: number; height: number; changed: boolean };

const canvasPreferenceKey = "asbir-mobile-canvas";

/**
 * Phone review: one screen at a time, swipe sideways between screens, scroll down long ones.
 * Shown below tablet width; "Open canvas" switches to the full canvas for comments and inspecting.
 */
export function MobileReview({
  handoffName,
  versionLabel,
  backHref,
  screens,
}: {
  handoffName: string;
  versionLabel: string;
  backHref: string;
  screens: MobileScreen[];
}) {
  const [showCanvas, setShowCanvas] = useState(false);
  const [changedOnly, setChangedOnly] = useState(false);
  const [index, setIndex] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const changedCount = screens.filter((screen) => screen.changed).length;
  const visible = useMemo(() => (changedOnly ? screens.filter((screen) => screen.changed) : screens), [changedOnly, screens]);

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- per-tab choice, only readable after mount.
      setShowCanvas(sessionStorage.getItem(canvasPreferenceKey) === "1");
    } catch {
      // Storage blocked; start in the swipe view.
    }
  }, []);

  // Keep the counter in step with swiping.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const onScroll = () => setIndex(Math.round(track.scrollLeft / Math.max(track.clientWidth, 1)));
    track.addEventListener("scroll", onScroll, { passive: true });
    return () => track.removeEventListener("scroll", onScroll);
  }, [visible]);

  function goTo(next: number) {
    const track = trackRef.current;
    if (!track) return;
    const clamped = Math.max(0, Math.min(next, visible.length - 1));
    track.scrollTo({ left: clamped * track.clientWidth, behavior: "smooth" });
  }

  function openCanvas() {
    setShowCanvas(true);
    try {
      sessionStorage.setItem(canvasPreferenceKey, "1");
    } catch {
      // Not remembered; fine.
    }
  }

  if (showCanvas) return null;
  const current = visible[Math.min(index, visible.length - 1)];

  return (
    <div className="mobile-review fixed inset-0 z-[55] flex flex-col bg-background text-foreground md:hidden">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-2 pt-[env(safe-area-inset-top)]">
        <Link aria-label="Back to home" className="grid size-10 shrink-0 place-items-center rounded-[10px] text-foreground-muted active:bg-surface-inset" href={backHref}>
          <svg aria-hidden="true" className="size-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" viewBox="0 0 16 16">
            <path d="M10 3 5 8l5 5" />
          </svg>
        </Link>
        <div className="min-w-0 flex-1 py-2">
          <p className="truncate text-[14px] font-semibold">{handoffName}</p>
          <p className="truncate text-[12px] text-foreground-subtle">Version {versionLabel}</p>
        </div>
        <button className="dial-button min-h-9 shrink-0 px-3 text-[12px]" onClick={openCanvas} type="button">
          Open canvas
        </button>
      </header>

      {changedCount ? (
        <div className="flex shrink-0 items-center gap-2 px-3 py-2">
          <div aria-label="Which screens" className="dial-segmented" role="group">
            <button aria-pressed={!changedOnly} className="min-h-8 px-3 text-[12px]" onClick={() => { setChangedOnly(false); trackRef.current?.scrollTo({ left: 0 }); }} type="button">
              All {screens.length}
            </button>
            <button aria-pressed={changedOnly} className="min-h-8 px-3 text-[12px]" onClick={() => { setChangedOnly(true); trackRef.current?.scrollTo({ left: 0 }); }} type="button">
              Changed {changedCount}
            </button>
          </div>
        </div>
      ) : null}

      <div aria-label="Screens" aria-roledescription="carousel" className="mobile-review-track flex min-h-0 flex-1 overflow-x-auto overflow-y-hidden" ref={trackRef}>
        {visible.map((screen, position) => (
          <section
            aria-label={`${screen.name}, ${position + 1} of ${visible.length}`}
            aria-roledescription="slide"
            className="mobile-review-slide h-full w-full shrink-0 overflow-y-auto overscroll-contain px-4 pb-6 pt-3"
            key={screen.id}
          >
            <RetryingImg
              alt={screen.name}
              className="mx-auto block h-auto w-full max-w-[480px] rounded-[10px] shadow-[0_12px_32px_-12px_rgb(0_0_0/0.8)] ring-1 ring-white/10"
              decoding="async"
              height={screen.height}
              loading={position < 2 ? "eager" : "lazy"}
              src={screen.imageUrl}
              width={screen.width}
            />
          </section>
        ))}
      </div>

      <footer className="flex shrink-0 items-center gap-2 border-t border-border px-2 py-2 pb-[max(8px,env(safe-area-inset-bottom))]">
        <button aria-label="Previous screen" className="grid size-10 shrink-0 place-items-center rounded-[10px] text-foreground-muted active:bg-surface-inset disabled:opacity-30" disabled={index <= 0} onClick={() => goTo(index - 1)} type="button">
          <svg aria-hidden="true" className="size-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" viewBox="0 0 16 16"><path d="M10 3 5 8l5 5" /></svg>
        </button>
        <div aria-live="polite" className="min-w-0 flex-1 text-center">
          <p className="truncate text-[13px] font-medium">
            {current?.changed ? <span className="mr-1.5 rounded-[5px] bg-[#ffa264]/15 px-1.5 py-0.5 align-middle text-[10px] font-medium text-[#ffa264]">Changed</span> : null}
            {current?.name ?? "No screens"}
          </p>
          <p className="text-[11px] text-foreground-subtle">{visible.length ? `${Math.min(index, visible.length - 1) + 1} / ${visible.length}` : ""}</p>
        </div>
        <button aria-label="Next screen" className="grid size-10 shrink-0 place-items-center rounded-[10px] text-foreground-muted active:bg-surface-inset disabled:opacity-30" disabled={index >= visible.length - 1} onClick={() => goTo(index + 1)} type="button">
          <svg aria-hidden="true" className="size-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" viewBox="0 0 16 16"><path d="m6 3 5 5-5 5" /></svg>
        </button>
      </footer>
    </div>
  );
}
