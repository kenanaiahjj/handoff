"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { CanvasLoadingSkeleton } from "@/src/components/canvas/CanvasLoadingSkeleton";

const handoffPath = /^\/workspace\/[^/]+\/projects\/[^/]+\/handoffs\/[^/]+\/?$/;

/**
 * Opening a handoff waits for the server before the page changes, which felt frozen. On a plain
 * click of any link into a handoff, show the canvas skeleton straight away; the real page replaces
 * it as soon as it arrives.
 */
export function CanvasNavigationOverlay() {
  const pathname = usePathname();
  const [pendingFrom, setPendingFrom] = useState<string | null>(null);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      // Next.js links cancel the default click to navigate client-side, so don't skip prevented clicks.
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || (link.target && link.target !== "_self") || link.hasAttribute("download")) return;
      const url = new URL(link.href, location.href);
      if (url.origin !== location.origin || !handoffPath.test(url.pathname) || url.pathname === location.pathname) return;
      setPendingFrom(location.pathname);
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // Hide once the route changes, or after a while if the navigation never happened.
  const visible = pendingFrom !== null && pendingFrom === pathname;
  useEffect(() => {
    if (pendingFrom === null) return;
    if (pendingFrom !== pathname) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset once the new page is showing.
      setPendingFrom(null);
      return;
    }
    const timer = window.setTimeout(() => setPendingFrom(null), 20_000);
    return () => window.clearTimeout(timer);
  }, [pathname, pendingFrom]);

  if (!visible) return null;
  return (
    <div className="fixed inset-0 z-[55]">
      <CanvasLoadingSkeleton />
    </div>
  );
}
