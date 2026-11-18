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
import { NewVersionBadge } from "@/src/components/shell/NewVersionBadge";
import { canSeeWholeWorkspace, countUpdatesByProject, filterProjectsForViewer, listViewerHome, listViewerUpdates } from "@/src/server/services/review-visibility";
import { ViewerHome } from "@/src/components/shell/ViewerHome";
import { listPinKeys } from "@/src/server/services/viewer-pins";
import { listStaleHandoffs, staleAfterDays } from "@/src/server/services/workspace-activity";
import { handoffStatusMeta } from "@/src/lib/handoff-status";
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
        notice={<ProfileNudge href={`/workspace/${workspace.id}/profile`} image={profile?.image ?? null} missing={missing} name={session.user.name} />}
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
          <div>
            <h1 className="font-semibold text-foreground">Projects</h1>
            <p className="mt-2 text-[13px] leading-5 text-foreground-muted">Each project keeps its source canvases, frozen versions, and review decisions together.</p>
          </div>
        </header>

        {await (async () => {
          const profile = await getProfile(session.user.id);
          const missing = [...(profile?.image ? [] : ["photo" as const]), ...(profile?.title || profile?.department ? [] : ["title" as const])];
          return <ProfileNudge className="mt-6" href={`/workspace/${workspace.id}/profile`} image={profile?.image ?? null} missing={missing} name={session.user.name} />;
        })()}

        <NeedsYou className="mt-6" initial={(await listOpenMentions(session.user.id, workspace.id, viewer))} />

        {await (async () => {
          const stale = await listStaleHandoffs(workspace.id, null);
          if (!stale.length) return null;
          return (
            <section aria-labelledby="stale-title" className="workspace-pane mt-6 p-3 pt-4">
              <div className="workspace-pane-heading px-2.5">
                <h2 className="text-[14px] font-semibold text-foreground" id="stale-title">Going stale</h2>
                <span className="workspace-pane-count font-mono text-[11px]">{stale.length.toString().padStart(2, "0")}</span>
              </div>
              <p className="px-2.5 pb-2 text-[12px] text-foreground-subtle">Not approved, and no new version, comment or status change in {staleAfterDays}+ days. Nudge reviewers or mark them approved.</p>
              <ul className="workspace-list">
                {stale.slice(0, 6).map((handoff) => {
                  const days = Math.floor((Date.now() - new Date(handoff.lastActivityAt).getTime()) / 86_400_000);
                  return (
                    <li key={handoff.handoffId}>
                      <Link className="workspace-list-item flex items-center gap-3 px-2.5 py-2.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary" href={`/workspace/${workspace.id}/projects/${handoff.projectId}/handoffs/${handoff.handoffId}`}>
                        <span aria-hidden="true" className={"size-1.5 shrink-0 rounded-full " + handoffStatusMeta[handoff.reviewStatus].dot} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium text-foreground">{handoff.handoffName}</span>
                          <span className="block truncate text-[11px] text-foreground-subtle">{handoff.projectName} · {handoffStatusMeta[handoff.reviewStatus].label}</span>
                        </span>
                        <span className="shrink-0 font-mono text-[11px] text-foreground-subtle">{days}d quiet</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })()}

        <div className="workspace-dashboard-columns mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <ProjectsPane workspaceId={workspace.id} projects={projects} canManage={canManage} newCounts={countUpdatesByProject(updates)} iconVersions={(await projectIconVersions(workspace.id))} pinnedIds={(await listPinKeys(session.user.id)).filter((key) => key.startsWith("project:")).map((key) => key.slice("project:".length))} />

          {canManage ? (
            <section aria-labelledby="invite-title" className="workspace-pane p-5 sm:p-6">
              <div className="workspace-pane-heading">
                <h2 className="text-[14px] font-semibold text-foreground" id="invite-title">Invite your team</h2>
              </div>
              <div className="mt-4"><CreateInviteForm key={workspace.id} workspaceId={workspace.id} initialInvites={invites} /></div>
              <div className="mt-8">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-[13px] font-semibold text-foreground" id="members-title">Members</h3>
                  <span className="font-mono text-[11px] text-foreground-subtle">{members.length}</span>
                </div>
                <MembersPanel canEdit={workspace.role === "owner"} currentUserId={session.user.id} initial={members} limit={5} manageHref={`/workspace/${workspace.id}/team`} workspaceId={workspace.id} />
              </div>
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
