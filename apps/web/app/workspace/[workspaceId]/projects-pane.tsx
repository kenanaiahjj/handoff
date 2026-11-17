import Link from "next/link";
import { CreateProjectForm } from "../workspace-actions";
import { NewVersionBadge } from "@/src/components/shell/NewVersionBadge";
import { ProjectIcon } from "@/src/components/shell/ProjectIcon";

export type ProjectCard = {
  id: string;
  name: string;
  createdAt: string;
  handoffCount: number;
  versionCount: number;
};

export function ProjectsPane({ workspaceId, projects, canManage = true, newCounts = {}, iconVersions = {} }: {
  workspaceId: string;
  projects: ProjectCard[];
  canManage?: boolean;
  /** Handoffs per project whose newest version this person has not opened. */
  newCounts?: Record<string, number>;
  /** Projects with an uploaded icon: id → content fingerprint. */
  iconVersions?: Record<string, string>;
}) {
  return (
    <section aria-labelledby="projects-title" className="workspace-pane p-5 sm:p-6" id="projects">
      <div className="workspace-pane-heading">
        <h2 className="text-[14px] font-semibold text-foreground" id="projects-title">Projects</h2>
        <span className="workspace-pane-count font-mono text-[11px]">{projects.length.toString().padStart(2, "0")}</span>
      </div>
      {projects.length ? (
        <ul className="workspace-list mt-2">
          {projects.map((project) => (
            <li className="py-1" key={project.id}>
              <div className="workspace-list-item flex min-h-[72px] items-center gap-3 px-2.5">
                <Link aria-label={`Open ${project.name}`} className="flex min-w-0 flex-1 items-center gap-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary" href={`/workspace/${workspaceId}/projects/${project.id}`}>
                <ProjectIcon name={project.name} size={36} src={iconVersions[project.id] ? `/api/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(project.id)}/icon?v=${iconVersions[project.id]}` : null} />
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-[13px] font-medium text-foreground">{project.name}</span>
                  {newCounts[project.id] ? <NewVersionBadge label={newCounts[project.id] === 1 ? "1 new version" : `${newCounts[project.id]} new versions`} /> : null}
                </span>
                  <span className="mt-1 block text-[11px] text-foreground-subtle">{project.handoffCount} handoffs <span aria-hidden="true">·</span> {project.versionCount} versions</span>
                </span>
              </Link>
              
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="workspace-empty-state px-2 py-7 text-[12px]">{canManage ? "No projects yet. Create one to start a design handoff." : "Nothing has been shared with you yet. When a designer invites you to a handoff, its project appears here."}</p>
      )}
      {canManage ? <div className="workspace-create mt-5 pt-5"><CreateProjectForm workspaceId={workspaceId} /></div> : null}
    </section>
  );
}
