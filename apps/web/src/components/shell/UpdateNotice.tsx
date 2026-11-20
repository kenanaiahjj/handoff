"use client";

import { useEffect, useState } from "react";
import { latestChangelogId, type ChangelogRelease } from "@/src/changelog";
import { WhatsNewDialog } from "./WhatsNew";

const loadedBuildId = process.env.NEXT_PUBLIC_ASBIR_BUILD_ID ?? null;
const loadedCommit = process.env.NEXT_PUBLIC_ASBIR_COMMIT || null;
const checkEveryMs = 10 * 60 * 1000;
const laterMs = 60 * 60 * 1000;
const hiddenKey = "asbir-update-hidden";

type Update = { buildId: string | null; version: string | null; changes: number | null; notes: string[]; releases?: ChangelogRelease[] };

/** A newer deployment is live when the server's build differs from the one this window loaded. */
async function newBuild(): Promise<Update | null> {
  if (!loadedBuildId) return null;
  const params = new URLSearchParams();
  if (loadedCommit) params.set("since", loadedCommit);
  if (latestChangelogId) params.set("seen", latestChangelogId);
  const query = params.size ? `?${params}` : "";
  const response = await fetch(`/api/app-version${query}`, { cache: "no-store" });
  if (!response.ok) return null;
  const update = (await response.json()) as Update;
  return update.buildId && update.buildId !== loadedBuildId ? update : null;
}

/** "Later" hides the card for an hour; the close button hides it until an even newer build. */
function isHidden(buildId: string | null) {
  try {
    const hidden = JSON.parse(sessionStorage.getItem(hiddenKey) ?? "null") as { buildId: string | null; until: number } | null;
    return Boolean(hidden && hidden.buildId === buildId && hidden.until > Date.now());
  } catch {
    return false;
  }
}

function hide(buildId: string | null, forMs: number) {
  try {
    sessionStorage.setItem(hiddenKey, JSON.stringify({ buildId, until: Date.now() + forMs }));
  } catch {
    // Storage blocked: the card is hidden until this window reloads.
  }
}

/**
 * Development: hot reload sometimes misses a style change, leaving a window with old styles under
 * the same stylesheet URL. Compare the rules this window has with a fresh copy of each stylesheet.
 */
async function stylesOutOfDate() {
  const sheets = [...document.styleSheets].filter((sheet) => sheet.href && new URL(sheet.href).origin === location.origin);
  for (const sheet of sheets) {
    let loadedRules: number;
    try {
      loadedRules = sheet.cssRules.length;
    } catch {
      continue;
    }
    const response = await fetch(sheet.href!, { cache: "no-store" });
    if (!response.ok) continue;
    const fresh = new CSSStyleSheet();
    fresh.replaceSync(await response.text());
    if (fresh.cssRules.length !== loadedRules) return true;
  }
  return false;
}

/** A "new version is ready" card with what changed, for installed apps that have no reload shortcut. */
export function UpdateNotice() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [hidden, setHidden] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [releasesOpen, setReleasesOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let checking = false;
    async function check() {
      if (checking || document.visibilityState !== "visible") return;
      checking = true;
      try {
        let found = await newBuild();
        if (!found && process.env.NODE_ENV === "development" && (await stylesOutOfDate())) {
          found = { buildId: "styles", version: null, changes: null, notes: [] };
        }
        if (found && !cancelled) {
          setUpdate(found);
          setHidden(isHidden(found.buildId));
        }
      } catch {
        // Offline or mid-restart; try again on the next check.
      } finally {
        checking = false;
      }
    }

    const initial = window.setTimeout(check, 4000);
    const interval = window.setInterval(check, checkEveryMs);
    const onVisible = () => void check();
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearTimeout(initial);
      window.clearInterval(interval);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (!update || hidden) return null;

  const dismiss = (forMs: number) => {
    hide(update.buildId, forMs);
    setHidden(true);
  };
  const title = update.version ? `Asbir Handoff ${update.version} is ready` : "A new version of Asbir Handoff is ready";
  const releases = update.releases ?? [];
  const changes = update.changes ? `${update.changes} ${update.changes === 1 ? "change" : "changes"} since your version. ` : "";

  return (
    <div aria-live="polite" className="update-notice pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex justify-center px-4 pb-[max(16px,env(safe-area-inset-bottom))] sm:justify-end sm:px-6 sm:pb-6">
      <section aria-labelledby="update-notice-title" className="update-card pointer-events-auto relative w-full max-w-[420px] rounded-[16px] border border-white/[0.09] bg-[#121212] p-5 shadow-[0_24px_64px_-12px_rgb(0_0_0/0.85)]" role="status">
        <button
          aria-label="Close"
          className="absolute right-3 top-3 grid size-8 place-items-center rounded-[8px] text-foreground-subtle transition-colors hover:bg-white/[0.06] hover:text-foreground"
          onClick={() => dismiss(30 * 24 * laterMs)}
          type="button"
        >
          <svg aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" viewBox="0 0 16 16">
            <path d="m4 4 8 8M12 4l-8 8" />
          </svg>
        </button>
        <h2 className="pr-8 text-[15px] font-semibold tracking-[-0.01em] text-foreground" id="update-notice-title">{title}</h2>
        <p className="mt-1.5 text-pretty text-[13px] leading-5 text-foreground-muted">
          {changes}Reloading takes a moment, and anything you&apos;ve posted is already saved.
        </p>
        {showNotes && update.notes.length ? (
          <ul className="update-notes mt-3 max-h-48 space-y-1.5 overflow-y-auto border-t border-white/[0.07] pt-3 text-[12px] leading-[18px] text-foreground-muted">
            {update.notes.map((note, index) => (
              <li className="flex gap-2" key={index}>
                <span aria-hidden="true" className="mt-[7px] size-1 shrink-0 rounded-full bg-foreground-subtle" />
                <span>{note}</span>
              </li>
            ))}
            {update.changes && update.changes > update.notes.length ? (
              <li className="pl-3 text-foreground-subtle">and {update.changes - update.notes.length} more</li>
            ) : null}
          </ul>
        ) : null}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            className="h-9 rounded-[10px] bg-[#ececec] px-4 text-[13px] font-semibold text-[#141414] transition-[background-color,transform] hover:bg-white active:scale-[0.97] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60"
            onClick={() => window.location.reload()}
            type="button"
          >
            Update now
          </button>
          {releases.length ? (
            <button
              className="inline-flex h-9 items-center rounded-[10px] bg-white/[0.07] px-3.5 text-[13px] font-medium text-foreground transition-[background-color,transform] hover:bg-white/[0.11] active:scale-[0.97]"
              onClick={() => setReleasesOpen(true)}
              type="button"
            >
              What&apos;s new
            </button>
          ) : update.notes.length ? (
            <button
              aria-expanded={showNotes}
              className="inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-white/[0.07] px-3.5 text-[13px] font-medium text-foreground transition-[background-color,transform] hover:bg-white/[0.11] active:scale-[0.97]"
              onClick={() => setShowNotes((value) => !value)}
              type="button"
            >
              What&apos;s new
              <svg aria-hidden="true" className={"size-3.5 text-foreground-subtle transition-transform " + (showNotes ? "rotate-90" : "")} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" viewBox="0 0 16 16">
                <path d="m6 3.5 4.5 4.5L6 12.5" />
              </svg>
            </button>
          ) : null}
          <button
            className="h-9 rounded-[10px] px-3 text-[13px] font-medium text-foreground-muted transition-colors hover:text-foreground"
            onClick={() => dismiss(laterMs)}
            type="button"
          >
            Later
          </button>
        </div>
      </section>
      {releasesOpen ? <span className="pointer-events-auto"><WhatsNewDialog onClose={() => setReleasesOpen(false)} releases={releases} /></span> : null}
    </div>
  );
}
