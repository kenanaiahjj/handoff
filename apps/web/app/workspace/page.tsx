import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionForHeaders } from "@/src/server/auth-session";
import { getDatabase } from "@/src/server/db";
import { CreateWorkspaceForm } from "./workspace-actions";
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

  const workspaceChoices = workspaces as WorkspaceChoice[];

  return (
    <WorkspaceShell
      user={{ name: session.user.name, email: session.user.email }}
      workspaces={workspaceChoices}
      navSections={[{
        label: "Team spaces",
        items: [{ label: "All workspaces", href: "/workspace", icon: "grid", active: true }],
      }]}
      breadcrumbs={[{ label: "Team spaces" }]}
    >
      <main className="mx-auto w-full max-w-6xl px-5 py-7 sm:px-8 sm:py-9">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Your workspaces</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-foreground-muted">Handoffs, reviews, and implementation notes stay with the team that owns them.</p>
          </div>
          <span className="font-mono text-xs text-foreground-subtle">{workspaces.length.toString().padStart(2, "0")} spaces</span>
        </header>

        <div className="mt-8 grid gap-8 xl:grid-cols-[minmax(0,1fr)_320px]">
          <section aria-labelledby="workspace-list-title" className="min-w-0">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h2 className="text-sm font-semibold text-foreground" id="workspace-list-title">Available workspaces</h2>
              <span className="font-mono text-[11px] text-foreground-subtle">{workspaces.length.toString().padStart(2, "0")}</span>
            </div>
            {workspaces.length ? (
              <ul className="divide-y divide-border">
                {workspaces.map((workspace) => (
                  <li key={workspace.id}>
                    <Link className="group flex min-h-16 items-center gap-3 px-2 transition-colors hover:bg-surface/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary" href={`/workspace/${workspace.id}`}>
                      <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-control border border-border bg-surface text-xs font-medium text-foreground-muted">{workspace.name.trim().slice(0, 1).toUpperCase() || "W"}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">{workspace.name}</span>
                        <span className="mt-0.5 block text-xs text-foreground-subtle">{workspace.role === "reviewer" ? "Product manager / reviewer" : workspace.role}</span>
                      </span>
                      <svg aria-hidden="true" className="size-4 shrink-0 text-foreground-subtle transition-transform group-hover:translate-x-0.5" fill="none" viewBox="0 0 16 16"><path d="m6 3 5 5-5 5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></svg>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="border-b border-border px-2 py-8 text-sm text-foreground-muted">No workspaces yet. Create one or open a team invitation link.</p>
            )}
          </section>

          <section aria-labelledby="create-workspace-title" className="border-t border-border pt-5 xl:border-l xl:border-t-0 xl:pl-6 xl:pt-0">
            <h2 className="text-sm font-semibold text-foreground" id="create-workspace-title">Create a workspace</h2>
            <p className="mb-4 mt-1.5 text-xs leading-5 text-foreground-muted">Start a team space for a product or project, then invite the people who review and build it.</p>
            <CreateWorkspaceForm />
          </section>
        </div>
      </main>
    </WorkspaceShell>
  );
}
