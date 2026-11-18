import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getSessionForHeaders } from "@/src/server/auth-session";
import { getDatabase } from "@/src/server/db";
import { listProjects } from "@/src/server/repositories/projects";
import { canSeeWholeWorkspace, filterProjectsForViewer } from "@/src/server/services/review-visibility";
import { McpTokenManager } from "@/src/components/integrations/McpTokenManager";
import { WorkspaceShell } from "@/src/components/shell/WorkspaceShell";
import { createWorkspaceNavigation } from "@/src/components/shell/workspace-navigation";

export const instant = false;

type IntegrationsPageProps = { params: Promise<{ workspaceId: string }> };

export default async function IntegrationsPage({ params }: IntegrationsPageProps) {
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
    .get(workspaceId, session.user.id)) as { id: string; name: string; role: string } | undefined;
  if (!workspace) notFound();

  const database = getDatabase();
  const projects = (await listProjects(workspaceId)) as Array<{ id: string; name: string; handoffCount: number; versionCount: number }>;

  return (
    <WorkspaceShell
      user={{ name: session.user.name, email: session.user.email }}
      workspace={workspace}
      navSections={await createWorkspaceNavigation({ workspaceId, companyName: workspace.name, isOwner: workspace.role === "owner", projects: (await filterProjectsForViewer(workspaceId, { id: session.user.id, email: session.user.email, role: workspace.role }, projects)), page: "integrations", canManage: canSeeWholeWorkspace(workspace.role) })}
      breadcrumbs={[{ label: "Integrations" }]}
    >
      <main className="mx-auto w-full max-w-6xl px-5 py-7 sm:px-8 sm:py-9">
        <section className="pb-2">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Integrations</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-foreground-muted">Bring designs in from Figma and connect your AI tools.</p>
        </section>

        <section aria-labelledby="figma-plugin-title" className="workspace-pane mt-6 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3.5">
              <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-surface-inset">
                <svg className="size-5 text-foreground" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" viewBox="0 0 20 20"><path d="M7 3.5h2.5v2a1.5 1.5 0 0 0 3 0v-2H15a1.5 1.5 0 0 1 1.5 1.5v2.5h-2a1.5 1.5 0 0 0 0 3h2V13A1.5 1.5 0 0 1 15 14.5H5A1.5 1.5 0 0 1 3.5 13V5A1.5 1.5 0 0 1 5 3.5Z" /></svg>
              </span>
              <div className="min-w-0">
                <h2 className="text-[15px] font-semibold text-foreground" id="figma-plugin-title">Figma plugin</h2>
                <p className="mt-1 max-w-xl text-[13px] leading-5 text-foreground-muted">Capture frames from Figma straight into a handoff. This download is already set up for this workspace&apos;s server, so there&apos;s nothing to configure.</p>
              </div>
            </div>
            <a
              className="inline-flex min-h-9 shrink-0 items-center gap-2 rounded-control bg-primary px-4 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              download
              href="/api/figma-plugin"
            >
              <svg aria-hidden="true" className="size-3.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" viewBox="0 0 16 16"><path d="M8 2.5v7m0 0 2.5-2.5M8 9.5 5.5 7M3 10.5v2h10v-2" /></svg>
              Download plugin
            </a>
          </div>
          <ol className="mt-5 grid gap-2 sm:grid-cols-3">
            {[
              ["Unzip it", "Keep the folder somewhere permanent. Moving it later breaks the plugin."],
              ["Import in Figma", "In the Figma desktop app: Plugins → Development → Import plugin from manifest, then pick manifest.json."],
              ["Capture", "Run Asbir Handoff Capture from Plugins → Development and paste the capture token from a project."],
            ].map(([title, body], index) => (
              <li className="rounded-[10px] bg-white/[0.03] p-3.5" key={title}>
                <span className="font-mono text-[11px] text-foreground-subtle">{index + 1}</span>
                <p className="mt-1 text-[13px] font-medium text-foreground">{title}</p>
                <p className="mt-1 text-[12px] leading-[1.45] text-foreground-subtle">{body}</p>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-[11px] leading-4 text-foreground-subtle">Plugin updated? Download again and import the new manifest.json. On a Figma Organization plan, an admin can publish it privately to your organization instead, so it installs and updates for everyone.</p>
        </section>

        <section aria-labelledby="mcp-title" className="mt-10">
          <h2 className="text-[15px] font-semibold text-foreground" id="mcp-title">MCP access</h2>
          <p className="mt-1.5 max-w-2xl text-[13px] leading-5 text-foreground-muted">Connect Asbir Handoff to your AI client with a personal, scoped token. Your AI client can also use its own Asbir Teams or ClickUp task tools, plus repository and QA MCP connections. Tokens stop working when revoked, expired, or when you leave the workspace.</p>
          <div className="mt-5"><McpTokenManager workspaceId={workspaceId} canManageAll={canSeeWholeWorkspace(workspace.role)} /></div>
        </section>
      </main>
    </WorkspaceShell>
  );
}
