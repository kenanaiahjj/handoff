"use client";

import { useState } from "react";

function useDeleteAction(input: {
  endpoint: string;
  confirmation: string;
  fallbackError: string;
  afterDelete: (payload: Record<string, unknown>) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (pending || !window.confirm(input.confirmation)) return;
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

  return { pending, error, remove };
}

export function DeleteHandoffButton({ endpoint, handoffName, returnHref }: {
  endpoint: string;
  handoffName: string;
  returnHref: string;
}) {
  const action = useDeleteAction({
    endpoint,
    confirmation: `Delete “${handoffName}” and all of its versions, comments, and notes? This cannot be undone.`,
    fallbackError: "Could not delete this handoff.",
    afterDelete: () => window.location.assign(returnHref),
  });
  return (
    <div className="shrink-0">
      <button aria-label={`Delete handoff ${handoffName}`} className="min-h-9 rounded-control px-3 text-xs text-danger hover:bg-danger/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-danger disabled:opacity-50" disabled={action.pending} onClick={() => void action.remove()} type="button">
        {action.pending ? "Deleting…" : "Delete"}
      </button>
      {action.error ? <p className="mt-1 max-w-48 text-right text-[10px] text-danger" role="alert">{action.error}</p> : null}
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
    confirmation: `Delete Version ${versionLabel} from “${handoffName}”? Its comments and notes will also be deleted. This cannot be undone.`,
    fallbackError: "Could not delete this version.",
    afterDelete: (payload) => {
      const nextVersionId = typeof payload.remainingLatestVersionId === "string" ? payload.remainingLatestVersionId : null;
      const target = nextVersionId ? `${handoffHref}?versionId=${encodeURIComponent(nextVersionId)}` : handoffHref;
      window.location.assign(target);
    },
  });
  return (
    <div className="shrink-0">
      <button aria-label={`Delete version ${versionLabel}`} className="min-h-8 rounded-[4px] px-2 text-[10px] text-danger hover:bg-danger/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-danger disabled:opacity-50" disabled={action.pending} onClick={() => void action.remove()} type="button">
        {action.pending ? "Deleting…" : "Delete"}
      </button>
      {action.error ? <p className="mt-1 max-w-48 text-right text-[10px] text-danger" role="alert">{action.error}</p> : null}
    </div>
  );
}
