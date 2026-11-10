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
import { DeleteHandoffButton } from "@/src/components/canvas/HandoffLifecycleActions";
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
      breadcrumbs={[{ label: "Team spaces", href: "/workspace" }, { label: workspace.name, href: `/workspace/${workspaceId}` }, { label: project.name }]}
    >
      <main className="mx-auto w-full max-w-6xl px-5 py-7 sm:px-8 sm:py-9">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{project.name}</h1>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-2xl text-sm leading-6 text-foreground-muted">Keep the app’s design canvas and every reviewed version in this project.</p>
            <StartHandoffButton />
          </div>
        </header>

        <div className="mt-8 grid gap-8 xl:grid-cols-[minmax(0,1fr)_390px]">
          <section aria-labelledby="handoff-list-title" className="min-w-0" id="handoffs">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h2 className="text-sm font-semibold text-foreground" id="handoff-list-title">Handoffs</h2>
              <span className="font-mono text-[11px] text-foreground-subtle">{handoffs.length.toString().padStart(2, "0")}</span>
            </div>
            {handoffs.length ? (
              <ul className="divide-y divide-border">
                {handoffs.map((handoff) => (
                  <li key={handoff.id}>
                    <div className="flex items-center gap-2">
                      <Link className="group flex min-h-[68px] min-w-0 flex-1 items-center gap-3 px-2 transition-colors hover:bg-surface/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary" href={`/workspace/${workspaceId}/projects/${projectId}/handoffs/${handoff.id}`} rel="noopener noreferrer" target="_blank">
                        <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-control border border-border bg-surface text-foreground-subtle"><svg className="size-4" fill="none" viewBox="0 0 16 16"><path d="M3 3.5h10v9H3zM5.5 6h5M5.5 8.5h3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.2" /></svg></span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-foreground">{handoff.name}</span>
                          <span className="mt-1 block text-xs text-foreground-subtle">
                            {handoff.versionCount} {handoff.versionCount === 1 ? "version" : "versions"} <span aria-hidden="true">·</span> {handoff.latestVersionAt ? new Date(handoff.latestVersionAt).toLocaleDateString() : "No versions yet"}
                            <span aria-hidden="true"> · </span>{!handoff.publishedVersionId ? "Not published" : handoff.sharingMode === "anyone" ? "Anyone with link" : handoff.sharingMode === "invited" ? "Only invited" : "Workspace members"}
                          </span>
                        </span>
                        <svg aria-hidden="true" className="size-4 shrink-0 text-foreground-subtle transition-transform group-hover:translate-x-0.5" fill="none" viewBox="0 0 16 16"><path d="m6 3 5 5-5 5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></svg>
                      </Link>
                      {canManageHandoffs ? <HandoffAccessDialog
                        endpoint={`/api/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/handoffs/${encodeURIComponent(handoff.id)}`}
                        handoffName={handoff.name}
                      /> : null}
                      {canManageHandoffs ? <DeleteHandoffButton
                        endpoint={`/api/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/handoffs/${encodeURIComponent(handoff.id)}`}
                        handoffName={handoff.name}
                        returnHref={`/workspace/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}`}
                      /> : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="border-b border-border px-2 py-7 text-sm text-foreground-muted">No handoffs yet. Capture a Figma canvas to create the first version.</p>
            )}
          </section>

          <aside aria-label="Start a design handoff" className="space-y-3" id="start-handoff">
            <ProjectPdInChargeForm input={{ workspaceId, projectId, candidates: listProjectPdCandidates(workspaceId), selectedId: project.pdInChargeUserId }} />
            <HandoffSetupForm mode="project" input={{ workspaceId, projectId, handoffs: handoffs.map(({ id, name }) => ({ id, name })) }} />
          </aside>
        </div>

        <details className="mt-8 border-t border-border pt-4">
          <summary className="cursor-pointer text-xs font-semibold text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">Layout QA rules</summary>
          <p className="mb-5 mt-2 max-w-2xl text-xs leading-5 text-foreground-muted">Set this project’s spacing scale, token requirements, and frame limits. Handoff applies these rules to each structured snapshot.</p>
          <ProjectRulesForm workspaceId={workspaceId} projectId={projectId} initialRules={project.rules} />
        </details>
      </main>
    </WorkspaceShell>
  );
}
