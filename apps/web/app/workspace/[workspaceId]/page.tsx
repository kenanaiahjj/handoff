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
import { listRecentHandoffs } from "@/src/server/services/workspace-activity";
import { listProjectPreviewKeys } from "@/src/server/repositories/handoffs";
import { workspaceRouteSlugs } from "@/src/server/services/route-slugs";
import { PanelDialog } from "@/src/components/shell/PanelDialog";
import { NewVersionBadge } from "@/src/components/shell/NewVersionBadge";
import { LocalTime } from "@/src/components/LocalTime";
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
  const [projects, updates, invites, members, recent, previews, routes] = await Promise.all([
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
    listRecentHandoffs(workspace.id, null),
    listProjectPreviewKeys(workspace.id),
    workspaceRouteSlugs(workspace.id),
  ]);
  const updatedHandoffs = new Set(updates.map((update) => update.handoffId));
  const navSections = await createWorkspaceNavigation({ workspaceId, companyName: workspace.name, isOwner: workspace.role === "owner", projects, page: "overview", canManage });

  return (
    <WorkspaceShell
      user={{ name: session.user.name, email: session.user.email }}
      workspace={workspace}
      navSections={navSections}
      breadcrumbs={[{ label: "Projects" }]}
    >
      <main className="workspace-dashboard mx-auto px-5 py-7 text-foreground sm:px-8 sm:py-9">
        <div className="workspace-dashboard-columns grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0">
          <ProjectsPane workspaceId={workspace.id} projects={projects} canManage={canManage} newCounts={countUpdatesByProject(updates)} iconVersions={(await projectIconVersions(workspace.id))} pinnedIds={(await listPinKeys(session.user.id)).filter((key) => key.startsWith("project:")).map((key) => key.slice("project:".length))} previews={previews} slugs={routes.projectSlugs}
            pageTitle
            actions={<PanelDialog
            icon={<svg aria-hidden="true" className="size-3.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" viewBox="0 0 16 16"><circle cx="6" cy="5.5" r="2.3" /><path d="M2 13c.4-2.3 2-3.7 4-3.7s3.6 1.4 4 3.7M12 5.5v4M10 7.5h4" /></svg>}
            label="Invite"
            labelledBy="invite-title"
          >
            <section aria-labelledby="invite-title" className="workspace-pane p-5">
              <h2 className="text-[15px] font-semibold text-foreground" id="invite-title">Invite your team</h2>
              <div className="mt-4"><CreateInviteForm key={workspace.id} workspaceId={workspace.id} initialInvites={invites} /></div>
            </section>
            <section aria-labelledby="members-title" className="workspace-pane p-5">
              <div className="mb-3 flex items-center justify-between pr-10">
                <h2 className="text-[15px] font-semibold text-foreground" id="members-title">Members</h2>
                <span className="text-[11px] tabular-nums text-foreground-subtle">{members.length}</span>
              </div>
              <MembersPanel canEdit={workspace.role === "owner"} currentUserId={session.user.id} initial={members} limit={5} manageHref={`/team`} workspaceId={workspace.id} />
            </section>
          </PanelDialog>}
            notice={await (async () => {
              const profile = await getProfile(session.user.id);
              const missing = [...(profile?.image ? [] : ["photo" as const]), ...(profile?.title || profile?.department ? [] : ["title" as const])];
              return missing.length ? <ProfileNudge href={`/profile`} image={profile?.image ?? null} missing={missing} name={session.user.name} /> : null;
            })()}
          />
          </div>

          <div className="min-w-0 max-xl:contents xl:sticky xl:top-20 xl:space-y-6 xl:self-start">
          <aside aria-labelledby="recent-title" className="workspace-pane p-3 pt-4">
            <div className="workspace-pane-heading px-2.5">
              <h2 className="text-[14px] font-semibold text-foreground" id="recent-title">Activity</h2>
              <Link className="text-[12px] text-foreground-subtle hover:text-foreground" href="/activity">See all</Link>
            </div>
            {recent.length ? (
              <ul className="workspace-list">
                {recent.map((handoff) => (
                  <li key={handoff.handoffId}>
                    <Link className="workspace-list-item flex items-start gap-3 px-2.5 py-2.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary" href={routes.handoff(handoff.projectId, handoff.handoffId)}>
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-[13px] font-medium text-foreground">{handoff.handoffName}</span>
                          {updatedHandoffs.has(handoff.handoffId) ? <NewVersionBadge label="New" /> : null}
                        </span>
                        <span className="block truncate text-[11px] text-foreground-subtle">{handoff.projectName} · {handoff.versionLabel}</span>
                      </span>
                      <span className="shrink-0 pt-0.5 text-[11px] text-foreground-subtle"><LocalTime format="day" iso={handoff.updatedAt} /></span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-2.5 py-6 text-[12px] text-foreground-subtle">No versions yet.</p>
            )}
          </aside>
          <NeedsYou className="max-xl:order-first" initial={(await listOpenMentions(session.user.id, workspace.id, viewer))} />
          </div>
        </div>
      </main>
    </WorkspaceShell>
  );
}
