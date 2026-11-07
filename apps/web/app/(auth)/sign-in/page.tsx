import { redirect } from "next/navigation";
import { isDevelopmentAuthBypassEnabled } from "@/src/server/auth-session";
import { SignInForm } from "./sign-in-form";

export const instant = false;

type SignInPageProps = {
  searchParams: Promise<{ redirectTo?: string | string[] }>;
};

function safeReturnPath(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate?.startsWith("/") || candidate.startsWith("//")) return "/workspace";
  return candidate;
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const params = await searchParams;
  const redirectTo = safeReturnPath(params.redirectTo);
  if (isDevelopmentAuthBypassEnabled()) redirect(redirectTo);
  return <SignInForm redirectTo={redirectTo} />;
}
