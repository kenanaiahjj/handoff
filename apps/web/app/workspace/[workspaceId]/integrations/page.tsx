import type { ReactNode } from "react";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getSessionForHeaders } from "@/src/server/auth-session";
import { getDatabase } from "@/src/server/db";
import { listProjects } from "@/src/server/repositories/projects";
import { listWorkspaceMcpTokens } from "@/src/server/repositories/mcp-tokens";
import { canSeeWholeWorkspace, filterProjectsForViewer } from "@/src/server/services/review-visibility";
import { isSlackEnabled } from "@/src/server/services/slack";
import { McpTokenManager } from "@/src/components/integrations/McpTokenManager";
import { WorkspaceShell } from "@/src/components/shell/WorkspaceShell";
import { createWorkspaceNavigation } from "@/src/components/shell/workspace-navigation";

export const instant = false;

type IntegrationsPageProps = {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ open?: string | string[] }>;
};

type IntegrationId = "figma" | "mcp" | "slack";

function FigmaLogo({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 38 57">
      <path d="M19 28.5a9.5 9.5 0 1 1 19 0 9.5 9.5 0 0 1-19 0Z" fill="#1abcfe" />
      <path d="M0 47.5A9.5 9.5 0 0 1 9.5 38H19v9.5a9.5 9.5 0 1 1-19 0Z" fill="#0acf83" />
      <path d="M19 0v19h9.5a9.5 9.5 0 1 0 0-19H19Z" fill="#ff7262" />
      <path d="M0 9.5A9.5 9.5 0 0 0 9.5 19H19V0H9.5A9.5 9.5 0 0 0 0 9.5Z" fill="#f24e1e" />
      <path d="M0 28.5A9.5 9.5 0 0 0 9.5 38H19V19H9.5A9.5 9.5 0 0 0 0 28.5Z" fill="#a259ff" />
    </svg>
  );
}

function SlackLogo({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 54 54">
      <path d="M19.7 0a5.4 5.4 0 1 0 0 10.8h5.4V5.4A5.4 5.4 0 0 0 19.7 0Zm0 14.4H5.4a5.4 5.4 0 1 0 0 10.8h14.3a5.4 5.4 0 1 0 0-10.8Z" fill="#36c5f0" />
      <path d="M54 19.8a5.4 5.4 0 1 0-10.8 0v5.4h5.4a5.4 5.4 0 0 0 5.4-5.4Zm-14.4 0V5.4a5.4 5.4 0 1 0-10.8 0v14.4a5.4 5.4 0 1 0 10.8 0Z" fill="#2eb67d" />
      <path d="M34.2 54a5.4 5.4 0 1 0 0-10.8h-5.4v5.4a5.4 5.4 0 0 0 5.4 5.4Zm0-14.4h14.4a5.4 5.4 0 1 0 0-10.8H34.2a5.4 5.4 0 1 0 0 10.8Z" fill="#ecb22e" />
      <path d="M0 34.2a5.4 5.4 0 1 0 10.8 0v-5.4H5.4A5.4 5.4 0 0 0 0 34.2Zm14.4 0v14.4a5.4 5.4 0 1 0 10.8 0V34.2a5.4 5.4 0 1 0-10.8 0Z" fill="#e01e5a" />
    </svg>
  );
}

function McpLogo({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" viewBox="0 0 24 24">
      <path d="m4 17 6-6-6-6M12 19h8" />
    </svg>
  );
}

function LogoTile({ children, size = "md" }: { children: ReactNode; size?: "md" | "lg" }) {
  return (
    <span aria-hidden="true" className={"grid shrink-0 place-items-center rounded-[10px] border border-border bg-surface-inset text-foreground " + (size === "lg" ? "size-14" : "size-10")}>
      {children}
    </span>
  );
}

export default async function IntegrationsPage({ params, searchParams }: IntegrationsPageProps) {
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
    .get(workspaceId, session.user.id)) as { id: string; name: string; role: string } | undefined;
  if (!workspace) notFound();

  const canManage = canSeeWholeWorkspace(workspace.role);
  const [projects, tokens] = await Promise.all([
    listProjects(workspaceId) as Promise<Array<{ id: string; name: string; handoffCount: number; versionCount: number }>>,
    listWorkspaceMcpTokens({ workspaceId, userId: session.user.id, includeAll: false }),
  ]);
  const activeTokens = tokens.filter((token) => !token.revokedAt && !token.expired).length;
  const slackOn = isSlackEnabled();

  const integrations: Array<{ id: IntegrationId; name: string; summary: string; logo: ReactNode; status: string; connected: boolean }> = [
    { id: "figma", name: "Figma", summary: "Capture frames from Figma straight into a handoff.", logo: <FigmaLogo className="h-5" />, status: "", connected: false },
    { id: "mcp", name: "AI clients", summary: "Let Codex, Claude Code and other MCP clients read handoffs.", logo: <McpLogo className="size-5" />, status: activeTokens ? `${activeTokens} active token${activeTokens === 1 ? "" : "s"}` : "Not connected", connected: activeTokens > 0 },
    { id: "slack", name: "Slack", summary: "Direct messages for new versions, mentions and the weekly digest.", logo: <SlackLogo className="size-5" />, status: slackOn ? "On" : "Off", connected: slackOn },
  ];

  const openParam = (await searchParams).open;
  const open = integrations.find((item) => item.id === (Array.isArray(openParam) ? openParam[0] : openParam));

  return (
    <WorkspaceShell
      user={{ name: session.user.name, email: session.user.email }}
      workspace={workspace}
      navSections={await createWorkspaceNavigation({ workspaceId, companyName: workspace.name, isOwner: workspace.role === "owner", projects: (await filterProjectsForViewer(workspaceId, { id: session.user.id, email: session.user.email, role: workspace.role }, projects)), page: "integrations", canManage })}
      breadcrumbs={open ? [{ label: "Integrations", href: "/integrations" }, { label: open.name }] : [{ label: "Integrations" }]}
    >
      <main className="mx-auto w-full max-w-4xl px-5 py-7 sm:px-8 sm:py-10">
        {!open ? (
          <>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Integrations</h1>
            <p className="mt-1.5 text-[13px] text-foreground-muted">Bring designs in from Figma, and connect your AI clients and Slack.</p>
            <ul className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {integrations.map((item) => (
                <li key={item.id}>
                  <Link
                    className="group flex h-full flex-col rounded-panel border border-border bg-surface p-4 transition-colors hover:border-foreground-subtle/40 hover:bg-surface-raised/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    href={`/integrations?open=${item.id}`}
                  >
                    <span className="flex items-start justify-between gap-3">
                      <LogoTile>{item.logo}</LogoTile>
                      {item.status ? <span className={"mt-1 text-[11px] " + (item.connected ? "text-success" : "text-foreground-subtle")}>{item.status}</span> : null}
                    </span>
                    <span className="mt-4 text-[14px] font-semibold text-foreground">{item.name}</span>
                    <span className="mt-1 text-[12px] leading-5 text-foreground-muted">{item.summary}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <Link className="inline-flex items-center gap-1.5 text-[12px] text-foreground-subtle hover:text-foreground" href="/integrations">
              <svg aria-hidden="true" className="size-3.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" viewBox="0 0 16 16"><path d="M10 3.5 5.5 8l4.5 4.5" /></svg>
              Integrations
            </Link>
            <header className="mt-5 flex flex-wrap items-center gap-4 border-b border-border pb-6">
              <LogoTile size="lg">{open.logo}</LogoTile>
              <div className="min-w-0 flex-1">
                <h1 className="text-xl font-semibold tracking-tight text-foreground">{open.name}</h1>
                <p className="mt-1 text-[13px] text-foreground-muted">{open.summary}</p>
              </div>
              {open.id === "figma" ? (
                <a className="inline-flex min-h-9 items-center gap-2 rounded-control bg-primary px-4 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" download href="/api/figma-plugin">
                  <svg aria-hidden="true" className="size-3.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" viewBox="0 0 16 16"><path d="M8 2.5v7m0 0 2.5-2.5M8 9.5 5.5 7M3 10.5v2h10v-2" /></svg>
                  Download plugin
                </a>
              ) : open.id === "slack" ? (
                <span className={"text-[12px] " + (open.connected ? "text-success" : "text-foreground-subtle")}>{open.status}</span>
              ) : null}
            </header>

            {open.id === "figma" ? (
              <section aria-labelledby="figma-setup-title" className="mt-7">
                <h2 className="text-[14px] font-semibold text-foreground" id="figma-setup-title">Set up</h2>
                <ol className="mt-3 divide-y divide-border rounded-panel border border-border">
                  {[
                    ["Unzip the download", "Keep the folder somewhere permanent. Moving it later breaks the plugin."],
                    ["Import it in the Figma desktop app", "Plugins → Development → Import plugin from manifest, then pick manifest.json."],
                    ["Capture", "Run Asbir Handoff Capture from Plugins → Development, and paste the capture token from a project."],
                  ].map(([title, body], index) => (
                    <li className="flex gap-3 px-4 py-3.5" key={title}>
                      <span className="w-4 shrink-0 text-[13px] tabular-nums text-foreground-subtle">{index + 1}</span>
                      <span>
                        <span className="block text-[13px] font-medium text-foreground">{title}</span>
                        <span className="mt-0.5 block text-[12px] leading-5 text-foreground-muted">{body}</span>
                      </span>
                    </li>
                  ))}
                </ol>
                <p className="mt-4 text-[12px] leading-5 text-foreground-subtle">The download already points at this workspace, so there’s nothing to configure. When the plugin changes, download it again and re-import manifest.json. On a Figma Organization plan, an admin can publish it privately so it installs and updates for everyone.</p>
              </section>
            ) : null}

            {open.id === "mcp" ? (
              <div className="mt-7"><McpTokenManager canManageAll={canManage} workspaceId={workspaceId} /></div>
            ) : null}

            {open.id === "slack" ? (
              <section aria-labelledby="slack-title" className="mt-7 space-y-5">
                <div>
                  <h2 className="text-[14px] font-semibold text-foreground" id="slack-title">What it sends</h2>
                  <ul className="mt-3 divide-y divide-border rounded-panel border border-border text-[13px]">
                    <li className="px-4 py-3"><span className="text-foreground">New versions</span><span className="block text-[12px] text-foreground-muted">A direct message to everyone on the handoff, with a button to open it.</span></li>
                    <li className="px-4 py-3"><span className="text-foreground">Mentions</span><span className="block text-[12px] text-foreground-muted">When someone @mentions you in a comment.</span></li>
                    <li className="px-4 py-3"><span className="text-foreground">Weekly digest</span><span className="block text-[12px] text-foreground-muted">Monday summary of what changed across your projects.</span></li>
                  </ul>
                </div>
                <p className="text-[12px] leading-5 text-foreground-subtle">
                  {slackOn
                    ? "People are matched to Slack by email address. Each person picks everything, mentions only or nothing from the bell in the sidebar."
                    : "Slack is off for this workspace. To turn it on, create a Slack app with the chat:write, users:read and users:read.email scopes, then set its bot token as SLACK_BOT_TOKEN in the server’s environment and redeploy."}
                </p>
              </section>
            ) : null}
          </>
        )}
      </main>
    </WorkspaceShell>
  );
}
