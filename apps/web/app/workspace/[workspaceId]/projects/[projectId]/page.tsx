import Link from "next/link";
import { ProjectActions } from "@/src/components/shell/ProjectActions";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getSessionForHeaders } from "@/src/server/auth-session";
import { getDatabase } from "@/src/server/db";
import { getProject, listProjectPdCandidates } from "@/src/server/repositories/projects";
import { projectIconUrl, projectIconVersions } from "@/src/server/services/project-icons";
import { ProjectIcon, ProjectIconEditor } from "@/src/components/shell/ProjectIcon";
import { listHandoffs } from "@/src/server/repositories/handoffs";
import { listProjects } from "@/src/server/repositories/projects";
import { ProjectPdInChargeForm } from "./project-actions";
import { ProjectAccessPanel } from "@/src/components/shell/ProjectAccessPanel";
import { listProjectAccess, listProjectTeam } from "@/src/server/services/project-access";
import { ProjectTeamCard } from "@/src/components/shell/ProjectTeamCard";
import { HandoffSetupForm } from "./handoff-setup-form";
import { DeleteHandoffButton, RenameHandoffButton } from "@/src/components/canvas/HandoffLifecycleActions";
import { HandoffAccessDialog } from "@/src/components/canvas/HandoffAccessDialog";
import { WorkspaceShell, type WorkspaceChoice } from "@/src/components/shell/WorkspaceShell";
import { createWorkspaceNavigation } from "@/src/components/shell/workspace-navigation";
import { NewVersionBadge } from "@/src/components/shell/NewVersionBadge";
import { filterProjectsForViewer, handoffNewness, visibleHandoffIds } from "@/src/server/services/review-visibility";

export const instant = false;

type ProjectPageProps = {
  params: Promise<{ workspaceId: string; projectId: string }>;
};

type ProjectHandoff = {
  id: string;
  name: string;
  createdAt: string;
  versionCount: number;
  latestVersionAt: string | null;
  publishedVersionId: string | null;
  sharingMode: "workspace" | "invited" | "anyone";
};

export default async function ProjectPage({ params }: ProjectPageProps) {
  const session = await getSessionForHeaders(await headers());
  if (!session) redirect("/sign-in");

  const { workspaceId, projectId } = await params;
  // Independent reads run together: each is a network round trip on hosted PostgreSQL.
  const [project, membership, allHandoffs, workspace] = await Promise.all([
    getProject({ workspaceId, projectId }),
    getDatabase()
      .prepare("SELECT role FROM workspace_membership WHERE workspace_id = ? AND user_id = ?")
      .get(workspaceId, session.user.id) as Promise<{ role: string } | undefined>,
    listHandoffs({ workspaceId, projectId }) as Promise<ProjectHandoff[]>,
    getDatabase()
      .prepare("SELECT workspace.id, workspace.name, workspace_membership.role FROM workspace JOIN workspace_membership ON workspace_membership.workspace_id = workspace.id WHERE workspace.id = ? AND workspace_membership.user_id = ?")
      .get(workspaceId, session.user.id) as Promise<WorkspaceChoice | undefined>,
  ]);
  if (!project || !membership) notFound();
  const canManageHandoffs = membership.role === "owner" || membership.role === "designer";

  const viewer = { id: session.user.id, email: session.user.email, role: membership.role };
  const visible = (await visibleHandoffIds(workspaceId, viewer));
  const visibleHandoffs = allHandoffs.filter((handoff) => !visible || visible.has(handoff.id));
  if (visible && !visibleHandoffs.length) notFound();
  const handoffs = visibleHandoffs;
  if (!workspace) notFound();
  const [newness, projects] = await Promise.all([
    handoffNewness(session.user.id, handoffs.map((handoff) => handoff.id)),
    listProjects(workspaceId).then((all) => filterProjectsForViewer(workspaceId, viewer, all as Array<{ id: string; name: string; handoffCount: number; versionCount: number }>)),
  ]);
  const navSections = await createWorkspaceNavigation({ workspaceId, companyName: workspace.name, isOwner: workspace.role === "owner", projects, page: "project", activeProjectId: projectId, canManage: canManageHandoffs });

  return (
    <WorkspaceShell
      user={{ name: session.user.name, email: session.user.email }}
      workspace={workspace}
      navSections={navSections}
      breadcrumbs={[{ label: "Projects", href: `/workspace` }, { label: project.name }]}
    >
      <main className="workspace-dashboard mx-auto px-5 py-7 sm:px-8 sm:py-9">
        <header className="workspace-dashboard-heading">
          <div className="flex items-start gap-4">
            {canManageHandoffs ? (
              <ProjectIconEditor initialSrc={projectIconUrl(workspaceId, projectId, (await projectIconVersions(workspaceId))[projectId])} name={project.name} projectId={projectId} workspaceId={workspaceId} />
            ) : (
              <ProjectIcon name={project.name} size={48} src={projectIconUrl(workspaceId, projectId, (await projectIconVersions(workspaceId))[projectId])} />
            )}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h1 className="font-semibold text-foreground">{project.name}</h1>
              {canManageHandoffs ? <ProjectActions afterDeleteHref={`/workspace`} align="start" handoffCount={allHandoffs.length} projectId={projectId} projectName={project.name} workspaceId={workspaceId} /> : null}
            </div>
            <p className="mt-2 text-[13px] leading-5 text-foreground-muted">{canManageHandoffs ? "Keep the app’s design canvas and every reviewed version in this project." : "Handoffs shared with you in this project. New versions are marked until you open them."}</p>
          </div>
          </div>
        </header>

        <div className={"workspace-dashboard-columns mt-6 grid gap-5 " + "xl:grid-cols-[minmax(0,1fr)_390px]"}>
          <section aria-labelledby="handoff-list-title" className="workspace-pane p-3 pt-4 sm:p-3 sm:pt-4" id="handoffs">
            <div className="workspace-pane-heading px-2.5">
              <h2 className="text-[14px] font-semibold text-foreground" id="handoff-list-title">Handoffs</h2>
              <span className="workspace-pane-count font-mono text-[11px]">{visibleHandoffs.length}</span>
            </div>
            {handoffs.length ? (
              <ul className="workspace-handoff-list">
                {handoffs.map((handoff) => (
                  <li key={handoff.id}>
                    <article className="workspace-handoff-item flex flex-wrap items-center gap-x-3 gap-y-2 px-2.5 py-2.5">
                      <Link
                        aria-label={`Open handoff ${handoff.name}`}
                        className="group/link flex min-w-0 flex-1 basis-64 items-center gap-3 rounded-control focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                        href={`/projects/${projectId}/handoffs/${handoff.id}`}
                      >
                        <span aria-hidden="true" className="workspace-mark grid size-9 shrink-0 place-items-center text-foreground"><svg className="size-4" fill="none" viewBox="0 0 16 16"><path d="M3 3.5h10v9H3zM5.5 6h5M5.5 8.5h3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.2" /></svg></span>
                        <span className="min-w-0 flex-1">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="truncate text-sm font-medium leading-5 text-foreground">{handoff.name}</span>
                            {newness.get(handoff.id)?.isNew ? <NewVersionBadge /> : null}
                          </span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] leading-4 text-foreground-subtle">
                            <span>{handoff.versionCount} {handoff.versionCount === 1 ? "version" : "versions"}</span>
                            <span aria-hidden="true">·</span>
                            <span>{handoff.latestVersionAt ? new Date(handoff.latestVersionAt).toLocaleDateString() : "No versions yet"}</span>
                            <span aria-hidden="true">·</span>
                            <span>{!handoff.publishedVersionId ? "Not published" : handoff.sharingMode === "anyone" ? "Anyone with link" : handoff.sharingMode === "invited" ? "Only invited" : "Workspace members"}</span>
                          </span>
                        </span>
                        <svg aria-hidden="true" className="size-4 shrink-0 text-foreground-subtle opacity-0 transition group-hover/link:translate-x-0.5 group-hover/link:opacity-100" fill="none" viewBox="0 0 16 16"><path d="m6 3 5 5-5 5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></svg>
                      </Link>
                      <div className="ml-auto flex shrink-0 items-center gap-1">
                        {canManageHandoffs ? (
                          <div className="workspace-handoff-actions flex shrink-0 items-center gap-0.5">
                          <RenameHandoffButton
                            endpoint={`/api/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/handoffs/${encodeURIComponent(handoff.id)}`}
                            handoffName={handoff.name}
                          />
                          <HandoffAccessDialog
                            endpoint={`/api/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/handoffs/${encodeURIComponent(handoff.id)}`}
                            handoffName={handoff.name}
                          />
                          <DeleteHandoffButton
                            endpoint={`/api/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/handoffs/${encodeURIComponent(handoff.id)}`}
                            handoffName={handoff.name}
                            returnHref={`/projects/${encodeURIComponent(projectId)}`}
                          />
                        </div>
                        ) : null}
                      </div>
                    </article>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="workspace-empty-state px-2 py-7 text-sm">No handoffs yet. Capture a Figma canvas to create the first version.</p>
            )}
          </section>

          {canManageHandoffs ? (
            <aside aria-label="Start a design handoff" className="space-y-3" id="start-handoff">
              <ProjectPdInChargeForm input={{ workspaceId, projectId, candidates: (await listProjectPdCandidates(workspaceId)), selectedId: project.pdInChargeUserId }} />
              <ProjectAccessPanel
                initial={await listProjectAccess(workspaceId, projectId)}
                projectId={projectId}
                suggestions={(await getDatabase()
                  .prepare(`SELECT "user".email, "user".name FROM workspace_membership JOIN "user" ON "user".id = workspace_membership.user_id WHERE workspace_membership.workspace_id = ? ORDER BY lower("user".name)`)
                  .all(workspaceId)) as Array<{ email: string; name: string }>}
                workspaceId={workspaceId}
              />
              <HandoffSetupForm mode="project" input={{ workspaceId, projectId, handoffs: handoffs.map(({ id, name }) => ({ id, name })) }} />
            </aside>
          ) : (
            <aside aria-label="Project team" className="space-y-3">
              <ProjectTeamCard team={await listProjectTeam(workspaceId, projectId)} />
            </aside>
          )}
        </div>

        {/* Layout QA rules are hidden for now; ProjectRulesForm and the rules API remain. */}
      </main>
    </WorkspaceShell>
  );
}
