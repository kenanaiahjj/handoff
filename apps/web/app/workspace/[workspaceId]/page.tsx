import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getSessionForHeaders } from "@/src/server/auth-session";
import { getDatabase } from "@/src/server/db";
import { listProjects } from "@/src/server/repositories/projects";
import { CreateInviteForm, CreateProjectForm } from "../workspace-actions";
import { WorkspaceShell, type WorkspaceChoice } from "@/src/components/shell/WorkspaceShell";
import { createWorkspaceNavigation } from "@/src/components/shell/workspace-navigation";

export const instant = false;

type WorkspacePageProps = {
  params: Promise<{ workspaceId: string }>;
};

type WorkspaceDetail = {
  id: string;
  name: string;
  role: string;
};

type ProjectCard = {
  id: string;
  name: string;
  createdAt: string;
  handoffCount: number;
  versionCount: number;
};

type WorkspaceInvite = {
  id: string;
  role: string;
  expiresAt: string | null;
  createdAt: string;
};

export default async function WorkspacePage({ params }: WorkspacePageProps) {
  const session = await getSessionForHeaders(await headers());
  if (!session) redirect("/sign-in");

  const { workspaceId } = await params;
  const workspace = getDatabase()
    .prepare(
      `SELECT workspace.id, workspace.name, workspace_membership.role
       FROM workspace
       JOIN workspace_membership ON workspace_membership.workspace_id = workspace.id
       WHERE workspace.id = ? AND workspace_membership.user_id = ?`,
    )
    .get(workspaceId, session.user.id) as WorkspaceDetail | undefined;

  if (!workspace) notFound();

  const projects = listProjects(workspace.id) as ProjectCard[];
  const invites = getDatabase()
    .prepare(
      `SELECT id, role, expires_at AS expiresAt, created_at AS createdAt
       FROM workspace_invite
       WHERE workspace_id = ? AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > ?)
       ORDER BY created_at DESC`,
    )
    .all(workspaceId, new Date().toISOString()) as WorkspaceInvite[];
  const workspaces = getDatabase()
    .prepare(
      `SELECT workspace.id, workspace.name, workspace_membership.role
       FROM workspace
       JOIN workspace_membership ON workspace_membership.workspace_id = workspace.id
       WHERE workspace_membership.user_id = ?
       ORDER BY workspace.created_at DESC`,
    )
    .all(session.user.id) as WorkspaceChoice[];
  const navSections = createWorkspaceNavigation({ workspaceId, projects, page: "overview" });

  return (
    <WorkspaceShell
      user={{ name: session.user.name, email: session.user.email }}
      workspace={workspace}
      workspaces={workspaces}
      navSections={navSections}
      breadcrumbs={[{ label: "Workspaces", href: "/workspace" }, { label: workspace.name }]}
    >
      <main className="workspace-dashboard mx-auto px-5 py-7 text-foreground sm:px-8 sm:py-9">
        <header className="workspace-dashboard-heading">
          <div>
            <h1 className="font-semibold text-foreground">{workspace.name}</h1>
            <p className="mt-2 text-[13px] leading-5 text-foreground-muted">Projects keep source canvases, frozen versions, and review decisions together.</p>
          </div>
          <span className="workspace-role px-3 py-1.5 text-[11px] capitalize">{workspace.role}</span>
        </header>

        <div className="workspace-dashboard-columns mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
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
                      <Link aria-label={`Open ${project.name}`} className="flex min-w-0 flex-1 items-center gap-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary" href={`/workspace/${workspace.id}/projects/${project.id}`}>
                      <span aria-hidden="true" className="workspace-mark grid size-9 shrink-0 place-items-center text-[12px] font-semibold">{project.name.trim().slice(0, 1).toUpperCase() || "P"}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-foreground">{project.name}</span>
                        <span className="mt-1 block text-[11px] text-foreground-subtle">{project.handoffCount} handoffs <span aria-hidden="true">·</span> {project.versionCount} versions</span>
                      </span>
                    </Link>
                    <Link className="capture-primary-action inline-flex min-h-8 shrink-0 items-center justify-center rounded-full px-3 text-[10px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-hover" href={`/workspace/${workspace.id}/projects/${project.id}#setup-handoff-name`}>Start handoff</Link>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="workspace-empty-state px-2 py-7 text-[12px]">No projects yet. Create one to start a design handoff.</p>
            )}
            <div className="workspace-create mt-5 pt-5"><CreateProjectForm workspaceId={workspace.id} /></div>
          </section>

          <section aria-labelledby="invite-title" className="workspace-pane p-5 sm:p-6">
            <div className="workspace-pane-heading">
              <h2 className="text-[14px] font-semibold text-foreground" id="invite-title">Invite your team</h2>
            </div>
            <div className="mt-4"><CreateInviteForm key={workspace.id} workspaceId={workspace.id} initialInvites={invites} /></div>
          </section>
        </div>
      </main>
    </WorkspaceShell>
  );
}
