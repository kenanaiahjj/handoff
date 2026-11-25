import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getSessionForHeaders } from "@/src/server/auth-session";
import { getDatabase } from "@/src/server/db";
import { listProjects } from "@/src/server/repositories/projects";
import { getHandbook } from "@/src/server/services/handbook";
import { canSeeWholeWorkspace, filterProjectsForViewer } from "@/src/server/services/review-visibility";
import { CopyPrompt } from "@/src/components/integrations/CopyPrompt";
import { HandbookView } from "@/src/components/handbook/HandbookView";
import { renamePrompt } from "@/src/components/handbook/rename-prompt";
import { WorkspaceShell } from "@/src/components/shell/WorkspaceShell";
import { createWorkspaceNavigation } from "@/src/components/shell/workspace-navigation";

export const instant = false;

type HandbookPageProps = { params: Promise<{ workspaceId: string }> };

/** The workspace's Figma naming handbook. Everyone reads it; owners and designers edit it. */
export default async function HandbookPage({ params }: HandbookPageProps) {
  const session = await getSessionForHeaders(await headers());
  if (!session) redirect("/sign-in");
  const { workspaceId } = await params;
  const workspace = (await getDatabase()
    .prepare(
      `SELECT workspace.id, workspace.name, workspace_membership.role
       FROM workspace JOIN workspace_membership ON workspace_membership.workspace_id = workspace.id
       WHERE workspace.id = ? AND workspace_membership.user_id = ?`,
    )
    .get(workspaceId, session.user.id)) as { id: string; name: string; role: string } | undefined;
  if (!workspace) notFound();

  const canManage = canSeeWholeWorkspace(workspace.role);
  const viewer = { id: session.user.id, email: session.user.email, role: workspace.role };
  const [projects, handbook] = await Promise.all([
    listProjects(workspaceId).then((all) => filterProjectsForViewer(workspaceId, viewer, all as Array<{ id: string; name: string; handoffCount: number; versionCount: number }>)),
    getHandbook(workspaceId),
  ]);

  return (
    <WorkspaceShell
      user={{ name: session.user.name, email: session.user.email }}
      workspace={workspace}
      navSections={await createWorkspaceNavigation({ workspaceId, companyName: workspace.name, isOwner: workspace.role === "owner", projects, page: "handbook", canManage })}
      breadcrumbs={[{ label: "Naming handbook" }]}
    >
      <main className="mx-auto w-full max-w-3xl px-5 py-7 sm:px-8 sm:py-10">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Naming handbook</h1>
        <p className="mt-1.5 text-[13px] text-foreground-muted">How to name and organize Figma files so captures read cleanly. AI clients connected to this workspace can read it too.</p>
        <div className="mt-6">
          <CopyPrompt prompt={renamePrompt} title="Rename layers with your agent" />
          <p className="mt-2 text-[12px] text-foreground-subtle">
            Needs the Asbir Handoff MCP and the Figma MCP in your AI client. <Link className="text-primary underline-offset-2 hover:underline" href="/integrations?open=mcp">Set up the Asbir Handoff MCP</Link>.
          </p>
        </div>
        <div className="mt-8">
          <HandbookView canEdit={canManage} initial={handbook} workspaceId={workspaceId} />
        </div>
      </main>
    </WorkspaceShell>
  );
}
