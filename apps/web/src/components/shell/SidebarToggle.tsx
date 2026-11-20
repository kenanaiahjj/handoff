"use client";

import { useEffect, useState } from "react";

const storageKey = "asbir.workspace.sidebar";

function windowElement() {
  return document.querySelector<HTMLElement>(".workspace-window");
}

/**
 * Hides or shows the workspace sidebar on tablet and desktop widths. The choice is remembered per
 * browser; the collapsed layout itself lives in CSS (`.workspace-window[data-sidebar="collapsed"]`).
 */
export function SidebarToggle() {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let saved = false;
    try {
      saved = localStorage.getItem(storageKey) === "collapsed";
    } catch {
      // Storage blocked: start expanded.
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is only readable after mount.
    setCollapsed(saved);
  }, []);

  useEffect(() => {
    const element = windowElement();
    if (!element) return;
    if (collapsed) element.dataset.sidebar = "collapsed";
    else delete element.dataset.sidebar;
  }, [collapsed]);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      if (next) localStorage.setItem(storageKey, "collapsed");
      else localStorage.removeItem(storageKey);
    } catch {
      // The layout still changes for this page.
    }
  }

  return (
    <button
      aria-label={collapsed ? "Show sidebar" : "Hide sidebar"}
      aria-pressed={!collapsed}
      className="hidden size-9 shrink-0 place-items-center rounded-control text-foreground-muted transition-colors hover:bg-surface-inset hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary md:grid"
      onClick={toggle}
      title={collapsed ? "Show sidebar" : "Hide sidebar"}
      type="button"
    >
      <svg aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" viewBox="0 0 16 16">
        <rect height="10" rx="1.5" width="12" x="2" y="3" />
        <path d="M6 3v10" />
      </svg>
    </button>
  );
}
