import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthShell } from "@/app/(auth)/auth-shell";
import { getSessionForHeaders, isDevelopmentAuthBypassActive } from "@/src/server/auth-session";
import { getDatabase } from "@/src/server/db";
import { ensureCompanyWorkspace } from "@/src/server/services/company-workspace";
import { needsOnboarding } from "@/src/server/services/onboarding";
import { syncSuperadminAccess } from "@/src/server/services/superadmins";
import { SignOutButton } from "./workspace-actions";
import WorkspacePage from "./[workspaceId]/page";

export const instant = false;

/**
 * Home after sign-in. There is one company workspace, so this is its projects home for members,
 * onboarding for someone new, and a "no access yet" page for anyone else.
 */
export default async function WorkspaceHomePage() {
  const session = await getSessionForHeaders(await headers());
  if (!session) redirect("/sign-in");

  (await syncSuperadminAccess(session.user));
  const company = (await ensureCompanyWorkspace(session.user));
  if ((await needsOnboarding(session.user.id))) redirect("/onboarding");

  const member = (await getDatabase()
    .prepare("SELECT 1 FROM workspace_membership WHERE workspace_id = ? AND user_id = ?")
    .get(company.id, session.user.id));
  if (member) return <WorkspacePage params={Promise.resolve({ workspaceId: company.id })} />;

  // Signed in and onboarded, but not given access (for example, an email outside the company).
  return (
    <AuthShell
      footnote={<>Signed in as {session.user.email}</>}
      subtitle="Ask an admin to invite you, then come back here."
      title="You don’t have access yet"
    >
      <div className="flex justify-center [&>button]:border [&>button]:border-border">
        <SignOutButton devBypass={await isDevelopmentAuthBypassActive()} />
      </div>
    </AuthShell>
  );
}
