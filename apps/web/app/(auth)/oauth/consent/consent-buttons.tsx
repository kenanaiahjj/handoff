"use client";

import { useState } from "react";
import { authClient } from "@/src/client/auth-client";

const buttonClass =
  "flex h-11 w-full items-center justify-center rounded-[10px] px-4 text-[14px] font-medium transition-colors active:scale-[0.985] disabled:cursor-wait disabled:opacity-70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40";

export function ConsentButtons() {
  const [pending, setPending] = useState<"allow" | "deny" | null>(null);
  const [error, setError] = useState("");

  async function answer(accept: boolean) {
    setPending(accept ? "allow" : "deny");
    setError("");
    // The auth client's OAuth plugin attaches this page's signed request (oauth_query).
    const result = await authClient.$fetch<{ redirect: boolean; url: string }>("/oauth2/consent", { method: "POST", body: { accept } });
    if (result.error || !result.data?.url) {
      setError(result.error?.message ?? "That didn't work. Go back to your AI tool and connect again.");
      setPending(null);
      return;
    }
    window.location.assign(result.data.url);
  }

  return (
    <div className="space-y-2.5">
      <button className={buttonClass + " bg-primary text-primary-foreground hover:bg-primary-hover"} disabled={pending !== null} onClick={() => answer(true)} type="button">
        {pending === "allow" ? "Connecting…" : "Allow"}
      </button>
      <button className={buttonClass + " border border-border bg-surface-inset text-foreground hover:bg-surface-raised"} disabled={pending !== null} onClick={() => answer(false)} type="button">
        Cancel
      </button>
      {error ? (
        <p className="rounded-[10px] border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[13px] leading-5 text-foreground" role="alert">{error}</p>
      ) : null}
    </div>
  );
}
