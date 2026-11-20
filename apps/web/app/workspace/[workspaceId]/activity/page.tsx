import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getSessionForHeaders } from "@/src/server/auth-session";
import { getDatabase } from "@/src/server/db";
import { listProjects } from "@/src/server/repositories/projects";
import { canSeeWholeWorkspace, filterProjectsForViewer, visibleHandoffIds } from "@/src/server/services/review-visibility";
import { listWorkspaceActivity, type ActivityEvent } from "@/src/server/services/workspace-activity";
import { WorkspaceShell } from "@/src/components/shell/WorkspaceShell";
import { createWorkspaceNavigation } from "@/src/components/shell/workspace-navigation";
import { Avatar } from "@/src/components/Avatar";
import { LocalTime } from "@/src/components/LocalTime";
import { workspaceRouteSlugs } from "@/src/server/services/route-slugs";

export const instant = false;

type ActivityPageProps = { params: Promise<{ workspaceId: string }> };

function describe(event: ActivityEvent) {
  if (event.kind === "version") return <>published version <span className="font-mono text-[12px] text-foreground">{event.detail}</span> of</>;
  return <>commented on</>;
}

/** What happened lately in the workspace, limited to handoffs this person can see. */
export default async function ActivityPage({ params }: ActivityPageProps) {
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
  const viewer = { id: session.user.id, email: session.user.email, role: workspace.role };
  const [projects, visible] = await Promise.all([
    listProjects(workspaceId).then((all) => filterProjectsForViewer(workspaceId, viewer, all as Array<{ id: string; name: string; handoffCount: number; versionCount: number }>)),
    visibleHandoffIds(workspaceId, viewer),
  ]);
  const [events, routes] = await Promise.all([listWorkspaceActivity(workspaceId, visible), workspaceRouteSlugs(workspaceId)]);
  // Grouped by UTC day on the server; each heading shows the day in the viewer's time zone.
  const days = new Map<string, ActivityEvent[]>();
  for (const event of events) {
    const key = event.at.slice(0, 10);
    days.set(key, [...(days.get(key) ?? []), event]);
  }

  return (
    <WorkspaceShell
      user={{ name: session.user.name, email: session.user.email, image: session.user.image ?? null }}
      workspace={workspace}
      navSections={await createWorkspaceNavigation({ workspaceId, companyName: workspace.name, isOwner: workspace.role === "owner", projects, page: "activity", canManage: canSeeWholeWorkspace(workspace.role) })}
      breadcrumbs={[{ label: "Activity" }]}
    >
      <main className="mx-auto w-full max-w-3xl px-5 py-7 sm:px-8 sm:py-9">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Activity</h1>
        <p className="mt-2 text-sm leading-6 text-foreground-muted">New versions and comments across the handoffs you can see.</p>
        {events.length ? (
          <div className="mt-8 space-y-8">
            {[...days].map(([key, dayEvents]) => (
              <section key={key}>
                <h2 className="mb-2 px-2 text-[12px] font-medium text-foreground-subtle"><LocalTime format="day" iso={dayEvents[0].at} /></h2>
                <ol className="space-y-0.5">
                  {dayEvents.map((event) => (
                    <li key={event.id}>
                      <Link
                        className="flex items-start gap-3 rounded-[10px] px-2 py-2.5 transition-colors hover:bg-white/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                        href={routes.handoff(event.projectId, event.handoffId)}
                      >
                        <Avatar name={event.actorName ?? "Someone"} size={26} src={event.actorImage} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] leading-5 text-foreground-muted">
                            <span className="font-medium text-foreground">{event.actorName ?? "Someone"}</span> {describe(event)}{" "}
                            <span className="font-medium text-foreground">{event.handoffName}</span>
                            <span className="text-foreground-subtle"> · {event.projectName}</span>
                          </span>
                          {event.kind === "comment" ? <span className="mt-1 line-clamp-2 block text-[12px] leading-[1.45] text-foreground-subtle">{event.detail}</span> : null}
                        </span>
                        <time className="shrink-0 pt-0.5 font-mono text-[11px] text-foreground-subtle" dateTime={event.at}>
                          <LocalTime format="time" iso={event.at} />
                        </time>
                      </Link>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
        ) : (
          <p className="mt-10 text-center text-[13px] text-foreground-subtle">Nothing yet. New versions and comments will show up here.</p>
        )}
      </main>
    </WorkspaceShell>
  );
}
