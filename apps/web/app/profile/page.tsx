import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionForHeaders } from "@/src/server/auth-session";
import { getDatabase } from "@/src/server/db";

/** /profile opens your profile inside your first workspace (profiles are the same everywhere). */
export default async function ProfileRedirect() {
  const session = await getSessionForHeaders(await headers());
  if (!session) redirect("/sign-in?redirectTo=/profile");
  const membership = (await getDatabase()
    .prepare("SELECT workspace_id AS workspaceId FROM workspace_membership WHERE user_id = ? ORDER BY created_at ASC LIMIT 1")
    .get(session.user.id)) as { workspaceId: string } | undefined;
  redirect(membership ? `/workspace/${membership.workspaceId}/profile` : "/workspace");
}
