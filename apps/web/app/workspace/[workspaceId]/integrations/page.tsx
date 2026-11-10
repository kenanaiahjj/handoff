import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getSessionForHeaders } from "@/src/server/auth-session";
import { getDatabase } from "@/src/server/db";
import { listProjects } from "@/src/server/repositories/projects";
import { McpTokenManager } from "@/src/components/integrations/McpTokenManager";
import { WorkspaceShell, type WorkspaceChoice } from "@/src/components/shell/WorkspaceShell";
import { createWorkspaceNavigation } from "@/src/components/shell/workspace-navigation";

export const instant = false;

type IntegrationsPageProps = { params: Promise<{ workspaceId: string }> };

export default async function IntegrationsPage({ params }: IntegrationsPageProps) {
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
    .get(workspaceId, session.user.id) as { id: string; name: string; role: string } | undefined;
  if (!workspace) notFound();

  const database = getDatabase();
  const workspaces = database
    .prepare(
      `SELECT workspace.id, workspace.name, workspace_membership.role
       FROM workspace
       JOIN workspace_membership ON workspace_membership.workspace_id = workspace.id
       WHERE workspace_membership.user_id = ?
       ORDER BY workspace.created_at DESC`,
    )
    .all(session.user.id) as WorkspaceChoice[];
  const projects = listProjects(workspaceId) as Array<{ id: string; name: string }>;

  return (
    <WorkspaceShell
      user={{ name: session.user.name, email: session.user.email }}
      workspace={workspace}
      workspaces={workspaces}
      navSections={createWorkspaceNavigation({ workspaceId, projects, page: "integrations" })}
      breadcrumbs={[
        { label: "Team spaces", href: "/workspace" },
        { label: workspace.name, href: `/workspace/${workspaceId}` },
        { label: "Integrations" },
      ]}
    >
      <main className="mx-auto w-full max-w-6xl px-5 py-7 sm:px-8 sm:py-9">
        <section className="border-b border-border pb-5">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-accent">Workspace integrations</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">MCP access</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-foreground-muted">Connect Asbir Handoff to your AI client with a personal, scoped token. Your AI client can also use its own Asbir Teams or ClickUp task tools, plus repository and QA MCP connections. Tokens stop working when revoked, expired, or when you leave the workspace.</p>
        </section>
        <div className="mt-5"><McpTokenManager workspaceId={workspaceId} canManageAll={true} /></div>
      </main>
    </WorkspaceShell>
  );
}
