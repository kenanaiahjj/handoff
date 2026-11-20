"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { Avatar } from "@/src/components/Avatar";

const storageKey = "asbir-profile-nudge-dismissed";

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener("asbir-profile-nudge", onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener("asbir-profile-nudge", onChange);
  };
}

function readDismissed() {
  try {
    return localStorage.getItem(storageKey) === "1";
  } catch {
    return false;
  }
}

/**
 * A quiet prompt for people whose profile is missing a photo or what they do (for example everyone
 * who joined before profiles existed). Dismissed once, it stays gone on this device.
 */
export function ProfileNudge({ name, image, missing, href, className = "" }: {
  name: string;
  image: string | null;
  /** What's missing, e.g. ["photo", "title"]; nothing renders when empty. */
  missing: Array<"photo" | "title">;
  href: string;
  className?: string;
}) {
  const dismissed = useSyncExternalStore(subscribe, readDismissed, () => true);
  if (!missing.length || dismissed) return null;

  function dismiss() {
    try {
      localStorage.setItem(storageKey, "1");
    } catch {
      // Storage blocked: it just comes back next visit.
    }
    window.dispatchEvent(new Event("asbir-profile-nudge"));
  }

  const text = missing.includes("photo") && missing.includes("title")
    ? "Add a photo and your title so your team recognises your comments."
    : missing.includes("photo")
      ? "Add a photo so your team recognises your comments."
      : "Add your title and department so people know who to ask.";

  return (
    <div className={"flex flex-wrap items-center gap-3 rounded-panel bg-surface px-4 py-3 " + className}>
      <Avatar name={name} size={32} src={image} />
      <p className="min-w-0 flex-1 basis-40 text-[13px] text-foreground-muted">{text}</p>
      <Link className="dial-button min-h-8 shrink-0 px-3 text-[12px] max-sm:order-last max-sm:ml-11" href={href}>Complete profile</Link>
      <button aria-label="Dismiss" className="grid size-8 shrink-0 place-items-center rounded-control text-foreground-subtle hover:bg-white/[0.06] hover:text-foreground" onClick={dismiss} title="Don't show again" type="button">
        <svg aria-hidden="true" className="size-3.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" viewBox="0 0 16 16"><path d="m4 4 8 8M12 4l-8 8" /></svg>
      </button>
    </div>
  );
}
