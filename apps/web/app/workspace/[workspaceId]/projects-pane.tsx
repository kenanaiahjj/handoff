import Link from "next/link";
import { ProjectActions } from "@/src/components/shell/ProjectActions";
import { CreateProjectForm } from "../workspace-actions";
import { NewVersionBadge } from "@/src/components/shell/NewVersionBadge";
import { ProjectIcon } from "@/src/components/shell/ProjectIcon";
import { ProjectPinButton } from "@/src/components/shell/ProjectPinButton";

export type ProjectCard = {
  id: string;
  name: string;
  createdAt: string;
  handoffCount: number;
  versionCount: number;
};

export function ProjectsPane({ workspaceId, projects: unsorted, canManage = true, newCounts = {}, iconVersions = {}, pinnedIds = [] }: {
  workspaceId: string;
  projects: ProjectCard[];
  canManage?: boolean;
  /** Handoffs per project whose newest version this person has not opened. */
  newCounts?: Record<string, number>;
  /** Projects with an uploaded icon: id → content fingerprint. */
  iconVersions?: Record<string, string>;
  /** Project ids this person pinned, oldest first; pinned projects sort to the top. */
  pinnedIds?: string[];
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
    <section aria-labelledby="projects-title" className="workspace-pane p-3 pt-4" id="projects">
      <div className="workspace-pane-heading px-2.5">
        <h2 className="text-[14px] font-semibold text-foreground" id="projects-title">Projects</h2>
        <span className="workspace-pane-count font-mono text-[11px]">{projects.length.toString().padStart(2, "0")}</span>
      </div>
      {projects.length ? (
        <ul className="workspace-list">
          {projects.map((project) => (
            <li key={project.id}>
              <div className="workspace-list-item flex min-h-[60px] items-center gap-3 px-2.5">
                <Link aria-label={`Open ${project.name}`} className="flex min-w-0 flex-1 items-center gap-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary" href={`/workspace/${workspaceId}/projects/${project.id}`}>
                <ProjectIcon name={project.name} size={36} src={iconVersions[project.id] ? `/api/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(project.id)}/icon?v=${iconVersions[project.id]}` : null} />
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-[13px] font-medium text-foreground">{project.name}</span>
                  {newCounts[project.id] ? <NewVersionBadge label={newCounts[project.id] === 1 ? "1 new version" : `${newCounts[project.id]} new versions`} /> : null}
                </span>
                  <span className="mt-0.5 block text-[11px] text-foreground-subtle">{project.handoffCount} {project.handoffCount === 1 ? "handoff" : "handoffs"} <span aria-hidden="true">·</span> {project.versionCount} {project.versionCount === 1 ? "version" : "versions"}</span>
                </span>
              </Link>
              <ProjectPinButton pinned={pinned.has(project.id)} projectId={project.id} projectName={project.name} />
              {canManage ? (
                <ProjectActions afterDeleteHref={`/workspace/${workspaceId}`} handoffCount={project.handoffCount} projectId={project.id} projectName={project.name} workspaceId={workspaceId} />
              ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="workspace-empty-state px-2.5 py-7 text-[12px]">{canManage ? "No projects yet. Create one to start a design handoff." : "Nothing has been shared with you yet. When a designer invites you to a handoff, its project appears here."}</p>
      )}
      {canManage ? <div className="workspace-create mt-3 px-2.5 pb-2 pt-3"><CreateProjectForm workspaceId={workspaceId} /></div> : null}
    </section>
  );
}
