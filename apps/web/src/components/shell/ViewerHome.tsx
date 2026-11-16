"use client";

import Image from "next/image";
import Link from "next/link";
import { type ReactNode, useMemo, useState } from "react";
import { SignOutButton } from "@/app/workspace/workspace-actions";
import type { ViewerProject } from "@/src/server/services/review-visibility";

type Filter = "all" | "updated";

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
}: {
  /** Where the logo goes: this workspace, or the combined home. */
  homeHref: string;
  /** Header title: the workspace name, or the app name on the combined home. */
  title: string;
  /** Label each project with its workspace (combined home across workspaces). */
  showWorkspaceNames?: boolean;
  user: { name: string; email: string; image: string | null };
  projects: ViewerProject[];
  /** Development bypass is on: "Sign out" leaves it for this browser. */
  devBypass?: boolean;
  devTools?: ReactNode;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const newTotal = projects.reduce((total, project) => total + project.newCount, 0);
  const firstName = user.name.split(" ")[0] ?? "";

  const visibleProjects = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return projects
      .map((project) => ({
        ...project,
        handoffs: project.handoffs.filter(
          (handoff) =>
            (filter === "all" || handoff.isNew) &&
            (!needle || handoff.handoffName.toLowerCase().includes(needle) || project.projectName.toLowerCase().includes(needle)),
        ),
      }))
      .filter((project) => project.handoffs.length);
  }, [projects, filter, query]);

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
                  {showWorkspaceNames ? null : (
                    <Link className="block rounded-[6px] px-2.5 py-2 text-[13px] text-foreground-muted hover:bg-surface-inset hover:text-foreground" href="/workspace" role="menuitem">
                      All workspaces
                    </Link>
                  )}
                  <div className="px-1 pb-1 pt-1.5 [&>button]:w-full [&>button]:justify-start [&>button]:text-left">
                    <SignOutButton devBypass={devBypass} />
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-24 pt-8 sm:px-6 sm:pt-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em]">{firstName ? `Hi, ${firstName}` : "Your handoffs"}</h1>
            <p className="mt-1.5 flex items-center gap-2 text-[14px] text-foreground-muted">
              {newTotal ? (
                <>
                  <span aria-hidden="true" className="viewer-dot" />
                  {newTotal === 1 ? "1 handoff has a new version" : `${newTotal} handoffs have new versions`}
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
            {visibleProjects.map((project) => (
              <section aria-labelledby={`project-${project.projectId}`} key={project.projectId}>
                <div className="mb-3 flex min-w-0 items-center gap-2">
                  <h2 className="min-w-0 truncate text-[13px] font-semibold" id={`project-${project.projectId}`}>
                    {showWorkspaceNames ? <span className="font-normal text-foreground-subtle">{project.workspaceName} <span aria-hidden="true">/</span> </span> : null}
                    {project.projectName}
                  </h2>
                  {project.newCount ? <span className="viewer-count">{project.newCount} new</span> : null}
                  <span className="ml-auto shrink-0 text-[12px] text-foreground-subtle" suppressHydrationWarning>Updated {timeAgo(project.updatedAt)}</span>
                </div>
                <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {project.handoffs.map((handoff) => (
                    <li key={handoff.handoffId}>
                      <Link
                        className="viewer-tile group block overflow-hidden rounded-panel border border-border bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40"
                        href={`/workspace/${project.workspaceId}/projects/${project.projectId}/handoffs/${handoff.handoffId}`}
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
                              New version
                            </span>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-2 border-t border-border px-3.5 py-3">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-medium">{handoff.handoffName}</span>
                            <span className="mt-0.5 block truncate text-[12px] text-foreground-subtle" suppressHydrationWarning>
                              {handoff.versionLabel ? `Version ${handoff.versionLabel} · ` : ""}
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
