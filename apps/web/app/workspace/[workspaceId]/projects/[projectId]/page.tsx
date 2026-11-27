import Link from "next/link";
import { LocalTime } from "@/src/components/LocalTime";
import { ProjectActions } from "@/src/components/shell/ProjectActions";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getSessionForHeaders } from "@/src/server/auth-session";
import { getDatabase } from "@/src/server/db";
import { getProject, listProjectPdCandidates } from "@/src/server/repositories/projects";
import { projectIconUrl, projectIconVersions } from "@/src/server/services/project-icons";
import { ProjectIcon, ProjectIconEditor } from "@/src/components/shell/ProjectIcon";
import { listHandoffPreviewKeys, listHandoffs } from "@/src/server/repositories/handoffs";
import { listProjects } from "@/src/server/repositories/projects";
import { ProjectPdInChargeForm } from "./project-actions";
import { ProjectAccessPanel } from "@/src/components/shell/ProjectAccessPanel";
import { listProjectAccess, listProjectTeam } from "@/src/server/services/project-access";
import { ProjectTeamCard } from "@/src/components/shell/ProjectTeamCard";
import { HandoffSetupForm } from "./handoff-setup-form";
import { workspaceRouteSlugs } from "@/src/server/services/route-slugs";
import { HandoffActions } from "@/src/components/canvas/HandoffLifecycleActions";
import { PanelDialog } from "@/src/components/shell/PanelDialog";
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
  archivedAt: string | null;
};

export default async function ProjectPage({ params }: ProjectPageProps) {
  const session = await getSessionForHeaders(await headers());
  if (!session) redirect("/sign-in");

  const { workspaceId, projectId } = await params;
  // Independent reads run together: each is a network round trip on hosted PostgreSQL.
  const [project, membership, allHandoffs, workspace, previewKeys] = await Promise.all([
    getProject({ workspaceId, projectId }),
    getDatabase()
      .prepare("SELECT role FROM workspace_membership WHERE workspace_id = ? AND user_id = ?")
      .get(workspaceId, session.user.id) as Promise<{ role: string } | undefined>,
    listHandoffs({ workspaceId, projectId }) as Promise<ProjectHandoff[]>,
    getDatabase()
      .prepare("SELECT workspace.id, workspace.name, workspace_membership.role FROM workspace JOIN workspace_membership ON workspace_membership.workspace_id = workspace.id WHERE workspace.id = ? AND workspace_membership.user_id = ?")
      .get(workspaceId, session.user.id) as Promise<WorkspaceChoice | undefined>,
    listHandoffPreviewKeys({ workspaceId, projectId }),
  ]);
  if (!project || !membership) notFound();
  const canManageHandoffs = membership.role === "owner" || membership.role === "designer";

  const viewer = { id: session.user.id, email: session.user.email, role: membership.role };
  const visible = (await visibleHandoffIds(workspaceId, viewer));
  const visibleHandoffs = allHandoffs.filter((handoff) => !visible || visible.has(handoff.id));
  if (visible && !visibleHandoffs.length) notFound();
  // Archived handoffs leave the main list; owners and designers find them under "Archived".
  const handoffs = visibleHandoffs.filter((handoff) => !handoff.archivedAt);
  const archivedHandoffs = canManageHandoffs ? visibleHandoffs.filter((handoff) => handoff.archivedAt) : [];
  if (!workspace) notFound();
  const [newness, projects] = await Promise.all([
    handoffNewness(session.user.id, handoffs.map((handoff) => handoff.id)),
    listProjects(workspaceId).then((all) => filterProjectsForViewer(workspaceId, viewer, all as Array<{ id: string; name: string; handoffCount: number; versionCount: number }>)),
  ]);
  const routes = await workspaceRouteSlugs(workspaceId);
  const navSections = await createWorkspaceNavigation({ workspaceId, companyName: workspace.name, isOwner: workspace.role === "owner", projects, page: "project", activeProjectId: projectId, canManage: canManageHandoffs });

  return (
    <WorkspaceShell
      user={{ name: session.user.name, email: session.user.email }}
      workspace={workspace}
      navSections={navSections}
      breadcrumbs={[{ label: "Projects", href: `/workspace` }, { label: project.name }]}
    >
      <main className="workspace-dashboard mx-auto px-5 py-7 sm:px-8 sm:py-9">
        <Link className="mb-5 inline-flex min-h-8 items-center gap-1.5 rounded-control px-2.5 text-[12px] font-medium text-foreground-muted transition-colors hover:bg-surface-inset hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" href="/workspace">
          <svg aria-hidden="true" className="size-3.5" fill="none" viewBox="0 0 16 16"><path d="m9.5 3.5-4.5 4.5 4.5 4.5M5.5 8h7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></svg>
          Back to projects
        </Link>
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
            {canManageHandoffs ? null : <p className="mt-2 text-[13px] leading-5 text-foreground-muted">Only handoffs shared with you are listed.</p>}
          </div>
          </div>
          <div className="flex items-center gap-2">
            {canManageHandoffs ? (
              <>
                <PanelDialog label="Team" labelledBy="pd-in-charge-title">
                  <ProjectPdInChargeForm input={{ workspaceId, projectId, candidates: (await listProjectPdCandidates(workspaceId)), selectedId: project.pdInChargeUserId }} />
                  <ProjectAccessPanel
                    initial={await listProjectAccess(workspaceId, projectId)}
                    projectId={projectId}
                    suggestions={(await getDatabase()
                      .prepare(`SELECT "user".email, "user".name FROM workspace_membership JOIN "user" ON "user".id = workspace_membership.user_id WHERE workspace_membership.workspace_id = ? ORDER BY lower("user".name)`)
                      .all(workspaceId)) as Array<{ email: string; name: string }>}
                    workspaceId={workspaceId}
                  />
                </PanelDialog>
                <PanelDialog
                  icon={<svg aria-hidden="true" className="size-3.5" fill="none" viewBox="0 0 16 16"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" /></svg>}
                  label="Start a handoff"
                  labelledBy="handoff-setup-title"
                  primary
                >
                  <HandoffSetupForm mode="project" input={{ workspaceId, projectId, handoffs: handoffs.map(({ id, name }) => ({ id, name })) }} />
                </PanelDialog>
              </>
            ) : (
              <PanelDialog label="Team" labelledBy="project-team-title">
                <ProjectTeamCard team={await listProjectTeam(workspaceId, projectId)} />
              </PanelDialog>
            )}
          </div>
        </header>

        <div className="workspace-dashboard-columns mt-6 grid gap-5">
          <section aria-labelledby="handoff-list-title" className="min-w-0" id="handoffs">
            <div className="mb-3 flex items-baseline gap-2">
              <h2 className="text-[14px] font-semibold text-foreground" id="handoff-list-title">Handoffs</h2>
              <span className="font-mono text-[11px] text-foreground-subtle">{handoffs.length}</span>
            </div>
            {handoffs.length ? (
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {handoffs.map((handoff) => {
                  const previewKey = previewKeys.get(handoff.id);
                  const isNew = newness.get(handoff.id)?.isNew;
                  const status = !handoff.publishedVersionId
                    ? { label: "Not published", tone: "draft" }
                    : { label: handoff.sharingMode === "anyone" ? "Anyone with link" : handoff.sharingMode === "invited" ? "Only invited" : "Workspace", tone: "live" };
                  return (
                    <li key={handoff.id}>
                      <article className="handoff-card group relative flex h-full flex-col overflow-hidden">
                        <div className="handoff-card-preview relative aspect-[16/10] overflow-hidden">
                          {previewKey ? (
                            // eslint-disable-next-line @next/next/no-img-element -- served by our asset route with its own caching.
                            <img alt="" className="absolute inset-x-0 top-4 mx-auto h-[calc(100%-16px)] w-auto max-w-[82%] rounded-t-[8px] object-cover object-top shadow-xl shadow-black/50 transition-transform duration-300 ease-out group-hover:-translate-y-1" decoding="async" loading="lazy" src={`/api/assets/${encodeURIComponent(previewKey)}`} />
                          ) : (
                            <span className="absolute inset-0 grid place-items-center text-[12px] text-foreground-subtle">No screens yet</span>
                          )}
                          <span className="absolute left-2.5 top-2.5 flex items-center gap-1.5">
                            <span className="handoff-card-status" data-tone={status.tone}>
                              <span aria-hidden="true" className="handoff-card-status-dot" />
                              {status.label}
                            </span>
                            {isNew ? <NewVersionBadge /> : null}
                          </span>
                        </div>
                        <div className="flex flex-1 items-end gap-3 px-4 pb-3.5 pt-3">
                          <div className="min-w-0 flex-1">
                            <h3 className="truncate text-[15px] font-semibold leading-5 tracking-[-0.01em] text-foreground">
                              <Link
                                className="handoff-card-link focus-visible:outline-none"
                                href={routes.handoff(projectId, handoff.id)}
                              >
                                {handoff.name}
                              </Link>
                            </h3>
                            <p className="mt-1 truncate text-[12px] text-foreground-subtle">
                              {handoff.versionCount} {handoff.versionCount === 1 ? "version" : "versions"}
                              {" · "}
                              {handoff.latestVersionAt ? <LocalTime format="day" iso={handoff.latestVersionAt} /> : "No versions yet"}
                            </p>
                          </div>
                          <span aria-hidden="true" className="handoff-card-open">
                            Open
                            <svg className="size-3.5" fill="none" viewBox="0 0 16 16"><path d="m6 3 5 5-5 5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" /></svg>
                          </span>
                        </div>
                        {canManageHandoffs ? (
                          <div className="handoff-card-actions absolute right-2 top-2 z-10">
                            <HandoffActions
                              endpoint={`/api/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/handoffs/${encodeURIComponent(handoff.id)}`}
                              handoffName={handoff.name}
                              returnHref={routes.project(projectId)}
                            />
                          </div>
                        ) : null}
                      </article>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="workspace-empty-state py-7 text-sm">{archivedHandoffs.length ? "No active handoffs. Archived ones are below." : "No handoffs yet. Capture a Figma canvas to create the first version."}</p>
            )}
            {archivedHandoffs.length ? (
              <details className="group mt-6">
                <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-control text-[13px] font-medium text-foreground-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">
                  <svg aria-hidden="true" className="size-3 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 16 16"><path d="m6 3.5 4.5 4.5L6 12.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" /></svg>
                  Archived
                  <span className="font-mono text-[11px] text-foreground-subtle">{archivedHandoffs.length}</span>
                </summary>
                <ul className="mt-3 grid gap-1">
                  {archivedHandoffs.map((handoff) => (
                    <li className="flex items-center gap-3 rounded-control px-3 py-1.5 hover:bg-surface-inset" key={handoff.id}>
                      <Link className="min-w-0 flex-1 truncate text-[13px] text-foreground-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" href={routes.handoff(projectId, handoff.id)}>
                        {handoff.name}
                      </Link>
                      <span className="shrink-0 text-[11px] text-foreground-subtle">
                        {handoff.versionCount} {handoff.versionCount === 1 ? "version" : "versions"} · archived <LocalTime format="day" iso={handoff.archivedAt as string} />
                      </span>
                      <HandoffActions
                        archived
                        endpoint={`/api/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/handoffs/${encodeURIComponent(handoff.id)}`}
                        handoffName={handoff.name}
                        returnHref={routes.project(projectId)}
                      />
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </section>

        </div>

        {/* Layout QA rules are hidden for now; ProjectRulesForm and the rules API remain. */}
      </main>
    </WorkspaceShell>
  );
}
