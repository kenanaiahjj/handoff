import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getSessionForHeaders } from "@/src/server/auth-session";
import { getDatabase } from "@/src/server/db";
import { listProjects } from "@/src/server/repositories/projects";
import { WorkspaceShell } from "@/src/components/shell/WorkspaceShell";
import { createWorkspaceNavigation } from "@/src/components/shell/workspace-navigation";
import { projectIconVersions } from "@/src/server/services/project-icons";
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
  const workspace = (await getDatabase()
    .prepare(
      `SELECT workspace.id, workspace.name, workspace_membership.role
       FROM workspace
       JOIN workspace_membership ON workspace_membership.workspace_id = workspace.id
       WHERE workspace.id = ? AND workspace_membership.user_id = ?`,
    )
    .get(workspaceId, session.user.id)) as WorkspaceDetail | undefined;

  if (!workspace) notFound();

  const viewer = { id: session.user.id, email: session.user.email, role: workspace.role };
  const canManage = canSeeWholeWorkspace(workspace.role);
  const projects = (await filterProjectsForViewer(workspace.id, viewer, (await listProjects(workspace.id)) as ProjectCard[]));
  const newCounts = countUpdatesByProject((await listViewerUpdates(workspace.id, viewer)));

  return (
    <WorkspaceShell
      user={{ name: session.user.name, email: session.user.email }}
      workspace={workspace}
      navSections={await createWorkspaceNavigation({ workspaceId, companyName: workspace.name, isOwner: workspace.role === "owner", projects, page: "projects", canManage })}
      breadcrumbs={[{ label: "Projects", href: `/workspace/${workspaceId}` }]}
    >
      <main className="workspace-dashboard mx-auto px-5 py-7 text-foreground sm:px-8 sm:py-9">
        <header className="workspace-dashboard-heading">
          <div>
            <h1 className="font-semibold text-foreground">Projects</h1>
            <p className="mt-2 text-[13px] leading-5 text-foreground-muted">{canManage ? `Every project in ${workspace.name}. Open one to manage its handoffs, or create a new one.` : "Projects with handoffs shared with you."}</p>
          </div>
        </header>
        <div className="mt-6 max-w-4xl">
          <ProjectsPane workspaceId={workspace.id} projects={projects} canManage={canManage} newCounts={newCounts} iconVersions={(await projectIconVersions(workspace.id))} />
        </div>
      </main>
    </WorkspaceShell>
  );
}
