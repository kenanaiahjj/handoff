import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getSessionForHeaders } from "@/src/server/auth-session";
import { getDatabase } from "@/src/server/db";
import { getProject, listProjectPdCandidates } from "@/src/server/repositories/projects";
import { listHandoffs } from "@/src/server/repositories/handoffs";
import { listProjects } from "@/src/server/repositories/projects";
import { ProjectPdInChargeForm } from "./project-actions";
import { HandoffSetupForm } from "./handoff-setup-form";
import { ProjectRulesForm } from "@/src/components/ProjectRulesForm";
import { DeleteHandoffButton, RenameHandoffButton } from "@/src/components/canvas/HandoffLifecycleActions";
import { HandoffAccessDialog } from "@/src/components/canvas/HandoffAccessDialog";
import { WorkspaceShell, type WorkspaceChoice } from "@/src/components/shell/WorkspaceShell";
import { StartHandoffButton } from "./start-handoff-button";
import { createWorkspaceNavigation } from "@/src/components/shell/workspace-navigation";

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
  const project = getProject({ workspaceId, projectId });
  const membership = getDatabase()
    .prepare("SELECT role FROM workspace_membership WHERE workspace_id = ? AND user_id = ?")
    .get(workspaceId, session.user.id) as { role: string } | undefined;
  if (!project || !membership) notFound();
  const canManageHandoffs = membership.role === "owner" || membership.role === "designer";

  const handoffs = listHandoffs({ workspaceId, projectId }) as ProjectHandoff[];
  const workspace = getDatabase()
    .prepare("SELECT workspace.id, workspace.name, workspace_membership.role FROM workspace JOIN workspace_membership ON workspace_membership.workspace_id = workspace.id WHERE workspace.id = ? AND workspace_membership.user_id = ?")
    .get(workspaceId, session.user.id) as WorkspaceChoice | undefined;
  if (!workspace) notFound();
  const workspaces = getDatabase()
    .prepare("SELECT workspace.id, workspace.name, workspace_membership.role FROM workspace JOIN workspace_membership ON workspace_membership.workspace_id = workspace.id WHERE workspace_membership.user_id = ? ORDER BY workspace.created_at DESC")
    .all(session.user.id) as WorkspaceChoice[];
  const projects = listProjects(workspaceId) as Array<{ id: string; name: string }>;
  const navSections = createWorkspaceNavigation({ workspaceId, projects, page: "project", activeProjectId: projectId });

  return (
    <WorkspaceShell
      user={{ name: session.user.name, email: session.user.email }}
      workspace={workspace}
      workspaces={workspaces}
      navSections={navSections}
      breadcrumbs={[{ label: "Workspaces", href: "/workspace" }, { label: workspace.name, href: `/workspace/${workspaceId}` }, { label: project.name }]}
    >
      <main className="workspace-dashboard mx-auto px-5 py-7 sm:px-8 sm:py-9">
        <header className="workspace-dashboard-heading">
          <div>
            <h1 className="font-semibold text-foreground">{project.name}</h1>
            <p className="mt-2 text-[13px] leading-5 text-foreground-muted">Keep the app’s design canvas and every reviewed version in this project.</p>
          </div>
          <StartHandoffButton />
        </header>

        <div className="workspace-dashboard-columns mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_390px]">
          <section aria-labelledby="handoff-list-title" className="workspace-pane p-5 sm:p-6" id="handoffs">
            <div className="workspace-pane-heading">
              <h2 className="text-[14px] font-semibold text-foreground" id="handoff-list-title">Handoffs</h2>
              <span className="workspace-pane-count font-mono text-[11px]">{handoffs.length.toString().padStart(2, "0")}</span>
            </div>
            {handoffs.length ? (
              <ul className="workspace-handoff-list mt-2">
                {handoffs.map((handoff) => (
                  <li className="py-1" key={handoff.id}>
                    <article className="workspace-handoff-item flex min-h-[104px] flex-col px-2.5 py-3">
                      <Link
                        aria-label={`Open handoff ${handoff.name}`}
                        className="group/link flex min-w-0 items-start gap-3 rounded-control focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                        href={`/workspace/${workspaceId}/projects/${projectId}/handoffs/${handoff.id}`}
                      >
                        <span aria-hidden="true" className="workspace-mark grid size-9 shrink-0 place-items-center text-foreground"><svg className="size-4" fill="none" viewBox="0 0 16 16"><path d="M3 3.5h10v9H3zM5.5 6h5M5.5 8.5h3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.2" /></svg></span>
                        <span className="min-w-0 flex-1 pt-0.5">
                          <span className="block truncate text-sm font-medium leading-5 text-foreground">{handoff.name}</span>
                          <span className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] leading-4 text-foreground-subtle">
                            <span>{handoff.versionCount} {handoff.versionCount === 1 ? "version" : "versions"}</span>
                            <span aria-hidden="true">·</span>
                            <span>{handoff.latestVersionAt ? new Date(handoff.latestVersionAt).toLocaleDateString() : "No versions yet"}</span>
                            <span aria-hidden="true">·</span>
                            <span>{!handoff.publishedVersionId ? "Not published" : handoff.sharingMode === "anyone" ? "Anyone with link" : handoff.sharingMode === "invited" ? "Only invited" : "Workspace members"}</span>
                          </span>
                        </span>
                        <svg aria-hidden="true" className="mt-1 size-4 shrink-0 text-foreground-subtle transition-transform group-hover/link:translate-x-0.5" fill="none" viewBox="0 0 16 16"><path d="m6 3 5 5-5 5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></svg>
                      </Link>
                      {canManageHandoffs ? (
                        <div className="workspace-handoff-actions mt-3 flex flex-wrap items-center justify-end gap-1 pt-2.5">
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
                            returnHref={`/workspace/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}`}
                          />
                        </div>
                      ) : null}
                    </article>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="workspace-empty-state px-2 py-7 text-sm">No handoffs yet. Capture a Figma canvas to create the first version.</p>
            )}
          </section>

          <aside aria-label="Start a design handoff" className="space-y-3" id="start-handoff">
            <ProjectPdInChargeForm input={{ workspaceId, projectId, candidates: listProjectPdCandidates(workspaceId), selectedId: project.pdInChargeUserId }} />
            <HandoffSetupForm mode="project" input={{ workspaceId, projectId, handoffs: handoffs.map(({ id, name }) => ({ id, name })) }} />
          </aside>
        </div>

        <details className="workspace-settings-disclosure mt-6 px-4 py-4">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-semibold text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden"><svg aria-hidden="true" className="size-3.5 shrink-0 text-foreground-subtle transition-transform [[open]>summary>&]:rotate-90" fill="none" viewBox="0 0 16 16"><path d="m6 4 4 4-4 4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></svg>Layout QA rules</summary>
          <p className="mb-5 mt-2 max-w-2xl text-xs leading-5 text-foreground-muted">Set this project’s spacing scale, token requirements, and frame limits. Handoff applies these rules to each structured snapshot.</p>
          <ProjectRulesForm workspaceId={workspaceId} projectId={projectId} initialRules={project.rules} />
        </details>
      </main>
    </WorkspaceShell>
  );
}
