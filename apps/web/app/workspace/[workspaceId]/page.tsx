import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getSessionForHeaders } from "@/src/server/auth-session";
import { getDatabase } from "@/src/server/db";
import { listProjects } from "@/src/server/repositories/projects";
import { CreateInviteForm } from "../workspace-actions";
import { ProjectsPane, type ProjectCard } from "./projects-pane";
import Link from "next/link";
import { NewVersionBadge } from "@/src/components/shell/NewVersionBadge";
import { canSeeWholeWorkspace, countUpdatesByProject, filterProjectsForViewer, listViewerHome, listViewerUpdates } from "@/src/server/services/review-visibility";
import { ViewerHome } from "@/src/components/shell/ViewerHome";
import { ViewAsSwitcher } from "@/src/components/shell/ViewAsSwitcher";
import { isDevelopmentAuthBypassActive, localReviewerUser } from "@/src/server/auth-session";
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

  const viewer = { id: session.user.id, email: session.user.email, role: workspace.role };
  const canManage = canSeeWholeWorkspace(workspace.role);

  // People who review rather than manage get a calm, app-like home instead of the dashboard.
  if (!canManage) {
    const devBypass = await isDevelopmentAuthBypassActive();
    return (
      <ViewerHome
        devTools={devBypass ? <ViewAsSwitcher current={session.user.email === localReviewerUser.email ? "reviewer" : "owner"} workspaceId={workspace.id} /> : null}
        projects={listViewerHome(workspace.id, viewer)}
        devBypass={devBypass}
        user={{ name: session.user.name, email: session.user.email, image: session.user.image ?? null }}
        homeHref={`/workspace/${workspace.id}`}
        title={workspace.name}
      />
    );
  }
  const projects = filterProjectsForViewer(workspace.id, viewer, listProjects(workspace.id) as ProjectCard[]);
  const updates = listViewerUpdates(workspace.id, viewer);
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
            <p className="mt-2 text-[13px] leading-5 text-foreground-muted">{canManage ? "Projects keep source canvases, frozen versions, and review decisions together." : "Projects and handoffs shared with you for review."}</p>
          </div>
          <span className="workspace-role px-3 py-1.5 text-[11px] capitalize">{workspace.role}</span>
        </header>

        <div className="workspace-dashboard-columns mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <ProjectsPane workspaceId={workspace.id} projects={projects} canManage={canManage} newCounts={countUpdatesByProject(updates)} />

          {canManage ? (
            <section aria-labelledby="invite-title" className="workspace-pane p-5 sm:p-6">
              <div className="workspace-pane-heading">
                <h2 className="text-[14px] font-semibold text-foreground" id="invite-title">Invite your team</h2>
              </div>
              <div className="mt-4"><CreateInviteForm key={workspace.id} workspaceId={workspace.id} initialInvites={invites} /></div>
            </section>
          ) : (
            <section aria-labelledby="updates-title" className="workspace-pane p-5 sm:p-6">
              <div className="workspace-pane-heading">
                <h2 className="text-[14px] font-semibold text-foreground" id="updates-title">Updates for you</h2>
                <span className="workspace-pane-count font-mono text-[11px]">{updates.length.toString().padStart(2, "0")}</span>
              </div>
              {updates.length ? (
                <ul className="workspace-list mt-2">
                  {updates.map((update) => (
                    <li className="py-1" key={update.handoffId}>
                      <Link className="workspace-list-item flex flex-col gap-1 px-2.5 py-2.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary" href={`/workspace/${workspace.id}/projects/${update.projectId}/handoffs/${update.handoffId}`}>
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-[13px] font-medium text-foreground">{update.handoffName}</span>
                          <NewVersionBadge label="New" />
                        </span>
                        <span className="truncate text-[11px] text-foreground-subtle">Version {update.versionLabel} · {update.projectName} · {new Date(update.createdAt).toLocaleDateString()}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="workspace-empty-state px-2 py-7 text-[12px]">You’re up to date. New versions of handoffs shared with you show up here.</p>
              )}
            </section>
          )}
        </div>
      </main>
    </WorkspaceShell>
  );
}
