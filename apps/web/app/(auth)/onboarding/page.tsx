import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionForHeaders } from "@/src/server/auth-session";
import { jobRoles, joinableWorkspaces, needsOnboarding } from "@/src/server/services/onboarding";
import { syncSuperadminAccess } from "@/src/server/services/superadmins";
import { OnboardingForm } from "./onboarding-form";

export const instant = false;

export default async function OnboardingPage() {
  const session = await getSessionForHeaders(await headers());
  if (!session) redirect("/sign-in?redirectTo=/onboarding");
  syncSuperadminAccess(session.user);
  if (!needsOnboarding(session.user.id)) redirect("/workspace");

  const workspaces = joinableWorkspaces({
    id: session.user.id,
    email: session.user.email,
    emailVerified: session.user.emailVerified,
  });
  const roles = Object.entries(jobRoles).map(([id, role]) => ({ id, label: role.label, description: role.description, manages: role.workspaceRole === "designer" }));
  return (
    <OnboardingForm
      roles={roles}
      user={{ name: session.user.name, email: session.user.email, image: session.user.image ?? null }}
      workspaceNames={workspaces.map((workspace) => workspace.name)}
    />
  );
}
