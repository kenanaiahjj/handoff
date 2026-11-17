"use client";

import { useEffect } from "react";

/** Fire after anything that changes the count (mark seen, mention done) to update the icon now. */
export const badgeRefreshEvent = "asbir:badge-refresh";
export function refreshAppBadge() {
  window.dispatchEvent(new Event(badgeRefreshEvent));
}

type BadgeNavigator = Navigator & { setAppBadge?: (count?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };

/**
 * Shows the number of new versions plus open mentions on the installed app's icon (Dock, taskbar),
 * like a chat app. Browsers without the Badging API simply skip it.
 */
export function AppBadgeSync() {
  useEffect(() => {
    const nav = navigator as BadgeNavigator;
    if (!nav.setAppBadge) return;
    let cancelled = false;

    async function sync() {
      try {
        const response = await fetch("/api/me/badge", { cache: "no-store" });
        if (!response.ok || cancelled) return;
        const { count } = (await response.json()) as { count: number };
        if (count > 0) await nav.setAppBadge?.(count);
        else await nav.clearAppBadge?.();
      } catch {
        // Offline or signed out; leave the badge as it is.
      }
    }

    void sync();
    const interval = window.setInterval(sync, 5 * 60 * 1000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void sync();
    };
    window.addEventListener("focus", sync);
    window.addEventListener(badgeRefreshEvent, sync);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", sync);
      window.removeEventListener(badgeRefreshEvent, sync);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return null;
}
