import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getSessionForHeaders } from "@/src/server/auth-session";
import { getDatabase } from "@/src/server/db";
import { listProjects } from "@/src/server/repositories/projects";
import { getRoleFeatureSettings, getWorkspaceSettings, workspaceLogoUrl } from "@/src/server/services/workspace-settings";
import { WorkspaceShell } from "@/src/components/shell/WorkspaceShell";
import { createWorkspaceNavigation } from "@/src/components/shell/workspace-navigation";
import { WorkspaceSettingsForm } from "@/src/components/shell/WorkspaceSettingsForm";
import { RoleFeaturesForm } from "@/src/components/shell/RoleFeaturesForm";

export const instant = false;

type SettingsPageProps = { params: Promise<{ workspaceId: string }> };

/** Owners only: the workspace's name, logo, which email domains can join, and which features each role gets. */
export default async function SettingsPage({ params }: SettingsPageProps) {
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
  if (workspace.role !== "owner") redirect(`/workspace`);
  const [settings, projects, roleFeatures] = await Promise.all([
    getWorkspaceSettings(workspaceId),
    listProjects(workspaceId) as Promise<Array<{ id: string; name: string }>>,
    getRoleFeatureSettings(workspaceId),
  ]);
  if (!settings) notFound();

  return (
    <WorkspaceShell
      user={{ name: session.user.name, email: session.user.email, image: session.user.image ?? null }}
      workspace={workspace}
      navSections={await createWorkspaceNavigation({ workspaceId, companyName: workspace.name, isOwner: true, projects, page: "settings", canManage: true })}
      breadcrumbs={[{ label: "Settings" }]}
    >
      <main className="mx-auto w-full max-w-3xl px-5 py-7 sm:px-8 sm:py-9">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Settings</h1>
        <p className="mt-2 text-sm leading-6 text-foreground-muted">Only owners see this page.</p>
        <div className="mt-8">
          <WorkspaceSettingsForm
            domains={settings.allowedEmailDomains}
            environmentDomains={settings.environmentDomains}
            logoUrl={workspaceLogoUrl(workspaceId, settings.logoVersion)}
            name={settings.name}
            workspaceId={workspaceId}
          />
        </div>
        <div className="mt-5">
          <RoleFeaturesForm settings={roleFeatures} workspaceId={workspaceId} />
        </div>
      </main>
    </WorkspaceShell>
  );
}
