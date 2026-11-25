"use client";

import { useState } from "react";
import { showToast } from "@/src/components/shell/Toaster";
import { Markdown } from "./Markdown";

type Handbook = { markdown: string; isDefault: boolean; updatedAt: string | null; updatedByName: string | null };

const primaryButton = "inline-flex h-8 items-center rounded-control bg-primary px-3 text-[12px] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const secondaryButton = "inline-flex h-8 items-center rounded-control border border-border px-3 text-[12px] font-medium text-foreground transition-colors hover:bg-surface-raised disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

function updatedLine(handbook: Handbook) {
  if (handbook.isDefault || !handbook.updatedAt) return "Built-in guide. Edit it to make it this workspace’s own.";
  const date = new Date(handbook.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return `Edited ${date}${handbook.updatedByName ? ` by ${handbook.updatedByName}` : ""}.`;
}

/** The naming handbook: everyone reads it; owners and designers edit the Markdown in place. */
export function HandbookView({ workspaceId, initial, canEdit }: { workspaceId: string; initial: Handbook; canEdit: boolean }) {
  const [handbook, setHandbook] = useState(initial);
  const [draft, setDraft] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(method: "PUT" | "DELETE", body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/handbook`, {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "The handbook couldn’t be saved. Try again.");
      setHandbook(result as Handbook);
      setDraft(null);
      setPreview(false);
      showToast(method === "PUT" ? "Handbook saved" : "Back to the built-in guide");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The handbook couldn’t be saved. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    if (window.confirm("Replace this workspace’s handbook with the built-in guide? Your edits will be lost.")) void send("DELETE");
  }

  return (
    <section aria-label="Naming handbook">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <p className="text-[12px] text-foreground-subtle">{updatedLine(handbook)}</p>
        {canEdit ? (
          draft === null ? (
            <div className="flex gap-2">
              {!handbook.isDefault ? <button className={secondaryButton} disabled={busy} onClick={reset} type="button">Reset to built-in</button> : null}
              <button className={secondaryButton} onClick={() => setDraft(handbook.markdown)} type="button">Edit</button>
            </div>
          ) : (
            <div className="flex gap-2">
              <button className={secondaryButton} onClick={() => setPreview((value) => !value)} type="button">{preview ? "Edit Markdown" : "Preview"}</button>
              <button className={secondaryButton} disabled={busy} onClick={() => { setDraft(null); setPreview(false); setError(null); }} type="button">Cancel</button>
              <button className={primaryButton} disabled={busy || draft === handbook.markdown} onClick={() => void send("PUT", { markdown: draft })} type="button">{busy ? "Saving…" : "Save"}</button>
            </div>
          )
        ) : null}
      </div>
      {error ? <p className="mt-3 text-[12px] text-danger" role="alert">{error}</p> : null}
      <div className="mt-6">
        {draft !== null && !preview ? (
          <textarea
            aria-label="Handbook Markdown"
            className="min-h-[70vh] w-full resize-y rounded-control border border-border bg-surface px-3.5 py-3 font-mono text-[12px] leading-5 text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            onChange={(event) => setDraft(event.target.value)}
            spellCheck={false}
            value={draft}
          />
        ) : (
          <Markdown source={draft ?? handbook.markdown} />
        )}
      </div>
    </section>
  );
}
