import type { ReactNode } from "react";
import Link from "next/link";
import { ProjectActions } from "@/src/components/shell/ProjectActions";
import { CreateProjectForm } from "../workspace-actions";
import { NewVersionBadge } from "@/src/components/shell/NewVersionBadge";
import { ProjectIcon } from "@/src/components/shell/ProjectIcon";
import { ProjectPinButton } from "@/src/components/shell/ProjectPinButton";
import { PanelDialog } from "@/src/components/shell/PanelDialog";

export type ProjectCard = {
  id: string;
  name: string;
  createdAt: string;
  handoffCount: number;
  versionCount: number;
};

export function ProjectsPane({ workspaceId, projects: unsorted, canManage = true, newCounts = {}, iconVersions = {}, pinnedIds = [], previews = new Map(), slugs = new Map(), pageTitle = false, actions = null, notice = null }: {
  workspaceId: string;
  projects: ProjectCard[];
  canManage?: boolean;
  /** Handoffs per project whose newest version this person has not opened. */
  newCounts?: Record<string, number>;
  /** Projects with an uploaded icon: id → content fingerprint. */
  iconVersions?: Record<string, string>;
  /** Project ids this person pinned, oldest first; pinned projects sort to the top. */
  pinnedIds?: string[];
  /** Up to three screen images per project, newest handoff first. */
  previews?: Map<string, string[]>;
  /** Project id → readable address segment. */
  slugs?: Map<string, string>;
  /** The pane heading is the page's title (the dashboard has no other heading). */
  pageTitle?: boolean;
  /** More buttons beside New project. */
  actions?: ReactNode;
  /** Shown between the heading and the cards. */
  notice?: ReactNode;
}) {
  const pinned = new Set(pinnedIds);
  const projects = [...unsorted].sort((a, b) => {
    const pa = pinnedIds.indexOf(a.id);
    const pb = pinnedIds.indexOf(b.id);
    if (pa === -1 && pb === -1) return 0;
    if (pa === -1) return 1;
    if (pb === -1) return -1;
    return pa - pb;
  });
  return (
    <section aria-labelledby="projects-title" className="min-w-0" id="projects">
      <div className="mb-3 flex min-h-9 items-center gap-2">
        {pageTitle
          ? <h1 className="text-[20px] font-semibold leading-tight tracking-[-0.035em] text-foreground" id="projects-title">Projects</h1>
          : <h2 className="text-[14px] font-semibold text-foreground" id="projects-title">Projects</h2>}
        <span className="font-mono text-[11px] text-foreground-subtle">{projects.length}</span>
        {canManage || actions ? (
          <span className="ml-auto flex items-center gap-2">
            {actions}
            {canManage ? <PanelDialog
              icon={<svg aria-hidden="true" className="size-3.5" fill="none" viewBox="0 0 16 16"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" /></svg>}
              label="New project"
              labelledBy="new-project-title"
              primary
            >
              <section aria-labelledby="new-project-title" className="workspace-pane p-5">
                <h2 className="text-[15px] font-semibold text-foreground" id="new-project-title">New project</h2>
                <div className="mt-4"><CreateProjectForm autoFocus workspaceId={workspaceId} /></div>
              </section>
            </PanelDialog> : null}
          </span>
        ) : null}
      </div>
      {notice ? <div className="mb-4">{notice}</div> : null}
      {projects.length ? (
        <ul className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
          {projects.map((project) => {
            const images = previews.get(project.id) ?? [];
            const iconSrc = iconVersions[project.id] ? `/api/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(project.id)}/icon?v=${iconVersions[project.id]}` : null;
            return (
              <li key={project.id}>
                <article className="handoff-card group relative flex h-full flex-col overflow-hidden">
                  <div className="handoff-card-preview project-card-preview relative aspect-[16/9] overflow-hidden">
                    {images.length ? (
                      <span aria-hidden="true" className="project-card-stack" data-count={images.length}>
                        {images.map((key) => (
                          // eslint-disable-next-line @next/next/no-img-element -- served by our asset route with its own caching.
                          <img alt="" decoding="async" key={key} loading="lazy" src={`/api/assets/${encodeURIComponent(key)}`} />
                        ))}
                      </span>
                    ) : (
                      <span className="absolute inset-0 grid place-items-center">
                        <ProjectIcon name={project.name} size={56} src={iconSrc} />
                      </span>
                    )}
                    {newCounts[project.id] ? (
                      <span className="absolute left-2.5 top-2.5"><NewVersionBadge label={newCounts[project.id] === 1 ? "1 new version" : `${newCounts[project.id]} new versions`} /></span>
                    ) : null}
                  </div>
                  <div className="flex flex-1 items-center gap-3 px-4 pb-3.5 pt-3">
                    <ProjectIcon name={project.name} size={32} src={iconSrc} />
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-[15px] font-semibold leading-5 tracking-[-0.01em] text-foreground">
                        <Link className="handoff-card-link focus-visible:outline-none" href={`/projects/${slugs.get(project.id) ?? project.id}`}>{project.name}</Link>
                      </h3>
                      <p className="mt-0.5 truncate text-[12px] text-foreground-subtle">
                        {project.handoffCount} {project.handoffCount === 1 ? "handoff" : "handoffs"} · {project.versionCount} {project.versionCount === 1 ? "version" : "versions"}
                      </p>
                    </div>
                  </div>
                  <div className="handoff-card-actions absolute right-2 top-2 z-10 flex items-center">
                    <ProjectPinButton pinned={pinned.has(project.id)} projectId={project.id} projectName={project.name} />
                    {canManage ? (
                      <ProjectActions afterDeleteHref={`/workspace`} handoffCount={project.handoffCount} projectId={project.id} projectName={project.name} workspaceId={workspaceId} />
                    ) : null}
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="workspace-empty-state py-7 text-[12px]">{canManage ? "No projects yet. Create one to start a design handoff." : "Nothing has been shared with you yet. When a designer invites you to a handoff, its project appears here."}</p>
      )}
    </section>
  );
}
