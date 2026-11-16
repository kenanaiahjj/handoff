import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getSessionForHeaders } from "@/src/server/auth-session";
import { getDatabase } from "@/src/server/db";
import { listProjects } from "@/src/server/repositories/projects";
import { WorkspaceShell, type WorkspaceChoice } from "@/src/components/shell/WorkspaceShell";
import { createWorkspaceNavigation } from "@/src/components/shell/workspace-navigation";
import { ProjectsPane, type ProjectCard } from "../projects-pane";
import { canSeeWholeWorkspace, countUpdatesByProject, filterProjectsForViewer, listViewerUpdates } from "@/src/server/services/review-visibility";

export const instant = false;

type ProjectsPageProps = {
  params: Promise<{ workspaceId: string }>;
};

type WorkspaceDetail = {
  id: string;
  name: string;
  role: string;
};

export default async function ProjectsPage({ params }: ProjectsPageProps) {
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
  const projects = filterProjectsForViewer(workspace.id, viewer, listProjects(workspace.id) as ProjectCard[]);
  const newCounts = countUpdatesByProject(listViewerUpdates(workspace.id, viewer));
  const workspaces = getDatabase()
    .prepare(
      `SELECT workspace.id, workspace.name, workspace_membership.role
       FROM workspace
       JOIN workspace_membership ON workspace_membership.workspace_id = workspace.id
       WHERE workspace_membership.user_id = ?
       ORDER BY workspace.created_at DESC`,
    )
    .all(session.user.id) as WorkspaceChoice[];

  return (
    <WorkspaceShell
      user={{ name: session.user.name, email: session.user.email }}
      workspace={workspace}
      workspaces={workspaces}
      navSections={createWorkspaceNavigation({ workspaceId, projects, page: "projects" })}
      breadcrumbs={[{ label: "Workspaces", href: "/workspace" }, { label: workspace.name, href: `/workspace/${workspaceId}` }, { label: "Projects" }]}
    >
      <main className="workspace-dashboard mx-auto px-5 py-7 text-foreground sm:px-8 sm:py-9">
        <header className="workspace-dashboard-heading">
          <div>
            <h1 className="font-semibold text-foreground">Projects</h1>
            <p className="mt-2 text-[13px] leading-5 text-foreground-muted">{canManage ? `Every project in ${workspace.name}. Open one to manage its handoffs, or create a new one.` : "Projects with handoffs shared with you."}</p>
          </div>
        </header>
        <div className="mt-6 max-w-4xl">
          <ProjectsPane workspaceId={workspace.id} projects={projects} canManage={canManage} newCounts={newCounts} />
        </div>
      </main>
    </WorkspaceShell>
  );
}
