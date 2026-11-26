import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import { auth } from "@/src/server/auth";
import { getSessionForHeaders } from "@/src/server/auth-session";
import { getDatabase } from "@/src/server/db";
import { workspaceRoleLabel } from "@/src/lib/team-roles";
import { AuthShell } from "../../auth-shell";
import { ConsentButtons } from "./consent-buttons";

export const instant = false;

type ConsentPageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * An AI client (Claude Code, Codex, …) asked to connect to the MCP server. Better Auth sends the
 * person here with a signed copy of that request once they are signed in; Allow finishes it.
 */
export default async function OAuthConsentPage({ searchParams }: ConsentPageProps) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item);
  }

  const context = await auth.$context;
  if (!(await verifyOAuthQueryParams(query.toString(), context.secret))) {
    return (
      <AuthShell title="This link has expired" subtitle="Go back to your AI tool and connect again." >
        <span />
      </AuthShell>
    );
  }

  const requestHeaders = await headers();
  const session = await getSessionForHeaders(requestHeaders);
  if (!session) redirect(`/sign-in?${query.toString()}`);

  const membership = (await getDatabase()
    .prepare("SELECT role FROM workspace_membership WHERE user_id = ? ORDER BY created_at LIMIT 1")
    .get(session.user.id)) as { role: string } | undefined;

  const clientId = query.get("client_id") ?? "";
  const client = (await auth.api.getOAuthClientPublic({ query: { client_id: clientId }, headers: requestHeaders }).catch(() => null)) as
    | { client_name?: string }
    | null;
  const clientName = client?.client_name?.trim() || "An AI tool";

  if (!membership) {
    return (
      <AuthShell title="No workspace yet" subtitle="Ask an owner to invite you, then connect your AI tool again.">
        <span />
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={`Connect ${clientName}?`}
      subtitle={`It will work as you (${session.user.email}, ${workspaceRoleLabel(membership.role)}) and see the same handoffs you can.`}
      footnote={<>Only allow tools you started yourself. You can sign out of a tool by removing it from your AI client.</>}
    >
      <ul className="mb-5 space-y-2 text-[13px] leading-5 text-foreground-muted">
        <li>Read projects, screens, screenshots, measurements and version changes</li>
        <li>Compare versions and list what changed</li>
        <li>Add comments, draft changelogs and link tasks for you</li>
      </ul>
      <ConsentButtons />
    </AuthShell>
  );
}
