"use client";

import Image from "next/image";
import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HandoffTabs, lastScreenHash } from "./HandoffTabs";
import { QuickOpen, type QuickOpenItem } from "./QuickOpen";
import { NeedsYou } from "./NeedsYou";
import { ProjectIcon } from "./ProjectIcon";
import { refreshAppBadge } from "./AppBadgeSync";
import { NotificationSettings } from "./NotificationSettings";
import type { OpenMention } from "@/src/server/services/mentions";
import { SignOutButton } from "@/app/workspace/workspace-actions";
import { WhatsNewDialog } from "./WhatsNew";
import type { ViewerProject } from "@/src/server/services/review-visibility";
import { showErrorToast } from "./Toaster";

type Filter = "all" | "updated";
type HomeView = "tiles" | "list";

const viewKey = "asbir-home-view";
const collapsedKey = "asbir-home-collapsed";

function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function writeLocal(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked (private window); the choice just isn't remembered.
  }
}

/** Small round avatar: the person's Google photo, or their initial. */
function Avatar({ name, image, size = 16 }: { name: string; image: string | null; size?: number }) {
  return image ? (
    // eslint-disable-next-line @next/next/no-img-element -- Google avatar on its own host.
    <img alt="" className="shrink-0 rounded-full object-cover ring-1 ring-white/10" height={size} referrerPolicy="no-referrer" src={image} style={{ width: size, height: size }} width={size} />
  ) : (
    <span aria-hidden="true" className="grid shrink-0 place-items-center rounded-full bg-surface-strong font-semibold text-foreground-muted" style={{ width: size, height: size, fontSize: Math.round(size * 0.55) }}>
      {name.trim().slice(0, 1).toUpperCase() || "?"}
    </span>
  );
}

type ViewerGroupItem = ViewerProject["handoffs"][number] & { workspaceId: string; projectId: string; projectName: string };
type ViewerGroup = { key: string; title: string; iconUrl: string | null; newCount: number; updatedAt: string; projectCount: number; items: ViewerGroupItem[] };

const relativeTime = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function timeAgo(iso: string) {
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
  const steps: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 31536000],
    ["month", 2592000],
    ["week", 604800],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) return relativeTime.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

/** "3 screens changed · 1 new" style summary of what changed since this person last looked. */
function changesLabel(changes: { changed: number; added: number; removed: number }) {
  const parts = [
    changes.changed ? `${changes.changed} ${changes.changed === 1 ? "screen" : "screens"} changed` : "",
    changes.added ? `${changes.added} new` : "",
    changes.removed ? `${changes.removed} removed` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "No visible screen changes";
}

function initials(name: string) {
  return name.trim().split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "?";
}

/**
 * Home for people who review rather than manage: a calm, app-like list of the projects shared with
 * them, each handoff as a tile with its latest screen, and a dot wherever there is something new.
 */
export function ViewerHome({
  homeHref,
  title,
  showWorkspaceNames = false,
  user,
  projects,
  devBypass = false,
  devTools,
  notice,
  pinKeys = [],
  mentions = [],
  designerRequestPending = false,
}: {
  /** Where the logo goes: this workspace, or the combined home. */
  homeHref: string;
  /** Header title: the workspace name, or the app name on the combined home. */
  title: string;
  /** Label each project with its workspace (combined home across workspaces). */
  showWorkspaceNames?: boolean;
  user: { name: string; email: string; image: string | null };
  projects: ViewerProject[];
  /** This person asked for designer access and is waiting for an owner. */
  designerRequestPending?: boolean;
  /** Comments that mention this person and still need a reply. */
  mentions?: OpenMention[];
  /** This person's pins, "workspace:<id>" or "project:<id>", oldest first. */
  pinKeys?: string[];
  /** Development bypass is on: "Sign out" leaves it for this browser. */
  devBypass?: boolean;
  devTools?: ReactNode;
  /** Optional prompt above "Needs you", such as completing your profile. */
  notice?: ReactNode;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);
  const [pins, setPins] = useState(pinKeys);
  const pinKind = showWorkspaceNames ? "workspace" : "project";
  const pinKeyFor = (groupKey: string) => `${pinKind}:${groupKey}`;

  async function togglePin(groupKey: string) {
    const key = pinKeyFor(groupKey);
    const pinned = !pins.includes(key);
    const previous = pins;
    // Move it right away; the server confirms in the background.
    setPins(pinned ? [...pins, key] : pins.filter((pin) => pin !== key));
    try {
      const response = await fetch("/api/me/pins", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: pinKind, targetId: groupKey, pinned }),
      });
      if (!response.ok) throw new Error();
      setPins(((await response.json()) as { pins: string[] }).pins);
    } catch {
      setPins(previous);
      showErrorToast(pinned ? "Couldn't pin that. Try again." : "Couldn't unpin that. Try again.");
    }
  }
  // Handoffs marked as seen on this page, applied right away while the server records them.
  const [seenIds, setSeenIds] = useState<Set<string>>(() => new Set());
  const liveProjects = useMemo(
    () =>
      projects.map((project) => {
        const handoffs = project.handoffs.map((handoff) => (seenIds.has(handoff.handoffId) ? { ...handoff, isNew: false } : handoff));
        return { ...project, handoffs, newCount: handoffs.filter((handoff) => handoff.isNew).length };
      }),
    [projects, seenIds],
  );

  async function markSeen(handoffIds: string[]) {
    if (!handoffIds.length) return;
    setSeenIds((current) => new Set([...current, ...handoffIds]));
    try {
      const response = await fetch("/api/me/seen", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handoffIds }),
      });
      if (!response.ok) throw new Error();
      refreshAppBadge();
    } catch {
      setSeenIds((current) => new Set([...current].filter((id) => !handoffIds.includes(id))));
    }
  }

  // Tiles or a dense list, and which groups are folded away: remembered on this device.
  const [view, setView] = useState<HomeView>("tiles");
  const [collapsed, setCollapsed] = useState<string[]>([]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read from localStorage, only available after mount.
    setView(readLocal<HomeView>(viewKey, "tiles") === "list" ? "list" : "tiles");
    setCollapsed(readLocal<string[]>(collapsedKey, []));
  }, []);
  function chooseView(next: HomeView) {
    setView(next);
    writeLocal(viewKey, next);
  }
  function toggleCollapsed(groupKey: string) {
    setCollapsed((current) => {
      const next = current.includes(groupKey) ? current.filter((key) => key !== groupKey) : [...current, groupKey];
      writeLocal(collapsedKey, next);
      return next;
    });
  }

  // Tiles reopen each handoff on the screen this person last looked at (remembered on this device).
  const [resume, setResume] = useState<Record<string, string>>({});
  useEffect(() => {
    const hashes: Record<string, string> = {};
    for (const project of projects) for (const handoff of project.handoffs) hashes[handoff.handoffId] = lastScreenHash(handoff.handoffId);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read from localStorage, only available after mount.
    setResume(hashes);
  }, [projects]);

  const quickOpenItems = useMemo<QuickOpenItem[]>(
    () =>
      liveProjects.flatMap((project) =>
        project.handoffs.map((handoff) => ({
          id: handoff.handoffId,
          label: handoff.handoffName,
          detail: project.projectName + (handoff.versionLabel ? ` · ${handoff.versionLabel}` : ""),
          href: `/projects/${project.projectId}/handoffs/${handoff.handoffId}${resume[handoff.handoffId] ?? ""}`,
          isNew: handoff.isNew,
        })),
      ),
    [liveProjects, resume],
  );

  const newTotal = liveProjects.reduce((total, project) => total + project.newCount, 0);
  const newIds = liveProjects.flatMap((project) => project.handoffs.filter((handoff) => handoff.isNew).map((handoff) => handoff.handoffId));
  const firstName = user.name.split(" ")[0] ?? "";

  const visibleProjects = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return liveProjects
      .map((project) => ({
        ...project,
        handoffs: project.handoffs.filter(
          (handoff) =>
            (filter === "all" || handoff.isNew) &&
            (!needle || handoff.handoffName.toLowerCase().includes(needle) || project.projectName.toLowerCase().includes(needle)),
        ),
      }))
      .filter((project) => project.handoffs.length);
  }, [liveProjects, filter, query]);

  // Across workspaces, each workspace is one group holding all its handoffs; inside one workspace,
  // each project is a group. Groups with something new come first, then the most recently updated.
  const groups = useMemo(() => {
    const byKey = new Map<string, ViewerGroup>();
    for (const project of visibleProjects) {
      const key = showWorkspaceNames ? project.workspaceId : project.projectId;
      const group = byKey.get(key) ?? {
        key,
        title: showWorkspaceNames ? project.workspaceName : project.projectName,
        iconUrl: showWorkspaceNames ? null : project.iconUrl ?? null,
        newCount: 0,
        updatedAt: project.updatedAt,
        projectCount: 0,
        items: [],
      };
      group.projectCount += 1;
      for (const handoff of project.handoffs) {
        group.items.push({ ...handoff, workspaceId: project.workspaceId, projectId: project.projectId, projectName: project.projectName });
        if (handoff.isNew) group.newCount += 1;
        if (handoff.updatedAt > group.updatedAt) group.updatedAt = handoff.updatedAt;
      }
      byKey.set(key, group);
    }
    const newsThenRecent = <T extends { updatedAt: string }>(news: (item: T) => number) => (a: T, b: T) =>
      news(b) - news(a) || b.updatedAt.localeCompare(a.updatedAt);
    const pinOrder = (group: ViewerGroup) => pins.indexOf(`${showWorkspaceNames ? "workspace" : "project"}:${group.key}`);
    const byNews = newsThenRecent<ViewerGroup>((group) => Math.min(group.newCount, 1));
    return [...byKey.values()]
      .map((group) => ({ ...group, items: group.items.sort(newsThenRecent((item) => Number(item.isNew))) }))
      // Pinned groups first, in the order they were pinned; the rest by news, then recency.
      .sort((a, b) => {
        const pa = pinOrder(a);
        const pb = pinOrder(b);
        if (pa !== -1 || pb !== -1) return (pa === -1 ? Infinity : pa) - (pb === -1 ? Infinity : pb);
        return byNews(a, b);
      });
  }, [visibleProjects, showWorkspaceNames, pins]);

  // Keyboard: "/" search, j/k move between handoffs, Enter opens (native), e marks the focused one seen.
  const searchRef = useRef<HTMLInputElement>(null);
  const markSeenRef = useRef(markSeen);
  useEffect(() => {
    markSeenRef.current = markSeen;
  });
  const onShortcut = useCallback((event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) {
      if (event.key === "Escape" && target === searchRef.current) searchRef.current?.blur();
      return;
    }
    if (event.key === "/") {
      event.preventDefault();
      searchRef.current?.focus();
      return;
    }
    const items = [...document.querySelectorAll<HTMLElement>("[data-home-item]")];
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "j" || event.key === "k") {
      event.preventDefault();
      const next = index === -1 ? 0 : Math.min(Math.max(index + (event.key === "j" ? 1 : -1), 0), items.length - 1);
      items[next].focus();
      items[next].scrollIntoView({ block: "nearest" });
    } else if (event.key === "e" && index !== -1) {
      const id = items[index].dataset.handoffId;
      if (id && items[index].dataset.new === "true") void markSeenRef.current([id]);
    }
  }, []);
  useEffect(() => {
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, [onShortcut]);

  const hrefFor = (handoff: ViewerGroupItem) =>
    handoff.isNew && handoff.changesSinceSeen && handoff.seenVersionId && handoff.latestVersionId
      ? `/projects/${handoff.projectId}/handoffs/${handoff.handoffId}?compare=1&compareFrom=${handoff.seenVersionId}&compareTo=${handoff.latestVersionId}&versionId=${handoff.latestVersionId}`
      : `/projects/${handoff.projectId}/handoffs/${handoff.handoffId}${resume[handoff.handoffId] ?? ""}`;
  const versionText = (label: string | null) => (label ? `${/^\d/.test(label) ? "v" : ""}${label}` : "");

  return (
    <div className="viewer-home min-h-dvh bg-background text-foreground">
      <header className="viewer-home-bar sticky top-0 z-20 border-b border-border">
        <HandoffTabs current={null} homeHref={homeHref} />
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4 sm:px-6">
          <Link aria-label="Asbir Handoff home" className="flex min-w-0 items-center gap-2.5 rounded-[8px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/40" href={homeHref}>
            <Image alt="" className="size-7 rounded-[8px]" height={28} src="/icons/asbir-handoff-v2-180.png" width={28} />
            <span className="truncate text-[14px] font-semibold tracking-[-0.01em]">{title}</span>
          </Link>
          <div className="relative ml-auto">
            <button
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              aria-label="Account"
              className="grid size-8 place-items-center overflow-hidden rounded-full bg-surface-strong text-[11px] font-semibold ring-1 ring-white/10 transition-shadow hover:ring-white/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40"
              onClick={() => setMenuOpen((open) => !open)}
              type="button"
            >
              {user.image ? (
                // eslint-disable-next-line @next/next/no-img-element -- Google avatar on its own host.
                <img alt="" className="size-full object-cover" referrerPolicy="no-referrer" src={user.image} />
              ) : (
                initials(user.name)
              )}
            </button>
            {menuOpen ? (
              <>
                <button aria-hidden="true" className="fixed inset-0 z-10 cursor-default" onClick={() => setMenuOpen(false)} tabIndex={-1} type="button" />
                <div className="dial-popover absolute right-0 top-10 z-20 w-72 p-1.5" role="menu">
                  <div className="px-2.5 py-2">
                    <p className="truncate text-[13px] font-medium">{user.name}</p>
                    <p className="truncate text-[12px] text-foreground-subtle">{user.email}</p>
                  </div>
                  <div className="my-1 h-px bg-border" />
                  <Link className="flex h-8 items-center rounded-[7px] px-2.5 text-[12px] text-foreground hover:bg-white/[0.06]" href="/profile" role="menuitem">Edit profile</Link>
                  <Link className="flex h-8 items-center rounded-[7px] px-2.5 text-[12px] text-foreground hover:bg-white/[0.06]" href="/integrations?open=mcp" role="menuitem">Connect AI tools</Link>
                  <button className="flex h-8 w-full items-center rounded-[7px] px-2.5 text-left text-[12px] text-foreground hover:bg-white/[0.06]" onClick={() => { setMenuOpen(false); setWhatsNewOpen(true); }} role="menuitem" type="button">What&apos;s new</button>
                  <div className="my-1 h-px bg-border" />
                  <NotificationSettings />
                  <div className="my-1 h-px bg-border" />
                  <div className="px-1 pb-1 pt-1.5 [&>button]:w-full [&>button]:justify-start [&>button]:text-left">
                    <SignOutButton devBypass={devBypass} />
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </header>

      <QuickOpen items={quickOpenItems} />
      {whatsNewOpen ? <WhatsNewDialog onClose={() => setWhatsNewOpen(false)} /> : null}
      <main className="mx-auto max-w-5xl px-4 pb-24 pt-8 sm:px-6 sm:pt-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em]">{firstName ? `Hi, ${firstName}` : "Your handoffs"}</h1>
            <p className="mt-1.5 flex items-center gap-2 text-[14px] text-foreground-muted">
              {newTotal ? (
                <>
                  {newTotal === 1 ? "1 handoff has a new version" : `${newTotal} handoffs have new versions`}
                  <span aria-hidden="true" className="text-foreground-subtle">·</span>
                  <button className="text-foreground-subtle underline decoration-border-strong underline-offset-4 transition-colors hover:text-foreground" onClick={() => void markSeen(newIds)} type="button">
                    Mark all as seen
                  </button>
                </>
              ) : projects.length ? (
                "You’re all caught up."
              ) : (
                "Nothing has been shared with you yet."
              )}
            </p>
          </div>
          {projects.length ? (
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <label className="relative min-w-0 flex-1 sm:w-56 sm:flex-none">
                <span className="sr-only">Search handoffs</span>
                <svg aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-foreground-subtle" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" viewBox="0 0 16 16">
                  <circle cx="7" cy="7" r="4.5" />
                  <path d="m10.5 10.5 3 3" />
                </svg>
                <input
                  className="h-8 w-full rounded-control border border-border bg-surface-inset pl-8 pr-2.5 text-[13px] outline-none placeholder:text-foreground-subtle focus-visible:border-foreground/30"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search"
                  ref={searchRef}
                  type="search"
                  value={query}
                />
              </label>
              <div aria-label="Filter handoffs" className="dial-segmented shrink-0" role="group">
                <button aria-pressed={filter === "all"} className="min-h-8 px-2.5 text-[12px]" onClick={() => setFilter("all")} type="button">All</button>
                <button aria-pressed={filter === "updated"} className="min-h-8 px-2.5 text-[12px]" onClick={() => setFilter("updated")} type="button">
                  New{newTotal ? <span className="ml-1 font-mono text-[11px] text-foreground-subtle">{newTotal}</span> : null}
                </button>
              </div>
              <div aria-label="Layout" className="dial-segmented shrink-0" role="group">
                <button aria-label="Tiles" aria-pressed={view === "tiles"} className="grid min-h-8 place-items-center px-2" onClick={() => chooseView("tiles")} title="Tiles" type="button">
                  <svg aria-hidden="true" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 16 16"><rect height="5" rx="1" width="5" x="2.5" y="2.5" /><rect height="5" rx="1" width="5" x="8.5" y="2.5" /><rect height="5" rx="1" width="5" x="2.5" y="8.5" /><rect height="5" rx="1" width="5" x="8.5" y="8.5" /></svg>
                </button>
                <button aria-label="List" aria-pressed={view === "list"} className="grid min-h-8 place-items-center px-2" onClick={() => chooseView("list")} title="List" type="button">
                  <svg aria-hidden="true" className="size-3.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" viewBox="0 0 16 16"><path d="M3 4h10M3 8h10M3 12h10" /></svg>
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {designerRequestPending ? (
          <p className="members-request mt-8 rounded-control px-4 py-3 text-[13px] text-foreground" role="status">
            <span className="font-medium">Designer access requested.</span>
            <span className="text-foreground-muted"> An owner will approve it. Until then you can review what’s shared with you.</span>
          </p>
        ) : null}

        {notice ? <div className="mt-8">{notice}</div> : null}
        <NeedsYou className="mt-10" initial={mentions} />

        {!projects.length ? (
          <div className="mt-16 rounded-panel border border-dashed border-border px-6 py-14 text-center">
            <p className="text-[14px] font-medium">No handoffs yet</p>
            <p className="mx-auto mt-1.5 max-w-sm text-[13px] text-foreground-subtle">When a designer shares a handoff with you, it shows up here with a dot whenever there’s a new version. Until then, look around the Playground below.</p>
          </div>
        ) : !visibleProjects.length ? (
          <p className="mt-16 text-center text-[13px] text-foreground-subtle">
            {filter === "updated" && !query ? "No new versions. You’re all caught up." : "No handoffs match your search."}
          </p>
        ) : (
          <div className="mt-10 space-y-10">
            {groups.map((group) => (
              <section aria-labelledby={`group-${group.key}`} className="viewer-group" data-pinned={pins.includes(pinKeyFor(group.key)) || undefined} key={group.key}>
                <div className="mb-3 flex min-w-0 items-center gap-2.5">
                  <button
                    aria-controls={`group-items-${group.key}`}
                    aria-expanded={!collapsed.includes(group.key)}
                    aria-label={collapsed.includes(group.key) ? `Expand ${group.title}` : `Collapse ${group.title}`}
                    className="-ml-1 grid size-6 shrink-0 place-items-center rounded-[6px] text-foreground-subtle transition-colors hover:bg-surface-inset hover:text-foreground"
                    onClick={() => toggleCollapsed(group.key)}
                    type="button"
                  >
                    <svg aria-hidden="true" className={"size-3.5 transition-transform " + (collapsed.includes(group.key) ? "-rotate-90" : "")} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" viewBox="0 0 16 16"><path d="m4 6 4 4 4-4" /></svg>
                  </button>
                  <ProjectIcon name={group.title} size={24} src={group.iconUrl} />
                  <h2 className="min-w-0 truncate text-[14px] font-semibold tracking-[-0.01em]" id={`group-${group.key}`}>{group.title}</h2>
                  {collapsed.includes(group.key) ? <span className="shrink-0 font-mono text-[11px] text-foreground-subtle">{group.items.length}</span> : null}
                  {group.newCount ? <span className="viewer-count shrink-0 whitespace-nowrap">{group.newCount} new</span> : null}
                  {group.newCount ? (
                    <button
                      className="viewer-mark-seen shrink-0 rounded-[6px] px-1.5 py-0.5 text-[12px] text-foreground-subtle transition-colors hover:bg-surface-inset hover:text-foreground"
                      onClick={() => void markSeen(group.items.filter((item) => item.isNew).map((item) => item.handoffId))}
                      type="button"
                    >
                      Mark seen
                    </button>
                  ) : null}
                  <span aria-hidden="true" className="flex-1 sm:hidden" />
                  <span className="ml-auto hidden shrink-0 text-[12px] text-foreground-subtle sm:inline" suppressHydrationWarning>Updated {timeAgo(group.updatedAt)}</span>
                  <button
                    aria-label={pins.includes(pinKeyFor(group.key)) ? `Unpin ${group.title}` : `Pin ${group.title} to the top`}
                    aria-pressed={pins.includes(pinKeyFor(group.key))}
                    className="viewer-pin grid size-7 shrink-0 place-items-center rounded-[7px] text-foreground-subtle transition-colors hover:bg-surface-inset hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/40"
                    onClick={() => void togglePin(group.key)}
                    title={pins.includes(pinKeyFor(group.key)) ? "Unpin" : "Pin to top"}
                    type="button"
                  >
                    <svg aria-hidden="true" className="size-3.5" fill={pins.includes(pinKeyFor(group.key)) ? "currentColor" : "none"} stroke="currentColor" strokeLinejoin="round" strokeWidth="1.4" viewBox="0 0 16 16">
                      <path d="M6 2.5h4l-.5 4 2.5 2.5H4L6.5 6.5 6 2.5ZM8 9v4.5" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
                {collapsed.includes(group.key) ? null : view === "list" ? (
                  <ul className="viewer-list overflow-hidden rounded-panel border border-border bg-surface" id={`group-items-${group.key}`}>
                    {group.items.map((handoff) => (
                      <li className="border-b border-border last:border-b-0" key={handoff.handoffId}>
                        <Link
                          className="viewer-row group flex min-h-12 items-center gap-3 px-3.5 py-2.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white/40"
                          data-handoff-id={handoff.handoffId}
                          data-home-item=""
                          data-new={handoff.isNew ? "true" : "false"}
                          href={hrefFor(handoff)}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-medium">{handoff.handoffName}</span>
                            {handoff.isNew ? (
                              <span className="block truncate text-[12px] text-[#ffa264]">{handoff.changesSinceSeen ? changesLabel(handoff.changesSinceSeen) : "New version"}</span>
                            ) : null}
                          </span>
                          <span className="hidden shrink-0 font-mono text-[11px] text-foreground-subtle sm:inline">{versionText(handoff.versionLabel)}</span>
                          {handoff.publishedBy ? (
                            <span className="hidden min-w-0 max-w-[10rem] shrink-0 items-center gap-1.5 text-[12px] text-foreground-muted md:flex">
                              <Avatar image={handoff.publishedBy.image} name={handoff.publishedBy.name} />
                              <span className="truncate">{handoff.publishedBy.name.split(" ")[0]}</span>
                            </span>
                          ) : null}
                          <span className="w-20 shrink-0 text-right text-[12px] text-foreground-subtle" suppressHydrationWarning>{timeAgo(handoff.updatedAt)}</span>
                          <svg aria-hidden="true" className="size-4 shrink-0 text-foreground-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" viewBox="0 0 16 16"><path d="m6 3 5 5-5 5" /></svg>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 lg:grid-cols-3" id={`group-items-${group.key}`}>
                  {group.items.map((handoff) => (
                    <li key={handoff.handoffId}>
                      <Link
                        className="viewer-tile group block overflow-hidden rounded-panel border border-border bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40"
                        data-handoff-id={handoff.handoffId}
                        data-home-item=""
                        data-new={handoff.isNew ? "true" : "false"}
                        href={hrefFor(handoff)}
                      >
                        <div className="viewer-tile-preview relative bg-surface-inset aspect-[16/10] overflow-hidden">
                          {handoff.previewUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element -- served by our asset route with its own caching.
                            <img alt="" className="absolute inset-x-0 top-3 mx-auto h-[calc(100%-12px)] w-auto max-w-[85%] rounded-t-[6px] object-cover object-top shadow-lg shadow-black/50 transition-transform duration-300 group-hover:-translate-y-1" decoding="async" loading="lazy" src={handoff.previewUrl} />
                          ) : (
                            <span className="absolute inset-0 grid place-items-center text-[12px] text-foreground-subtle">No screens yet</span>
                          )}
                          {handoff.isNew ? (
                            <span className="absolute left-2.5 top-2.5 inline-flex items-center rounded-[6px] bg-black/75 px-2 py-1 text-[11px] font-medium text-[#ffa264] backdrop-blur">
                              {handoff.changesSinceSeen ? changesLabel(handoff.changesSinceSeen) : "New version"}
                            </span>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-2 border-t border-border px-3.5 py-3">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-medium">{handoff.handoffName}</span>
                            <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[12px] text-foreground-subtle" suppressHydrationWarning>
                              {handoff.publishedBy ? <Avatar image={handoff.publishedBy.image} name={handoff.publishedBy.name} /> : null}
                              <span className="truncate">
                                {showWorkspaceNames ? `${handoff.projectName} · ` : ""}
                                {handoff.publishedBy ? `${handoff.publishedBy.name.split(" ")[0]} · ` : ""}
                                {handoff.versionLabel ? `${versionText(handoff.versionLabel)} · ` : ""}
                                {timeAgo(handoff.updatedAt)}
                              </span>
                            </span>
                          </span>
                          <svg aria-hidden="true" className="size-4 shrink-0 text-foreground-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" viewBox="0 0 16 16">
                            <path d="m6 3 5 5-5 5" />
                          </svg>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
                )}
              </section>
            ))}
          </div>
        )}
        {!query && filter === "all" ? <PlaygroundTile /> : null}
        {projects.length ? (
          <p className="touch-hidden mt-14 hidden text-center text-[12px] text-foreground-subtle sm:block">
            <kbd className="onboarding-kbd">/</kbd> search · <kbd className="onboarding-kbd">j</kbd> <kbd className="onboarding-kbd">k</kbd> move ·{" "}
            <kbd className="onboarding-kbd">↵</kbd> open · <kbd className="onboarding-kbd">e</kbd> mark seen · <kbd className="onboarding-kbd">⌘K</kbd> jump to
          </p>
        ) : null}
        {devTools ? <div className="mt-16 max-w-xs">{devTools}</div> : null}
      </main>
    </div>
  );
}

/** The shared sample project (app/playground), so this page always has something to open. */
function PlaygroundTile() {
  return (
    <section aria-labelledby="group-playground" className="viewer-group mt-10">
      <div className="mb-3 flex min-w-0 items-center gap-2.5">
        <h2 className="truncate text-[14px] font-semibold" id="group-playground">Playground</h2>
        <span className="text-[12px] text-foreground-subtle">A sample app to try every feature on</span>
      </div>
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <li>
          <Link
            className="viewer-tile group block overflow-hidden rounded-panel border border-border bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40"
            href="/playground"
          >
            <div className="viewer-tile-preview relative aspect-[16/10] overflow-hidden bg-surface-inset">
              {/* eslint-disable-next-line @next/next/no-img-element -- a small static image written by scripts/playground/build.mjs. */}
              <img alt="" className="absolute inset-0 size-full object-cover transition-transform duration-300 group-hover:scale-[1.02]" decoding="async" loading="lazy" src="/playground-preview.png" />
              <span className="absolute left-2.5 top-2.5 rounded-full bg-[#ff8a3d] px-2 py-0.5 text-[11px] font-semibold text-[#1b1006]">Sample</span>
            </div>
            <div className="flex items-center gap-2 border-t border-border px-3.5 py-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">Penny app</span>
                <span className="mt-1 block truncate text-[12px] text-foreground-subtle">Review changes, Compare, Inspect and comments</span>
              </span>
              <svg aria-hidden="true" className="size-4 shrink-0 text-foreground-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" viewBox="0 0 16 16">
                <path d="m6 3 5 5-5 5" />
              </svg>
            </div>
          </Link>
        </li>
      </ul>
    </section>
  );
}
