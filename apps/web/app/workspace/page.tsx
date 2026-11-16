import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthShell } from "@/app/(auth)/auth-shell";
import { getSessionForHeaders, isDevelopmentAuthBypassActive } from "@/src/server/auth-session";
import { getDatabase } from "@/src/server/db";
import { ensureCompanyWorkspace } from "@/src/server/services/company-workspace";
import { needsOnboarding } from "@/src/server/services/onboarding";
import { syncSuperadminAccess } from "@/src/server/services/superadmins";
import { SignOutButton } from "./workspace-actions";

export const instant = false;

/**
 * Entry point after sign-in. There is one company workspace, so this only decides where to go:
 * onboarding for someone new, otherwise the projects home.
 */
export default async function WorkspaceHomePage() {
  const session = await getSessionForHeaders(await headers());
  if (!session) redirect("/sign-in");

  syncSuperadminAccess(session.user);
  const company = ensureCompanyWorkspace(session.user);
  if (needsOnboarding(session.user.id)) redirect("/onboarding");

  const member = getDatabase()
    .prepare("SELECT 1 FROM workspace_membership WHERE workspace_id = ? AND user_id = ?")
    .get(company.id, session.user.id);
  if (member) redirect(`/workspace/${company.id}`);

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
