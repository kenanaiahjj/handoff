"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/** One open handoff, remembered on this device. */
export type OpenTab = { id: string; href: string; title: string; project: string };

const tabsKey = "asbir-open-tabs";
const lastScreenKey = (handoffId: string) => `asbir-last-screen:${handoffId}`;
const maxTabs = 8;

function readTabs(): OpenTab[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(tabsKey) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((tab) => tab && typeof tab.id === "string" && typeof tab.href === "string") : [];
  } catch {
    return [];
  }
}

function writeTabs(tabs: OpenTab[]) {
  try {
    localStorage.setItem(tabsKey, JSON.stringify(tabs));
  } catch {
    // Storage blocked (private window); tabs just don't persist.
  }
}

/** The screen this person last looked at in a handoff, as a "#screen=…" hash, if any. */
export function lastScreenHash(handoffId: string) {
  try {
    return localStorage.getItem(lastScreenKey(handoffId)) ?? "";
  } catch {
    return "";
  }
}

/** Remembers the screen being viewed in this handoff so tabs and the home reopen there. */
function useRememberScreen(handoffId: string | null) {
  useEffect(() => {
    if (!handoffId) return;
    const id = handoffId;
    function save() {
      try {
        if (location.hash.startsWith("#screen=")) localStorage.setItem(lastScreenKey(id), location.hash);
      } catch {
        // Storage blocked; nothing to remember.
      }
    }
    save();
    window.addEventListener("hashchange", save);
    window.addEventListener("handofflocationchange", save);
    return () => {
      window.removeEventListener("hashchange", save);
      window.removeEventListener("handofflocationchange", save);
    };
  }, [handoffId]);
}

/**
 * Figma-style tabs for handoffs opened on this device. On a handoff the bar appears once two or
 * more are open (a single handoff keeps the full canvas height); on the home screens (`current`
 * null, Home is the active tab) it shows whenever any handoff is still open.
 */
export function HandoffTabs({ current, homeHref }: { current: OpenTab | null; homeHref: string }) {
  const router = useRouter();
  const [tabs, setTabs] = useState<OpenTab[] | null>(null);
  useRememberScreen(current?.id ?? null);

  useEffect(() => {
    const existing = readTabs();
    if (!current) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- tabs live in localStorage, only readable after mount.
      setTabs(existing);
      return;
    }
    const index = existing.findIndex((tab) => tab.id === current.id);
    const next = index === -1 ? [...existing, current].slice(-maxTabs) : existing.map((tab) => (tab.id === current.id ? current : tab));
    writeTabs(next);
    setTabs(next);
  }, [current]);

  function close(id: string) {
    const list = tabs ?? [];
    const index = list.findIndex((tab) => tab.id === id);
    const next = list.filter((tab) => tab.id !== id);
    writeTabs(next);
    setTabs(next);
    if (current && id === current.id) {
      const neighbour = next[Math.min(index, next.length - 1)];
      router.push(neighbour ? neighbour.href + lastScreenHash(neighbour.id) : homeHref);
    }
  }

  if (!tabs || tabs.length < (current ? 2 : 1)) return null;

  return (
    <nav aria-label="Open handoffs" className="handoff-tabs flex h-9 shrink-0 items-end gap-1 overflow-x-auto border-b border-border bg-background px-1.5">
      <Link
        aria-current={current ? undefined : "page"}
        aria-label="Home"
        className={"mb-1 grid size-7 shrink-0 place-items-center rounded-[7px] transition-colors hover:bg-surface-inset hover:text-foreground " + (current ? "text-foreground-subtle" : "bg-surface-inset text-foreground")}
        href={homeHref}
        title="Home"
      >
        <svg aria-hidden="true" className="size-3.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" viewBox="0 0 16 16">
          <path d="M2.5 7 8 2.5 13.5 7v6.5h-3.5V10h-4v3.5H2.5Z" />
        </svg>
      </Link>
      {tabs.map((tab) => {
        const active = tab.id === current?.id;
        return (
          <div
            className="handoff-tab group relative flex h-8 min-w-0 max-w-[220px] shrink-0 items-center rounded-t-[8px]"
            data-active={active || undefined}
            key={tab.id}
            onAuxClick={(event) => {
              if (event.button === 1) {
                event.preventDefault();
                close(tab.id);
              }
            }}
          >
            <Link
              aria-current={active ? "page" : undefined}
              className="flex min-w-0 flex-1 items-baseline gap-1.5 py-1.5 pl-3 pr-1 text-[12px]"
              href={tab.href + lastScreenHash(tab.id)}
              title={`${tab.project} · ${tab.title}`}
            >
              <span className="truncate font-medium text-foreground">{tab.title}</span>
              <span className="hidden truncate text-foreground-subtle sm:inline">{tab.project}</span>
            </Link>
            <button
              aria-label={`Close ${tab.title}`}
              className="handoff-tab-close mr-1 grid size-5 shrink-0 place-items-center rounded-[5px] text-foreground-subtle hover:bg-surface-raised hover:text-foreground"
              onClick={() => close(tab.id)}
              type="button"
            >
              <svg aria-hidden="true" className="size-3" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" viewBox="0 0 16 16">
                <path d="m4.5 4.5 7 7m0-7-7 7" />
              </svg>
            </button>
          </div>
        );
      })}
    </nav>
  );
}
