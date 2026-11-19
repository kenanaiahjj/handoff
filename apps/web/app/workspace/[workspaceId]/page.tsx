import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getSessionForHeaders } from "@/src/server/auth-session";
import { getDatabase } from "@/src/server/db";
import { listProjects } from "@/src/server/repositories/projects";
import { CreateInviteForm } from "../workspace-actions";
import { MembersPanel } from "../members-panel";
import { hasPendingDesignerRequest, listMembers } from "@/src/server/services/members";
import { projectIconVersions } from "@/src/server/services/project-icons";
import { ProjectsPane, type ProjectCard } from "./projects-pane";
import Link from "next/link";
import { canSeeWholeWorkspace, countUpdatesByProject, filterProjectsForViewer, listViewerHome, listViewerUpdates } from "@/src/server/services/review-visibility";
import { ViewerHome } from "@/src/components/shell/ViewerHome";
import { listPinKeys } from "@/src/server/services/viewer-pins";
import { listOpenMentions } from "@/src/server/services/mentions";
import { NeedsYou } from "@/src/components/shell/NeedsYou";
import { ProfileNudge } from "@/src/components/shell/ProfileNudge";
import { getProfile } from "@/src/server/services/profiles";
import { ViewAsSwitcher } from "@/src/components/shell/ViewAsSwitcher";
import { isDevelopmentAuthBypassActive, viewAsModeFor } from "@/src/server/auth-session";
import { WorkspaceShell } from "@/src/components/shell/WorkspaceShell";
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
  jobRole: string | null;
  expiresAt: string | null;
  createdAt: string;
};

export default async function WorkspacePage({ params }: WorkspacePageProps) {
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

  // People who review rather than manage get a calm, app-like home instead of the dashboard.
  if (!canManage) {
    const devBypass = await isDevelopmentAuthBypassActive();
    const profile = await getProfile(session.user.id);
    const missing = [...(profile?.image ? [] : ["photo" as const]), ...(profile?.title || profile?.department ? [] : ["title" as const])];
    return (
      <ViewerHome
        devTools={devBypass ? <ViewAsSwitcher current={viewAsModeFor(session.user)} workspaceId={workspace.id} /> : null}
        projects={(await listViewerHome(workspace.id, viewer))}
        devBypass={devBypass}
        pinKeys={(await listPinKeys(session.user.id))}
        mentions={(await listOpenMentions(session.user.id, workspace.id, viewer))}
        designerRequestPending={(await hasPendingDesignerRequest(session.user.id))}
        user={{ name: session.user.name, email: session.user.email, image: session.user.image ?? null }}
        homeHref="/workspace"
        notice={<ProfileNudge href={`/profile`} image={profile?.image ?? null} missing={missing} name={session.user.name} />}
        title={workspace.name}
      />
    );
  }
  // Independent reads run together: each is a network round trip on hosted PostgreSQL.
  const [projects, updates, invites, members] = await Promise.all([
    listProjects(workspace.id).then((all) => filterProjectsForViewer(workspace.id, viewer, all as ProjectCard[])),
    listViewerUpdates(workspace.id, viewer),
    getDatabase()
      .prepare(
        `SELECT id, role, job_role AS jobRole, expires_at AS expiresAt, created_at AS createdAt
         FROM workspace_invite
         WHERE workspace_id = ? AND revoked_at IS NULL
           AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY created_at DESC`,
      )
      .all(workspaceId, new Date().toISOString()) as Promise<WorkspaceInvite[]>,
    listMembers(workspace.id),
  ]);
  const navSections = await createWorkspaceNavigation({ workspaceId, companyName: workspace.name, isOwner: workspace.role === "owner", projects, page: "overview", canManage });

  return (
    <WorkspaceShell
      user={{ name: session.user.name, email: session.user.email }}
      workspace={workspace}
      navSections={navSections}
      breadcrumbs={[{ label: "Projects" }]}
    >
      <main className="workspace-dashboard mx-auto px-5 py-7 text-foreground sm:px-8 sm:py-9">
        <header className="workspace-dashboard-heading">
          <h1 className="font-semibold text-foreground">{workspace.name}</h1>
        </header>

        {await (async () => {
          const profile = await getProfile(session.user.id);
          const missing = [...(profile?.image ? [] : ["photo" as const]), ...(profile?.title || profile?.department ? [] : ["title" as const])];
          return <ProfileNudge className="mt-6" href={`/profile`} image={profile?.image ?? null} missing={missing} name={session.user.name} />;
        })()}

        <NeedsYou className="mt-6" initial={(await listOpenMentions(session.user.id, workspace.id, viewer))} />

        <div className="workspace-dashboard-columns mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <ProjectsPane workspaceId={workspace.id} projects={projects} canManage={canManage} newCounts={countUpdatesByProject(updates)} iconVersions={(await projectIconVersions(workspace.id))} pinnedIds={(await listPinKeys(session.user.id)).filter((key) => key.startsWith("project:")).map((key) => key.slice("project:".length))} />

          <section aria-labelledby="invite-title" className="workspace-pane p-5 sm:p-6">
            <div className="workspace-pane-heading">
              <h2 className="text-[14px] font-semibold text-foreground" id="invite-title">Invite your team</h2>
            </div>
            <div className="mt-4"><CreateInviteForm key={workspace.id} workspaceId={workspace.id} initialInvites={invites} /></div>
            <div className="mt-8">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-[13px] font-semibold text-foreground" id="members-title">Members</h3>
                <span className="text-[11px] tabular-nums text-foreground-subtle">{members.length}</span>
              </div>
              <MembersPanel canEdit={workspace.role === "owner"} currentUserId={session.user.id} initial={members} limit={5} manageHref={`/team`} workspaceId={workspace.id} />
            </div>
          </section>
        </div>
      </main>
    </WorkspaceShell>
  );
}
