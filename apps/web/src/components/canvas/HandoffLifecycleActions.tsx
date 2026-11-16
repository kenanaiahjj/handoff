"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useConfirm, type ConfirmOptions } from "@/src/components/ConfirmDialog";

function useDeleteAction(input: {
  endpoint: string;
  confirmation: ConfirmOptions;
  fallbackError: string;
  afterDelete: (payload: Record<string, unknown>) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  async function remove() {
    if (pending || !(await confirm(input.confirmation))) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(input.endpoint, { method: "DELETE" });
      const payload = await response.json() as Record<string, unknown> & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? input.fallbackError);
      input.afterDelete(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : input.fallbackError);
    } finally {
      setPending(false);
    }
  }

  return { pending, error, remove, dialog };
}

export function RenameHandoffButton({ endpoint, handoffName }: { endpoint: string; handoffName: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(handoffName);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function cancel() {
    setName(handoffName);
    setError(null);
    setEditing(false);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(endpoint, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not rename this handoff.");
      setEditing(false);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not rename this handoff.");
    } finally {
      setPending(false);
    }
  }

  if (!editing) {
    return (
      <div className="shrink-0">
        <button
          aria-label={`Rename handoff ${handoffName}`}
          className="dial-button min-h-8 px-3 text-xs"
          onClick={() => { setName(handoffName); setEditing(true); }}
          type="button"
        >
          Rename
        </button>
      </div>
    );
  }

  return (
    <div className="w-full">
      <form className="flex min-w-0 items-center gap-1.5" onSubmit={save}>
        <label className="sr-only" htmlFor={`rename-handoff-${endpoint}`}>Handoff name</label>
        <input
          autoFocus
          className="h-9 min-w-0 flex-1 rounded-control border border-transparent bg-surface-inset px-3 text-xs text-foreground outline-none placeholder:text-foreground-subtle focus-visible:border-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-hover"
          id={`rename-handoff-${endpoint}`}
          maxLength={100}
          onChange={(event) => setName(event.target.value)}
          required
          value={name}
        />
        <button
          className="min-h-9 rounded-control px-3 text-xs font-medium text-foreground hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
          disabled={pending}
          type="submit"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <button
          className="dial-button min-h-9 px-3 text-xs"
          disabled={pending}
          onClick={cancel}
          type="button"
        >
          Cancel
        </button>
      </form>
      {error ? <p className="mt-1 text-right text-[10px] text-danger" role="alert">{error}</p> : null}
    </div>
  );
}

export function DeleteHandoffButton({ endpoint, handoffName, returnHref }: {
  endpoint: string;
  handoffName: string;
  returnHref: string;
}) {
  const action = useDeleteAction({
    endpoint,
    confirmation: {
      title: "Delete handoff?",
      description: `“${handoffName}” and all of its versions, comments, and notes will be deleted. This cannot be undone.`,
      confirmLabel: "Delete handoff",
    },
    fallbackError: "Could not delete this handoff.",
    afterDelete: () => window.location.assign(returnHref),
  });
  return (
    <div className="shrink-0">
      <button aria-label={`Delete handoff ${handoffName}`} className="dial-button min-h-8 px-3 text-xs !text-danger hover:!bg-danger/15" disabled={action.pending} onClick={() => void action.remove()} type="button">
        {action.pending ? "Deleting…" : "Delete"}
      </button>
      {action.error ? <p className="mt-1 max-w-48 text-right text-[10px] text-danger" role="alert">{action.error}</p> : null}
      {action.dialog}
    </div>
  );
}

export function DeleteHandoffVersionButton({ endpoint, handoffName, versionLabel, handoffHref }: {
  endpoint: string;
  handoffName: string;
  versionLabel: string;
  handoffHref: string;
}) {
  const action = useDeleteAction({
    endpoint,
    confirmation: {
      title: `Delete Version ${versionLabel}?`,
      description: `This version of “${handoffName}” and its comments and notes will be deleted. This cannot be undone.`,
      confirmLabel: "Delete version",
    },
    fallbackError: "Could not delete this version.",
    afterDelete: (payload) => {
      const nextVersionId = typeof payload.remainingLatestVersionId === "string" ? payload.remainingLatestVersionId : null;
      const target = nextVersionId ? `${handoffHref}?versionId=${encodeURIComponent(nextVersionId)}` : handoffHref;
      window.location.assign(target);
    },
  });
  return (
    <div className="shrink-0">
      <button aria-label={`Delete version ${versionLabel}`} className="min-h-8 rounded-chip px-2 text-[10px] text-danger hover:bg-danger/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-danger disabled:opacity-50" disabled={action.pending} onClick={() => void action.remove()} type="button">
        {action.pending ? "Deleting…" : "Delete"}
      </button>
      {action.error ? <p className="mt-1 max-w-48 text-right text-[10px] text-danger" role="alert">{action.error}</p> : null}
      {action.dialog}
    </div>
  );
}
