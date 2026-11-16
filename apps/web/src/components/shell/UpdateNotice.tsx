"use client";

import { useEffect, useState } from "react";

const loadedBuildId = process.env.NEXT_PUBLIC_ASBIR_BUILD_ID ?? null;
const checkEveryMs = 10 * 60 * 1000;

/** A newer deployment is live when the server's build differs from the one this window loaded. */
async function newBuildAvailable() {
  if (!loadedBuildId) return false;
  const response = await fetch("/api/app-version", { cache: "no-store" });
  if (!response.ok) return false;
  const { buildId } = (await response.json()) as { buildId: string | null };
  return Boolean(buildId) && buildId !== loadedBuildId;
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

/** Shows a small "update available" pill with Reload, for installed apps that have no reload shortcut. */
export function UpdateNotice() {
  const [available, setAvailable] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let checking = false;
    async function check() {
      if (checking || document.visibilityState !== "visible") return;
      checking = true;
      try {
        const outdated = (await newBuildAvailable()) || (process.env.NODE_ENV === "development" && (await stylesOutOfDate()));
        if (outdated && !cancelled) {
          setAvailable(true);
          setDismissed(false);
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

  if (!available || dismissed) return null;

  return (
    <div aria-live="polite" className="update-notice pointer-events-none fixed inset-x-0 top-0 z-[60] flex justify-center px-4 pt-[max(12px,env(safe-area-inset-top))]">
      <div className="dial-popover pointer-events-auto flex items-center gap-3 py-1.5 pl-3.5 pr-1.5" role="status">
        <span aria-hidden="true" className="viewer-dot" />
        <span className="text-[13px] text-foreground">A new version is available</span>
        <button
          className="h-8 rounded-[8px] bg-[#f4f4f4] px-3 text-[12px] font-medium text-[#161616] transition-colors hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60"
          onClick={() => window.location.reload()}
          type="button"
        >
          Reload
        </button>
        <button
          aria-label="Dismiss"
          className="grid size-8 place-items-center rounded-[8px] text-foreground-subtle transition-colors hover:bg-surface-inset hover:text-foreground"
          onClick={() => setDismissed(true)}
          type="button"
        >
          <svg aria-hidden="true" className="size-3.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" viewBox="0 0 16 16">
            <path d="m4 4 8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
    </div>
  );
}
