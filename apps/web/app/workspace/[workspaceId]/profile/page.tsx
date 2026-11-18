import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getSessionForHeaders } from "@/src/server/auth-session";
import { getDatabase } from "@/src/server/db";
import { listProjects } from "@/src/server/repositories/projects";
import { getProfile } from "@/src/server/services/profiles";
import { canSeeWholeWorkspace, filterProjectsForViewer } from "@/src/server/services/review-visibility";
import { WorkspaceShell } from "@/src/components/shell/WorkspaceShell";
import { createWorkspaceNavigation } from "@/src/components/shell/workspace-navigation";
import { ProfileForm } from "@/src/components/profile/ProfileForm";
import { jobRoles, workspaceRoleDetails } from "@/src/lib/team-roles";

export const instant = false;

type ProfilePageProps = { params: Promise<{ workspaceId: string }> };

/** Your own profile: photo, name, and what your team sees next to your comments. */
export default async function ProfilePage({ params }: ProfilePageProps) {
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
  const profile = await getProfile(session.user.id);
  if (!profile) notFound();
  const viewer = { id: session.user.id, email: session.user.email, role: workspace.role };
  const projects = await filterProjectsForViewer(
    workspaceId,
    viewer,
    (await listProjects(workspaceId)) as Array<{ id: string; name: string; handoffCount: number; versionCount: number }>,
  );
  const roleDetail = workspaceRoleDetails.find((detail) => detail.role === workspace.role);
  const jobLabel = profile.jobRole && profile.jobRole in jobRoles ? jobRoles[profile.jobRole as keyof typeof jobRoles].label : null;

  return (
    <WorkspaceShell
      user={{ name: session.user.name, email: session.user.email, image: session.user.image ?? null }}
      workspace={workspace}
      navSections={await createWorkspaceNavigation({ workspaceId, companyName: workspace.name, isOwner: workspace.role === "owner", projects, page: "profile", canManage: canSeeWholeWorkspace(workspace.role) })}
      breadcrumbs={[{ label: "Profile" }]}
    >
      <main className="mx-auto w-full max-w-3xl px-5 py-7 sm:px-8 sm:py-9">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Profile</h1>
        <p className="mt-2 text-sm leading-6 text-foreground-muted">How you appear to your team on comments, mentions and the team list.</p>
        <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_240px]">
          <section aria-label="Edit profile" className="workspace-pane p-5 sm:p-6">
            <ProfileForm initial={profile} />
          </section>
          <aside className="space-y-3">
            <div className="workspace-pane p-4">
              <p className="text-[11px] text-foreground-subtle">Email</p>
              <p className="mt-0.5 truncate text-[13px] text-foreground">{profile.email}</p>
              <p className="mt-3 text-[11px] text-foreground-subtle">Access in {workspace.name}</p>
              <p className="mt-0.5 text-[13px] text-foreground">{roleDetail?.label ?? workspace.role}</p>
              {roleDetail ? <p className="mt-1 text-[11px] leading-4 text-foreground-subtle">{roleDetail.summary}</p> : null}
              {jobLabel ? (
                <>
                  <p className="mt-3 text-[11px] text-foreground-subtle">Job</p>
                  <p className="mt-0.5 text-[13px] text-foreground">{jobLabel}</p>
                </>
              ) : null}
              <p className="mt-3 text-[11px] leading-4 text-foreground-subtle">Owners change access from the Team page.</p>
            </div>
          </aside>
        </div>
      </main>
    </WorkspaceShell>
  );
}
