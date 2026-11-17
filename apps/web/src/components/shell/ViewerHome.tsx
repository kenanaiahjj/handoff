"use client";

import Image from "next/image";
import Link from "next/link";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { lastScreenHash } from "./HandoffTabs";
import { QuickOpen, type QuickOpenItem } from "./QuickOpen";
import { NeedsYou } from "./NeedsYou";
import type { OpenMention } from "@/src/server/services/mentions";
import { SignOutButton } from "@/app/workspace/workspace-actions";
import type { ViewerProject } from "@/src/server/services/review-visibility";

type Filter = "all" | "updated";

type ViewerGroupItem = ViewerProject["handoffs"][number] & { workspaceId: string; projectId: string; projectName: string };
type ViewerGroup = { key: string; title: string; newCount: number; updatedAt: string; projectCount: number; items: ViewerGroupItem[] };

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
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
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
    } catch {
      setSeenIds((current) => new Set([...current].filter((id) => !handoffIds.includes(id))));
    }
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
          href: `/workspace/${project.workspaceId}/projects/${project.projectId}/handoffs/${handoff.handoffId}${resume[handoff.handoffId] ?? ""}`,
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

  return (
    <div className="viewer-home min-h-dvh bg-background text-foreground">
      <header className="viewer-home-bar sticky top-0 z-20 border-b border-border">
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
                <div className="dial-popover absolute right-0 top-10 z-20 w-64 p-1.5" role="menu">
                  <div className="px-2.5 py-2">
                    <p className="truncate text-[13px] font-medium">{user.name}</p>
                    <p className="truncate text-[12px] text-foreground-subtle">{user.email}</p>
                  </div>
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
      <main className="mx-auto max-w-5xl px-4 pb-24 pt-8 sm:px-6 sm:pt-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em]">{firstName ? `Hi, ${firstName}` : "Your handoffs"}</h1>
            <p className="mt-1.5 flex items-center gap-2 text-[14px] text-foreground-muted">
              {newTotal ? (
                <>
                  <span aria-hidden="true" className="viewer-dot" />
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
                  placeholder="Search  ⌘K"
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
            </div>
          ) : null}
        </div>

        {designerRequestPending ? (
          <p className="members-request mt-8 rounded-control px-4 py-3 text-[13px] text-foreground" role="status">
            <span className="font-medium">Designer access requested.</span>
            <span className="text-foreground-muted"> An owner will approve it. Until then you can review what’s shared with you.</span>
          </p>
        ) : null}

        <NeedsYou className="mt-10" initial={mentions} />

        {!projects.length ? (
          <div className="mt-16 rounded-panel border border-dashed border-border px-6 py-14 text-center">
            <p className="text-[14px] font-medium">No handoffs yet</p>
            <p className="mx-auto mt-1.5 max-w-sm text-[13px] text-foreground-subtle">When a designer shares a handoff with you, it shows up here with a dot whenever there’s a new version.</p>
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
                  {showWorkspaceNames ? (
                    <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center rounded-[7px] bg-surface-strong text-[11px] font-semibold">
                      {group.title.trim().slice(0, 1).toUpperCase()}
                    </span>
                  ) : null}
                  <h2 className="min-w-0 truncate text-[14px] font-semibold tracking-[-0.01em]" id={`group-${group.key}`}>{group.title}</h2>
                  {group.newCount ? <span className="viewer-count">{group.newCount} new</span> : null}
                  {group.newCount ? (
                    <button
                      className="viewer-mark-seen shrink-0 rounded-[6px] px-1.5 py-0.5 text-[12px] text-foreground-subtle transition-colors hover:bg-surface-inset hover:text-foreground"
                      onClick={() => void markSeen(group.items.filter((item) => item.isNew).map((item) => item.handoffId))}
                      type="button"
                    >
                      Mark seen
                    </button>
                  ) : null}
                  <span className="ml-auto shrink-0 text-[12px] text-foreground-subtle" suppressHydrationWarning>Updated {timeAgo(group.updatedAt)}</span>
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
                <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {group.items.map((handoff) => (
                    <li key={handoff.handoffId}>
                      <Link
                        className="viewer-tile group block overflow-hidden rounded-panel border border-border bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40"
                        href={
                          handoff.isNew && handoff.changesSinceSeen && handoff.seenVersionId && handoff.latestVersionId
                            ? `/workspace/${handoff.workspaceId}/projects/${handoff.projectId}/handoffs/${handoff.handoffId}?compare=1&compareFrom=${handoff.seenVersionId}&compareTo=${handoff.latestVersionId}&versionId=${handoff.latestVersionId}`
                            : `/workspace/${handoff.workspaceId}/projects/${handoff.projectId}/handoffs/${handoff.handoffId}${resume[handoff.handoffId] ?? ""}`
                        }
                      >
                        <div className="viewer-tile-preview review-dot-grid relative aspect-[16/10] overflow-hidden">
                          {handoff.previewUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element -- served by our asset route with its own caching.
                            <img alt="" className="absolute inset-x-0 top-3 mx-auto h-[calc(100%-12px)] w-auto max-w-[85%] rounded-t-[6px] object-cover object-top shadow-lg shadow-black/50 transition-transform duration-300 group-hover:-translate-y-1" decoding="async" loading="lazy" src={handoff.previewUrl} />
                          ) : (
                            <span className="absolute inset-0 grid place-items-center text-[12px] text-foreground-subtle">No screens yet</span>
                          )}
                          {handoff.isNew ? (
                            <span className="absolute left-2.5 top-2.5 inline-flex items-center gap-1.5 rounded-full bg-black/70 px-2 py-1 text-[11px] font-medium text-foreground backdrop-blur">
                              <span aria-hidden="true" className="viewer-dot" />
                              {handoff.changesSinceSeen ? changesLabel(handoff.changesSinceSeen) : "New version"}
                            </span>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-2 border-t border-border px-3.5 py-3">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-medium">{handoff.handoffName}</span>
                            <span className="mt-0.5 block truncate text-[12px] text-foreground-subtle" suppressHydrationWarning>
                              {showWorkspaceNames ? `${handoff.projectName} · ` : ""}
                              {handoff.versionLabel ? `${/^\d/.test(handoff.versionLabel) ? "v" : ""}${handoff.versionLabel} · ` : ""}
                              {timeAgo(handoff.updatedAt)}
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
              </section>
            ))}
          </div>
        )}
        {devTools ? <div className="mt-16 max-w-xs">{devTools}</div> : null}
      </main>
    </div>
  );
}
