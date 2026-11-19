"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BrandMark } from "@/src/components/shell/BrandMark";

type InviteInfo = {
  workspaceName: string;
  role: string;
  roleLabel?: string;
  expiresAt: string | null;
  reusable: boolean;
};

export function InviteClient({ token }: { token: string }) {
  const router = useRouter();
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let active = true;
    fetch(`/api/invites/${encodeURIComponent(token)}`)
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "This invitation is unavailable.");
        if (active) setInvite(result as InviteInfo);
      })
      .catch((error: unknown) => {
        if (active) setErrorMessage(error instanceof Error ? error.message : "This invitation is unavailable.");
      });

    return () => {
      active = false;
    };
  }, [token]);

  async function acceptInvite() {
    setPending(true);
    setErrorMessage("");

    try {
      const response = await fetch(`/api/invites/${encodeURIComponent(token)}`, { method: "POST" });
      const result = await response.json();
      if (response.status === 401) {
        const redirectTo = `/invite/${encodeURIComponent(token)}`;
        router.push(`/sign-in?redirectTo=${encodeURIComponent(redirectTo)}`);
        return;
      }
      if (!response.ok) {
        setErrorMessage(result.error ?? "We couldn't accept this invitation.");
        return;
      }
      router.push(`/workspace`);
      router.refresh();
    } catch {
      setErrorMessage("We couldn't reach the invitation service. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-12">
      <section className="w-full max-w-[440px] rounded-panel border border-border bg-surface p-6 sm:p-8">
        <Link aria-label="Asbir Handoff home" href="/" className="inline-flex"><BrandMark /></Link>
        <p className="mt-8 text-[12px] font-medium text-foreground-subtle">Team invitation</p>
        <h1 className="mt-2 text-title font-semibold leading-title text-foreground">
          {invite ? "Join your team on Asbir Handoff" : "Review invitation"}
        </h1>
        {invite ? (
          <p className="mt-3 text-sm leading-6 text-foreground-muted" role="status">
            You will join as <span className="font-medium text-foreground">{invite.roleLabel ?? invite.role}</span>. {invite.reusable ? "This link can be reused" : "This link can be used once"}{invite.expiresAt ? ` and expires ${new Date(invite.expiresAt).toLocaleDateString()}.` : ". It stays active until a workspace member revokes it."}
          </p>
        ) : !errorMessage ? (
          <p className="mt-3 text-sm text-foreground-muted" role="status">Checking the invitation…</p>
        ) : null}
        {errorMessage && <p className="mt-4 rounded-control border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-foreground" role="alert">{errorMessage}</p>}
        {invite && (
          <button
            className="mt-6 h-11 w-full rounded-control bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60"
            disabled={pending}
            onClick={acceptInvite}
            type="button"
          >
            {pending ? "Joining…" : "Accept invitation"}
          </button>
        )}
        <p className="mt-6 text-sm text-foreground-muted">
          Need an account? <Link className="font-medium text-foreground underline decoration-border-strong underline-offset-4" href={`/sign-in?redirectTo=${encodeURIComponent(`/invite/${token}`)}`}>Create one or sign in</Link>.
        </p>
      </section>
    </main>
  );
}
