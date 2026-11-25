import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isGoogleSignInEnabled } from "@/src/server/auth";
import { isDevelopmentAuthBypassActive, isDevelopmentAuthBypassConfigured } from "@/src/server/auth-session";
import { companyEmailDomains } from "@/src/server/services/onboarding";
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

/**
 * Link previews (Slack, iMessage…) are signed out, so a pasted review link lands here. Describe what
 * the link opens, without saying anything about the handoff itself.
 */
export async function generateMetadata({ searchParams }: SignInPageProps): Promise<Metadata> {
  const redirectTo = safeReturnPath((await searchParams).redirectTo);
  const isReview = redirectTo.startsWith("/review/") || redirectTo.startsWith("/playground");
  if (!isReview) return {};
  const title = redirectTo.startsWith("/playground") ? "Playground · Asbir Handoff" : "Design review · Asbir Handoff";
  const description = "Sign in to review the designs and leave comments.";
  return { title, description, openGraph: { title, description, siteName: "Asbir Handoff" } };
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const params = await searchParams;
  const redirectTo = safeReturnPath(params.redirectTo);
  if (await isDevelopmentAuthBypassActive()) redirect(redirectTo);
  return (
    <SignInForm
      companyDomains={await companyEmailDomains()}
      googleEnabled={isGoogleSignInEnabled()}
      googleError={Boolean(params.error)}
      devBypassAvailable={isDevelopmentAuthBypassConfigured()}
      redirectTo={redirectTo}
    />
  );
}
