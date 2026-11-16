import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionForHeaders } from "@/src/server/auth-session";
import { getDatabase } from "@/src/server/db";
import { needsOnboarding } from "@/src/server/services/onboarding";
import { listViewerHomeAcrossWorkspaces } from "@/src/server/services/review-visibility";
import { ViewerHome } from "@/src/components/shell/ViewerHome";
import { ViewAsSwitcher } from "@/src/components/shell/ViewAsSwitcher";
import { isDevelopmentAuthBypassActive, viewAsModeFor } from "@/src/server/auth-session";
import { listSuperadmins, syncSuperadminAccess } from "@/src/server/services/superadmins";
import { CreateWorkspaceForm } from "./workspace-actions";
import { SuperadminsPanel } from "./superadmins-panel";
import { WorkspaceShell, type WorkspaceChoice } from "@/src/components/shell/WorkspaceShell";

export const instant = false;

type WorkspaceRow = {
  id: string;
  name: string;
  role: string;
  createdAt: string;
};

export default async function WorkspaceHomePage() {
  const session = await getSessionForHeaders(await headers());
  if (!session) redirect("/sign-in");
  const superadmin = syncSuperadminAccess(session.user);
  if (needsOnboarding(session.user.id)) redirect("/onboarding");

  const workspaces = getDatabase()
    .prepare(
      `SELECT workspace.id, workspace.name, workspace.created_at AS createdAt,
              workspace_membership.role
       FROM workspace
       JOIN workspace_membership ON workspace_membership.workspace_id = workspace.id
       WHERE workspace_membership.user_id = ?
       ORDER BY workspace.created_at DESC`,
    )
    .all(session.user.id) as WorkspaceRow[];

  // People who only review get one app-like home across all their workspaces; the workspace list is a manager's tool.
  if (workspaces.length && !workspaces.some((workspace) => workspace.role === "owner" || workspace.role === "designer")) {
    const devBypass = await isDevelopmentAuthBypassActive();
    return (
      <ViewerHome
        devTools={devBypass ? <ViewAsSwitcher current={viewAsModeFor(session.user)} workspaceId={workspaces[0].id} /> : null}
        homeHref="/workspace"
        projects={listViewerHomeAcrossWorkspaces(session.user, workspaces)}
        devBypass={devBypass}
        showWorkspaceNames={workspaces.length > 1}
        title={workspaces.length === 1 ? workspaces[0].name : "Asbir Handoff"}
        user={{ name: session.user.name, email: session.user.email, image: session.user.image ?? null }}
      />
    );
  }

  const workspaceChoices = workspaces as WorkspaceChoice[];

  return (
    <WorkspaceShell
      user={{ name: session.user.name, email: session.user.email }}
      workspaces={workspaceChoices}
      navSections={[{
        label: "Workspaces",
        items: [{ label: "All workspaces", href: "/workspace", icon: "grid", active: true }],
      }]}
      breadcrumbs={[{ label: "Workspaces" }]}
    >
      <main className="workspace-dashboard mx-auto px-5 py-7 sm:px-8 sm:py-9">
        <header className="workspace-dashboard-heading">
          <div>
            <h1 className="font-semibold text-foreground">Workspaces</h1>
            <p className="mt-2 text-[13px] leading-5 text-foreground-muted">Handoffs, reviews, and implementation notes stay with the team that owns them.</p>
          </div>
          <span className="workspace-role px-3 py-1.5 font-mono text-[11px]">{workspaces.length.toString().padStart(2, "0")} {workspaces.length === 1 ? "workspace" : "workspaces"}</span>
        </header>

        <div className="workspace-dashboard-columns mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <section aria-labelledby="workspace-list-title" className="workspace-pane p-5 sm:p-6">
            <div className="workspace-pane-heading">
              <h2 className="text-[14px] font-semibold text-foreground" id="workspace-list-title">Available workspaces</h2>
              <span className="workspace-pane-count font-mono text-[11px]">{workspaces.length.toString().padStart(2, "0")}</span>
            </div>
            {workspaces.length ? (
              <ul className="workspace-list mt-2">
                {workspaces.map((workspace) => (
                  <li className="py-1" key={workspace.id}>
                    <Link className="workspace-list-item group flex min-h-[72px] items-center gap-3 px-2.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary" href={`/workspace/${workspace.id}`}>
                      <span aria-hidden="true" className="workspace-mark grid size-9 shrink-0 place-items-center text-[12px] font-semibold">{workspace.name.trim().slice(0, 1).toUpperCase() || "W"}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-foreground">{workspace.name}</span>
                        <span className="mt-1 block text-[11px] capitalize text-foreground-subtle">{workspace.role === "reviewer" ? "Product manager / reviewer" : workspace.role}</span>
                      </span>
                      <svg aria-hidden="true" className="size-4 shrink-0 text-foreground-subtle transition-transform group-hover:translate-x-0.5" fill="none" viewBox="0 0 16 16"><path d="m6 3 5 5-5 5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></svg>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="workspace-empty-state px-2 py-8 text-sm">No workspaces yet. Create one or open a team invitation link.</p>
            )}
          </section>

          <section aria-labelledby="create-workspace-title" className="workspace-pane p-5 sm:p-6">
            <div className="workspace-pane-heading">
              <h2 className="text-[14px] font-semibold text-foreground" id="create-workspace-title">Create a workspace</h2>
            </div>
            <p className="mb-4 mt-4 text-[12px] leading-5 text-foreground-muted">Start a team space for a product or project, then invite the people who review and build it.</p>
            <CreateWorkspaceForm />
          </section>

          {superadmin ? (
            <section aria-labelledby="superadmins-title" className="workspace-pane p-5 sm:p-6 xl:col-start-2">
              <div className="workspace-pane-heading">
                <h2 className="text-[14px] font-semibold text-foreground" id="superadmins-title">Super admins</h2>
              </div>
              <div className="mt-4"><SuperadminsPanel currentEmail={session.user.email} initial={listSuperadmins()} /></div>
            </section>
          ) : null}
        </div>
      </main>
    </WorkspaceShell>
  );
}
