"use client";

import { useState } from "react";

/** Development only: sign this browser in as a brand-new company account and open onboarding. */
export async function startFreshDevAccount() {
  const response = await fetch("/api/dev/test-account", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  if (!response.ok) throw new Error("Could not create a test account.");
  const result = (await response.json()) as { redirectTo: string };
  // A full load drops every cached render from the previous identity.
  window.location.replace(result.redirectTo);
}

/** Development only: delete every throwaway account and go back to the owner view. */
export async function clearDevTestAccounts() {
  const response = await fetch("/api/dev/test-account", { method: "DELETE" });
  if (!response.ok) throw new Error("Could not remove test accounts.");
  const result = (await response.json()) as { redirectTo: string };
  window.location.replace(result.redirectTo);
}

export function FreshAccountButton({ className, label = "Use fresh account" }: { className?: string; label?: string }) {
  const [pending, setPending] = useState(false);
  return (
    <button
      className={className}
      disabled={pending}
      onClick={() => {
        setPending(true);
        startFreshDevAccount().catch(() => setPending(false));
      }}
      type="button"
    >
      {pending ? "Creating…" : label}
    </button>
  );
}

/** Pinned to the bottom of onboarding while testing with a throwaway account. */
export function DevOnboardingBar({ email }: { email: string }) {
  const [pending, setPending] = useState<"fresh" | "done" | null>(null);
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-4">
      <div className="dial-popover flex max-w-full items-center gap-2 py-1.5 pl-3 pr-1.5 text-[12px]">
        <span className="rounded-[5px] bg-warning/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-warning">Dev</span>
        <span className="min-w-0 truncate text-foreground-subtle">Test account · {email}</span>
        <button
          className="dial-button min-h-7 shrink-0 px-2.5 text-[12px]"
          disabled={pending !== null}
          onClick={() => {
            setPending("fresh");
            startFreshDevAccount().catch(() => setPending(null));
          }}
          type="button"
        >
          {pending === "fresh" ? "Creating…" : "Start over"}
        </button>
        <button
          className="min-h-7 shrink-0 rounded-[6px] px-2.5 text-[12px] text-foreground-muted hover:bg-surface-inset hover:text-foreground"
          disabled={pending !== null}
          onClick={() => {
            setPending("done");
            clearDevTestAccounts().catch(() => setPending(null));
          }}
          type="button"
        >
          {pending === "done" ? "Cleaning up…" : "Done testing"}
        </button>
      </div>
    </div>
  );
}
