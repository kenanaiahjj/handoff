import Link from "next/link";
import Image from "next/image";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getSessionForHeaders, isDevelopmentAuthBypassEnabled } from "@/src/server/auth-session";
import { getDatabase } from "@/src/server/db";
import { McpTokenManager } from "@/src/components/integrations/McpTokenManager";
import { SignOutButton } from "../../workspace-actions";

export const instant = false;

type IntegrationsPageProps = { params: Promise<{ workspaceId: string }> };

export default async function IntegrationsPage({ params }: IntegrationsPageProps) {
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
    .get(workspaceId, session.user.id) as { id: string; name: string; role: string } | undefined;
  if (!workspace) notFound();
  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-6 sm:px-8">
      <header className="flex items-center justify-between border-b border-border pb-5">
        <Link href={`/workspace/${workspaceId}`} className="inline-flex items-center gap-2 text-sm font-semibold tracking-[0.08em] text-foreground">
          <Image alt="" aria-hidden="true" className="size-7 rounded-control object-cover" height={28} src="/icons/asbir-handoff-v2-180.png" width={28} />
          ASBIR <span className="font-normal tracking-normal text-foreground-muted">/ HANDOFF</span>
        </Link>
        <SignOutButton hidden={isDevelopmentAuthBypassEnabled()} />
      </header>

      <nav aria-label="Breadcrumb" className="mt-5 flex items-center gap-2 text-xs text-foreground-subtle">
        <Link className="hover:text-foreground" href={`/workspace/${workspaceId}`}>{workspace.name}</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page" className="text-foreground-muted">Integrations</span>
      </nav>
      <section className="mt-6 border-b border-border pb-5">
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-primary">Workspace integrations</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">MCP access</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-foreground-muted">Connect Asbir Handoff to your AI client with a personal, scoped token. Your AI client can also use its own ClickUp, repository, and QA MCP connections. Tokens stop working when revoked, expired, or when you leave the workspace.</p>
      </section>
      <div className="mt-5"><McpTokenManager workspaceId={workspaceId} canManageAll={true} /></div>
    </main>
  );
}
