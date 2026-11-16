import { redirect } from "next/navigation";
import { isGoogleSignInEnabled } from "@/src/server/auth";
import { isDevelopmentAuthBypassActive, isDevelopmentAuthBypassConfigured } from "@/src/server/auth-session";
import { allowedEmailDomains } from "@/src/server/services/onboarding";
import { SignInForm } from "./sign-in-form";

export const instant = false;

type SignInPageProps = {
  searchParams: Promise<{ redirectTo?: string | string[]; error?: string | string[] }>;
};

function safeReturnPath(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate?.startsWith("/") || candidate.startsWith("//")) return "/workspace";
  return candidate;
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const params = await searchParams;
  const redirectTo = safeReturnPath(params.redirectTo);
  if (await isDevelopmentAuthBypassActive()) redirect(redirectTo);
  return (
    <SignInForm
      companyDomains={allowedEmailDomains()}
      googleEnabled={isGoogleSignInEnabled()}
      googleError={Boolean(params.error)}
      devBypassAvailable={isDevelopmentAuthBypassConfigured()}
      redirectTo={redirectTo}
    />
  );
}
