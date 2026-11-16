"use client";

import { useState } from "react";
import { clearDevTestAccounts, FreshAccountButton } from "./DevAccountActions";

type ViewAsMode = "owner" | "reviewer";

/** Development-only toggle between the workspace owner and a seeded reviewer account. */
export function ViewAsSwitcher({ current, workspaceId }: { current: ViewAsMode | "test"; workspaceId: string }) {
  const [pending, setPending] = useState<ViewAsMode | null>(null);
  const [error, setError] = useState("");

  async function switchTo(mode: ViewAsMode) {
    if (mode === current || pending) return;
    setPending(mode);
    setError("");
    try {
      const response = await fetch("/api/dev/view-as", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, workspaceId }),
      });
      if (!response.ok) throw new Error();
      // A full load drops every cached server render from the previous identity.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`/workspace/${encodeURIComponent(workspaceId)}`);
    } catch {
      setError("Could not switch views.");
      setPending(null);
    }
  }

  return (
    <div className="px-3 pb-3">
      <p className="mb-1.5 px-0.5 text-[12px] font-medium text-foreground-subtle">View as · dev</p>
      <div aria-label="View the app as" className="dial-segmented grid w-full grid-cols-2" role="group">
        {(["owner", "reviewer"] as const).map((mode) => (
          <button
            aria-pressed={current === mode}
            className="min-h-8 px-2 text-[12px]"
            disabled={pending !== null}
            key={mode}
            onClick={() => void switchTo(mode)}
            type="button"
          >
            {pending === mode ? "Switching…" : mode === "owner" ? "Owner" : "Reviewer"}
          </button>
        ))}
      </div>
      {current === "test" ? (
        <button
          className="mt-1.5 w-full rounded-control px-2 py-1.5 text-left text-[12px] text-foreground-subtle transition-colors hover:bg-surface-raised hover:text-foreground"
          onClick={() => void clearDevTestAccounts()}
          type="button"
        >
          Done testing (remove test accounts)
        </button>
      ) : null}
      <FreshAccountButton className="mt-1.5 w-full rounded-control px-2 py-1.5 text-left text-[12px] text-foreground-subtle transition-colors hover:bg-surface-raised hover:text-foreground" label="+ Fresh account (onboarding)" />
      {error ? <p className="mt-1 text-[10px] text-danger" role="alert">{error}</p> : null}
    </div>
  );
}
