import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getSessionForHeaders } from "@/src/server/auth-session";
import { getDatabase } from "@/src/server/db";
import { listProjects } from "@/src/server/repositories/projects";
import { listMembers } from "@/src/server/services/members";
import { listSuperadmins } from "@/src/server/services/superadmins";
import { canSeeWholeWorkspace, filterProjectsForViewer } from "@/src/server/services/review-visibility";
import { WorkspaceShell } from "@/src/components/shell/WorkspaceShell";
import { createWorkspaceNavigation } from "@/src/components/shell/workspace-navigation";
import { CreateInviteForm } from "../../workspace-actions";
import { SuperadminsPanel } from "../../superadmins-panel";
import { RoleGuide, TeamDirectory } from "../../team-directory";

export const instant = false;

type TeamPageProps = { params: Promise<{ workspaceId: string }> };

type WorkspaceInvite = { id: string; role: string; jobRole: string | null; expiresAt: string | null; createdAt: string };

/** Members, roles, invites and owners in one place, for owners (who edit) and designers (who view). */
export default async function TeamPage({ params }: TeamPageProps) {
  const session = await getSessionForHeaders(await headers());
  if (!session) redirect("/sign-in");
  const { workspaceId } = await params;
  const database = getDatabase();
  const workspace = (await database
    .prepare(
      `SELECT workspace.id, workspace.name, workspace_membership.role
       FROM workspace
       JOIN workspace_membership ON workspace_membership.workspace_id = workspace.id
       WHERE workspace.id = ? AND workspace_membership.user_id = ?`,
    )
    .get(workspaceId, session.user.id)) as { id: string; name: string; role: string } | undefined;
  if (!workspace) notFound();
  // Reviewers, developers and QA don't see the team; send them home rather than to an error.
  if (!canSeeWholeWorkspace(workspace.role)) redirect(`/workspace/${workspaceId}`);
  const isOwner = workspace.role === "owner";

  const [projects, members, invites, superadmins] = await Promise.all([
    listProjects(workspaceId) as Promise<Array<{ id: string; name: string; handoffCount: number; versionCount: number }>>,
    listMembers(workspaceId),
    database
      .prepare(
        `SELECT id, role, job_role AS jobRole, expires_at AS expiresAt, created_at AS createdAt
         FROM workspace_invite
         WHERE workspace_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY created_at DESC`,
      )
      .all(workspaceId, new Date().toISOString()) as Promise<WorkspaceInvite[]>,
    isOwner ? listSuperadmins() : Promise.resolve([]),
  ]);
  const viewer = { id: session.user.id, email: session.user.email, role: workspace.role };
  const roleCounts: Record<string, number> = {};
  for (const member of members) roleCounts[member.role] = (roleCounts[member.role] ?? 0) + 1;

  return (
    <WorkspaceShell
      user={{ name: session.user.name, email: session.user.email }}
      workspace={workspace}
      navSections={await createWorkspaceNavigation({
        workspaceId,
        companyName: workspace.name, isOwner: workspace.role === "owner",
        projects: await filterProjectsForViewer(workspaceId, viewer, projects),
        page: "team",
        canManage: true,
      })}
      breadcrumbs={[{ label: "Team" }]}
    >
      <main className="mx-auto w-full max-w-6xl px-5 py-7 sm:px-8 sm:py-9">
        <section className="pb-2">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Team</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-foreground-muted">
            {isOwner
              ? "Everyone in the workspace, what they can do, and how people join. Changes apply right away."
              : "Everyone in the workspace and what they can do. Ask an owner to change roles or invite people."}
          </p>
        </section>
        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <section aria-labelledby="team-members-title">
            <h2 className="sr-only" id="team-members-title">Members</h2>
            <TeamDirectory canEdit={isOwner} currentUserId={session.user.id} initial={members} workspaceId={workspaceId} />
          </section>
          <aside className="space-y-6">
            {isOwner ? (
              <section aria-labelledby="team-invite-title" className="workspace-pane p-5">
                <h2 className="text-[14px] font-semibold text-foreground" id="team-invite-title">Invite people</h2>
                <div className="mt-4"><CreateInviteForm initialInvites={invites} workspaceId={workspaceId} /></div>
              </section>
            ) : null}
            <section aria-labelledby="team-roles-title" className="workspace-pane p-5">
              <h2 className="text-[14px] font-semibold text-foreground" id="team-roles-title">Roles</h2>
              <div className="mt-3"><RoleGuide counts={roleCounts} /></div>
            </section>
            {isOwner ? (
              <section aria-labelledby="team-owners-title" className="workspace-pane p-5">
                <h2 className="text-[14px] font-semibold text-foreground" id="team-owners-title">Add an owner by email</h2>
                <p className="mt-1 text-[12px] leading-5 text-foreground-muted">They become an owner of every workspace when they sign in, even with an email outside the company domains.</p>
                <div className="mt-3"><SuperadminsPanel currentEmail={session.user.email} initial={superadmins} /></div>
              </section>
            ) : null}
          </aside>
        </div>
      </main>
    </WorkspaceShell>
  );
}
