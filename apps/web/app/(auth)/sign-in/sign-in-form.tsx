"use client";

import Link from "next/link";
import Image from "next/image";
import { type FormEvent, useState } from "react";
import { authClient } from "@/src/client/auth-client";

export function SignInForm({ redirectTo }: { redirectTo: string }) {
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setIsSubmitting(true);

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
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-background px-5 py-8 sm:px-8 lg:grid lg:place-items-center">
      <div className="mx-auto grid w-full max-w-5xl items-center gap-12 lg:grid-cols-[minmax(0,1fr)_420px]">
        <section aria-labelledby="auth-intro-title" className="hidden max-w-xl lg:block">
          <Link href="/" className="inline-flex items-center gap-2 text-xs font-semibold tracking-[0.04em] text-foreground">
            <Image alt="" aria-hidden="true" className="size-6 rounded-[5px] object-cover" height={24} src="/icons/asbir-handoff-v2-180.png" width={24} />
            ASBIR <span className="font-normal text-foreground-subtle">/ HANDOFF</span>
          </Link>
          <div className="mt-20 max-w-[470px]">
            <h1 className="text-3xl font-semibold leading-tight tracking-tight text-foreground" id="auth-intro-title">A frozen canvas with the details your team needs.</h1>
            <p className="mt-4 max-w-[410px] text-sm leading-6 text-foreground-muted">Capture a Figma design once. Review its screens, layout values, comments, and changes together.</p>
          </div>
          <dl className="mt-10 max-w-[470px] divide-y divide-border border-y border-border">
            <div className="flex items-center gap-4 py-3.5">
              <dt className="w-28 shrink-0 text-xs font-medium text-foreground">Snapshot</dt>
              <dd className="text-xs text-foreground-muted">Preserve the source canvas and its measurements.</dd>
            </div>
            <div className="flex items-center gap-4 py-3.5">
              <dt className="w-28 shrink-0 text-xs font-medium text-foreground">Compare</dt>
              <dd className="text-xs text-foreground-muted">See what changed between versions.</dd>
            </div>
            <div className="flex items-center gap-4 py-3.5">
              <dt className="w-28 shrink-0 text-xs font-medium text-foreground">Hand off</dt>
              <dd className="text-xs text-foreground-muted">Keep product, engineering, and QA in the same review.</dd>
            </div>
          </dl>
        </section>

        <section className="mx-auto w-full max-w-[420px] rounded-panel border border-border bg-surface p-6 sm:p-8">
          <Link href="/" className="inline-flex items-center gap-2 text-xs font-semibold tracking-[0.04em] text-foreground lg:hidden">
            <Image alt="" aria-hidden="true" className="size-6 rounded-[5px] object-cover" height={24} src="/icons/asbir-handoff-v2-180.png" width={24} />
            ASBIR <span className="font-normal text-foreground-subtle">/ HANDOFF</span>
          </Link>
          <div className="mt-0 space-y-2 lg:mt-0">
            <h2 className="text-xl font-semibold leading-tight tracking-tight text-foreground">
              {isCreatingAccount ? "Create your account" : "Sign in to Asbir Handoff"}
            </h2>
            <p className="text-sm leading-6 text-foreground-muted">
              {isCreatingAccount ? "Use your work email to join your team." : "Use your work email to open your team handoffs."}
            </p>
          </div>

          <form aria-busy={isSubmitting} className="mt-7 space-y-4" onSubmit={handleSubmit}>
          {isCreatingAccount && (
            <label className="block space-y-2 text-sm font-medium" htmlFor="name">
              <span>Your name</span>
              <input
                autoComplete="name"
                className="h-10 w-full rounded-control border border-border bg-surface-inset px-3 text-sm text-foreground outline-none transition-colors placeholder:text-foreground-subtle focus-visible:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                id="name"
                maxLength={100}
                name="name"
                required
              />
            </label>
          )}

          <label className="block space-y-2 text-sm font-medium" htmlFor="email">
            <span>Work email</span>
            <input
              autoComplete="email"
              className="h-10 w-full rounded-control border border-border bg-surface-inset px-3 text-sm text-foreground outline-none transition-colors placeholder:text-foreground-subtle focus-visible:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
              id="email"
              name="email"
              required
              placeholder="you@company.com"
              type="email"
            />
          </label>

          <label className="block space-y-2 text-sm font-medium" htmlFor="password">
            <span>Password</span>
            <input
              autoComplete={isCreatingAccount ? "new-password" : "current-password"}
              className="h-10 w-full rounded-control border border-border bg-surface-inset px-3 text-sm text-foreground outline-none transition-colors placeholder:text-foreground-subtle focus-visible:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
              id="password"
              minLength={12}
              name="password"
              required
              type="password"
            />
            {isCreatingAccount && <span className="block text-xs font-normal text-foreground-muted">Use at least 12 characters.</span>}
          </label>

          {errorMessage && <p className="rounded-control border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-foreground" id="auth-error" role="alert">{errorMessage}</p>}

          <button
            className="flex h-10 w-full items-center justify-center rounded-control bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover active:scale-[0.99] disabled:cursor-wait disabled:opacity-65"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting ? "Working…" : isCreatingAccount ? "Create account" : "Sign in"}
          </button>
          </form>

          <p className="mt-6 text-center text-xs text-foreground-muted">
          {isCreatingAccount ? "Already have an account?" : "New to Asbir Handoff?"}{" "}
          <button
            className="font-medium text-foreground underline decoration-border-strong underline-offset-4 hover:decoration-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            onClick={() => {
              setIsCreatingAccount((current) => !current);
              setErrorMessage("");
            }}
            type="button"
          >
            {isCreatingAccount ? "Sign in" : "Create an account"}
          </button>
          </p>
        </section>
      </div>
    </main>
  );
}
