import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionForHeaders } from "@/src/server/auth-session";
import { jobRoles, joinableWorkspaces, needsOnboarding } from "@/src/server/services/onboarding";
import { syncSuperadminAccess } from "@/src/server/services/superadmins";
import { OnboardingForm } from "./onboarding-form";
import { getProfile } from "@/src/server/services/profiles";
import { isDevelopmentAuthBypassActive } from "@/src/server/auth-session";
import { isDevTestAccount } from "@/src/server/services/dev-test-accounts";
import { DevOnboardingBar } from "@/src/components/shell/DevAccountActions";

export const instant = false;

export default async function OnboardingPage() {
  const session = await getSessionForHeaders(await headers());
  if (!session) redirect("/sign-in?redirectTo=/onboarding");
  (await syncSuperadminAccess(session.user));
  if (!(await needsOnboarding(session.user.id))) redirect("/workspace");

  const workspaces = (await joinableWorkspaces({
    id: session.user.id,
    email: session.user.email,
    emailVerified: session.user.emailVerified,
  }));
  const roles = Object.entries(jobRoles).map(([id, role]) => ({ id, label: role.label, description: role.description, requestsApproval: id === "designer" }));
  const profile = await getProfile(session.user.id);
  const testing = isDevTestAccount(session.user.id) && (await isDevelopmentAuthBypassActive());
  return (
    <>
    <OnboardingForm
      roles={roles}
      user={{ name: session.user.name, email: session.user.email, image: session.user.image ?? null }}
      workspaceNames={workspaces.map((workspace) => workspace.name)}
      profile={{
        name: session.user.name,
        email: session.user.email,
        image: profile?.image ?? session.user.image ?? null,
        title: profile?.title ?? null,
        department: profile?.department ?? null,
        pronouns: profile?.pronouns ?? null,
        timezone: profile?.timezone ?? null,
        bio: profile?.bio ?? null,
      }}
    />
    {testing ? <DevOnboardingBar email={session.user.email} /> : null}
    </>
  );
}
