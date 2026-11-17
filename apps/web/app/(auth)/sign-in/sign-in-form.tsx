"use client";

import { type FormEvent, useState } from "react";
import { authClient } from "@/src/client/auth-client";
import { AuthShell } from "../auth-shell";
import { FreshAccountButton } from "@/src/components/shell/DevAccountActions";

type SignInFormProps = { redirectTo: string; googleEnabled: boolean; googleError: boolean; companyDomains: string[]; devBypassAvailable?: boolean };

const inputClass =
  "h-11 w-full rounded-[10px] border border-border bg-surface/60 px-3.5 text-[14px] text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-foreground-subtle hover:border-border-strong focus-visible:border-foreground/40 focus-visible:shadow-[0_0_0_3px_rgb(255_255_255/0.08)]";

function GoogleIcon() {
  return (
    <svg aria-hidden="true" className="size-[18px]" viewBox="0 0 18 18">
      <path d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" fill="#4285F4" />
      <path d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.33-1.58-5.04-3.7H.96v2.33A9 9 0 0 0 9 18Z" fill="#34A853" />
      <path d="M3.96 10.72A5.41 5.41 0 0 1 3.68 9c0-.6.1-1.18.28-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3-2.33Z" fill="#FBBC05" />
      <path d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3 2.33C4.67 5.16 6.66 3.58 9 3.58Z" fill="#EA4335" />
    </svg>
  );
}

function Spinner() {
  return <span aria-hidden="true" className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent opacity-70" />;
}

export function SignInForm({ redirectTo, googleEnabled, googleError, companyDomains, devBypassAvailable = false }: SignInFormProps) {
  const companyEmails = companyDomains.map((domain) => "@" + domain).join(" or ");
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);
  const [pending, setPending] = useState<"google" | "email" | null>(null);
  const [showEmail, setShowEmail] = useState(!googleEnabled);
  const [errorMessage, setErrorMessage] = useState(
    googleError ? `We couldn't sign you in with Google.${companyEmails ? ` Use your ${companyEmails} account.` : ""}` : "",
  );

  async function signInWithGoogle() {
    setErrorMessage("");
    setPending("google");
    try {
      const result = await authClient.signIn.social({ provider: "google", callbackURL: redirectTo, errorCallbackURL: "/sign-in" });
      if (result.error) {
        setErrorMessage(result.error.message ?? "We couldn't start Google sign-in.");
        setPending(null);
      }
    } catch {
      setErrorMessage("We couldn't reach the sign-in service. Try again.");
      setPending(null);
    }
  }

  async function switchToLocalDevAccount() {
    await fetch("/api/dev/bypass", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: true, as: "reviewer" }) });
    window.location.replace(redirectTo);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setPending("email");

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const name = String(formData.get("name") ?? "").trim();

    try {
      const result = isCreatingAccount
        ? await authClient.signUp.email({ name, email, password, callbackURL: redirectTo })
        : await authClient.signIn.email({ email, password, callbackURL: redirectTo });

      if (result.error) {
        setErrorMessage(result.error.message ?? "We couldn't sign you in.");
        return;
      }
      window.location.assign(redirectTo);
    } catch {
      setErrorMessage("We couldn't reach the sign-in service. Try again.");
    } finally {
      setPending(null);
    }
  }

  const title = isCreatingAccount ? "Create your account" : "Sign in to Asbir Handoff";
  const subtitle = isCreatingAccount
    ? "Use your work email to join your team."
    : "Review handoffs, compare versions, and keep your team in sync.";

  return (
    <AuthShell
      footnote={googleEnabled && companyEmails ? <>Only {companyEmails} accounts can join.</> : null}
      subtitle={subtitle}
      title={title}
    >
      <div className="space-y-3">
        {googleEnabled ? (
          <button
            className="flex h-11 w-full items-center justify-center gap-2.5 rounded-[10px] bg-[#f4f4f4] px-4 text-[14px] font-medium text-[#161616] shadow-[0_1px_2px_rgb(0_0_0/0.4),inset_0_-1px_0_rgb(0_0_0/0.08)] transition-[background-color,transform] hover:bg-white active:scale-[0.985] disabled:cursor-wait disabled:opacity-70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60"
            disabled={pending !== null}
            onClick={signInWithGoogle}
            type="button"
          >
            {pending === "google" ? <Spinner /> : <GoogleIcon />}
            {pending === "google" ? "Redirecting to Google…" : "Continue with Google"}
          </button>
        ) : null}

        {googleEnabled && !showEmail ? (
          <button
            className="flex h-11 w-full items-center justify-center rounded-[10px] border border-border bg-surface/60 px-4 text-[14px] font-medium text-foreground transition-colors hover:border-border-strong hover:bg-surface-inset focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40"
            disabled={pending !== null}
            onClick={() => {
              setShowEmail(true);
              setErrorMessage("");
            }}
            type="button"
          >
            Continue with email
          </button>
        ) : null}

        {showEmail ? (
          <>
            {googleEnabled ? (
              <div aria-hidden="true" className="flex items-center gap-3 py-2 text-[12px] text-foreground-subtle">
                <span className="h-px flex-1 bg-border" />
                or
                <span className="h-px flex-1 bg-border" />
              </div>
            ) : null}
            <form aria-busy={pending === "email"} className="space-y-3" onSubmit={handleSubmit}>
              {isCreatingAccount ? (
                <label className="block">
                  <span className="sr-only">Your name</span>
                  <input autoComplete="name" className={inputClass} maxLength={100} name="name" placeholder="Your name" required />
                </label>
              ) : null}
              <label className="block">
                <span className="sr-only">Work email</span>
                <input autoComplete="email" autoFocus={googleEnabled} className={inputClass} name="email" placeholder="you@company.com" required type="email" />
              </label>
              <label className="block">
                <span className="sr-only">Password</span>
                <input
                  autoComplete={isCreatingAccount ? "new-password" : "current-password"}
                  className={inputClass}
                  minLength={12}
                  name="password"
                  placeholder={isCreatingAccount ? "Password (12+ characters)" : "Password"}
                  required
                  type="password"
                />
              </label>
              <button
                className="flex h-11 w-full items-center justify-center gap-2 rounded-[10px] border border-border bg-surface-inset px-4 text-[14px] font-medium text-foreground transition-colors hover:bg-surface-raised active:scale-[0.985] disabled:cursor-wait disabled:opacity-70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40"
                disabled={pending !== null}
                type="submit"
              >
                {pending === "email" ? <Spinner /> : null}
                {pending === "email" ? "Signing in…" : isCreatingAccount ? "Create account" : "Sign in with email"}
              </button>
            </form>
          </>
        ) : null}

        {errorMessage ? (
          <p className="rounded-[10px] border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[13px] leading-5 text-foreground" role="alert">
            {errorMessage}
          </p>
        ) : null}
      </div>

      {devBypassAvailable ? (
        <p className="mt-6 text-center text-[12px] text-foreground-subtle">
          Development:{" "}
          <button className="underline decoration-border-strong underline-offset-4 hover:text-foreground" onClick={switchToLocalDevAccount} type="button">
            Use local dev account (reviewer)
          </button>
          <span aria-hidden="true"> · </span>
          <FreshAccountButton className="underline decoration-border-strong underline-offset-4 hover:text-foreground" />
        </p>
      ) : null}

      {googleEnabled ? null : (
        <p className="mt-6 text-center text-[13px] text-foreground-muted">
          {isCreatingAccount ? "Already have an account?" : "New to Asbir Handoff?"}{" "}
          <button
            className="font-medium text-foreground underline decoration-border-strong underline-offset-4 hover:decoration-foreground"
            onClick={() => {
              setIsCreatingAccount((current) => !current);
              setErrorMessage("");
            }}
            type="button"
          >
            {isCreatingAccount ? "Sign in" : "Create an account"}
          </button>
        </p>
      )}
    </AuthShell>
  );
}
