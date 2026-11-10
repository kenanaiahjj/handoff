import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getSessionForHeaders } from "@/src/server/auth-session";
import { getDatabase } from "@/src/server/db";
import { listProjects } from "@/src/server/repositories/projects";
import { CreateInviteForm, CreateProjectForm } from "../workspace-actions";
import { WorkspaceShell, type WorkspaceChoice } from "@/src/components/shell/WorkspaceShell";

export const instant = false;

type WorkspacePageProps = {
  params: Promise<{ workspaceId: string }>;
};

type WorkspaceDetail = {
  id: string;
  name: string;
  role: string;
};

type ProjectCard = {
  id: string;
  name: string;
  createdAt: string;
  handoffCount: number;
  versionCount: number;
};

type WorkspaceInvite = {
  id: string;
  role: string;
  expiresAt: string | null;
  createdAt: string;
};

export default async function WorkspacePage({ params }: WorkspacePageProps) {
  const session = await getSessionForHeaders(await headers());
  if (!session) redirect("/sign-in");

  const { workspaceId } = await params;
  const workspace = getDatabase()
    .prepare(
      `SELECT workspace.id, workspace.name, workspace_membership.role
       FROM workspace
       JOIN workspace_membership ON workspace_membership.workspace_id = workspace.id
       WHERE workspace.id = ? AND workspace_membership.user_id = ?`,
    )
    .get(workspaceId, session.user.id) as WorkspaceDetail | undefined;

  if (!workspace) notFound();

  const projects = listProjects(workspace.id) as ProjectCard[];
  const invites = getDatabase()
    .prepare(
      `SELECT id, role, expires_at AS expiresAt, created_at AS createdAt
       FROM workspace_invite
       WHERE workspace_id = ? AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > ?)
       ORDER BY created_at DESC`,
    )
    .all(workspaceId, new Date().toISOString()) as WorkspaceInvite[];
  const workspaces = getDatabase()
    .prepare(
      `SELECT workspace.id, workspace.name, workspace_membership.role
       FROM workspace
       JOIN workspace_membership ON workspace_membership.workspace_id = workspace.id
       WHERE workspace_membership.user_id = ?
       ORDER BY workspace.created_at DESC`,
    )
    .all(session.user.id) as WorkspaceChoice[];
  const navSections = [
    {
      label: "Workspace",
      items: [
        { label: "Overview", href: `/workspace/${workspaceId}`, icon: "home" as const, active: true },
        { label: "Integrations", href: `/workspace/${workspaceId}/integrations`, icon: "settings" as const },
      ],
    },
    ...(projects.length ? [{
      label: "Projects",
      items: projects.map((project) => ({ label: project.name, href: `/workspace/${workspaceId}/projects/${project.id}`, icon: "folder" as const })),
    }] : []),
  ];

  return (
    <WorkspaceShell
      user={{ name: session.user.name, email: session.user.email }}
      workspace={workspace}
      workspaces={workspaces}
      navSections={navSections}
      breadcrumbs={[{ label: "Team spaces", href: "/workspace" }, { label: workspace.name }]}
    >
      <main className="mx-auto w-full max-w-6xl px-5 py-7 text-foreground sm:px-8 sm:py-9">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[20px] font-semibold tracking-[-0.02em] text-foreground">{workspace.name}</h1>
            <p className="mt-1.5 max-w-2xl text-[13px] leading-5 text-foreground-muted">Projects keep source canvases, frozen versions, and review decisions together.</p>
          </div>
          <span className="rounded-control bg-surface-raised px-2.5 py-1.5 text-[10px] capitalize text-foreground-muted">{workspace.role}</span>
        </header>

        <div className="mt-8 grid gap-8 xl:grid-cols-[minmax(0,1fr)_320px]">
          <section aria-labelledby="projects-title" className="min-w-0" id="projects">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h2 className="text-[13px] font-semibold text-foreground" id="projects-title">Projects</h2>
              <span className="font-mono text-[10px] text-foreground-subtle">{projects.length.toString().padStart(2, "0")}</span>
            </div>
            {projects.length ? (
              <ul className="divide-y divide-border">
                {projects.map((project) => (
                  <li className="flex min-h-[66px] items-center gap-3 px-2 transition-colors hover:bg-surface-raised/60" key={project.id}>
                    <Link aria-label={`Open ${project.name}`} className="flex min-w-0 flex-1 items-center gap-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary" href={`/workspace/${workspace.id}/projects/${project.id}`}>
                      <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-control bg-surface-raised text-foreground-subtle"><svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 16 16"><rect height="10" rx="1.4" stroke="currentColor" strokeWidth="1.2" width="10" x="3" y="3" /><path d="M6 3v10M8.5 5h2.5M8.5 7.5h2.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.2" /></svg></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-foreground">{project.name}</span>
                        <span className="mt-0.5 block text-[11px] text-foreground-subtle">{project.handoffCount} handoffs <span aria-hidden="true">·</span> {project.versionCount} versions</span>
                      </span>
                    </Link>
                    <Link className="shrink-0 rounded-control bg-primary px-2.5 py-1.5 text-[10px] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-hover" href={`/workspace/${workspace.id}/projects/${project.id}#start-handoff`}>Start handoff</Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="border-b border-border px-2 py-7 text-[12px] text-foreground-muted">No projects yet. Create one to start a design handoff.</p>
            )}
            <div className="mt-5 border-t border-border pt-5"><CreateProjectForm workspaceId={workspace.id} /></div>
          </section>

          <section aria-labelledby="invite-title" className="border-t border-border pt-5 xl:border-l xl:border-t-0 xl:pl-6 xl:pt-0">
            <h2 className="text-[13px] font-semibold text-foreground" id="invite-title">Invite your team</h2>
            <div className="mt-3"><CreateInviteForm key={workspace.id} workspaceId={workspace.id} initialInvites={invites} /></div>
          </section>
        </div>
      </main>
    </WorkspaceShell>
  );
}
