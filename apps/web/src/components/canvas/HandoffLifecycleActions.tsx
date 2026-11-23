"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { HandoffAccessDialog } from "./HandoffAccessDialog";
import { useRouter } from "next/navigation";
import { useConfirm, type ConfirmOptions } from "@/src/components/ConfirmDialog";

function useDeleteAction(input: {
  endpoint: string;
  confirmation: ConfirmOptions;
  fallbackError: string;
  afterDelete: (payload: Record<string, unknown>) => void;
}) {
  const [requesting, setRequesting] = useState(false);
  // Covers the in-app refresh after the delete, so the button reads "Deleting…" until the list updates.
  const [refreshing, startRefresh] = useTransition();
  const pending = requesting || refreshing;
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  async function remove() {
    if (pending || !(await confirm(input.confirmation))) return;
    setRequesting(true);
    setError(null);
    try {
      const response = await fetch(input.endpoint, { method: "DELETE" });
      const payload = await response.json() as Record<string, unknown> & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? input.fallbackError);
      startRefresh(() => input.afterDelete(payload));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : input.fallbackError);
    } finally {
      setRequesting(false);
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
  const router = useRouter();
  const action = useDeleteAction({
    endpoint,
    confirmation: {
      title: "Delete handoff?",
      description: `“${handoffName}” and all of its versions, comments, and notes will be deleted. This cannot be undone.`,
      confirmLabel: "Delete handoff",
    },
    fallbackError: "Could not delete this handoff.",
    // Stay in the app (no full reload or loading screen): refresh the list, or go back to it.
    afterDelete: () => {
      if (window.location.pathname === new URL(returnHref, window.location.origin).pathname) router.refresh();
      else router.replace(returnHref);
    },
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
  const router = useRouter();
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
      router.replace(target);
      router.refresh();
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

/** Owners and designers: a "…" menu on a handoff card to rename it, edit who can open it, or delete it. */
export function HandoffActions({ endpoint, handoffName, returnHref }: { endpoint: string; handoffName: string; returnHref: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const [name, setName] = useState(handoffName);
  const [saving, setSaving] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const renameRef = useRef<HTMLDialogElement>(null);
  const deletion = useDeleteAction({
    endpoint,
    confirmation: {
      title: "Delete handoff?",
      description: `“${handoffName}” and all of its versions, comments, and notes will be deleted. This cannot be undone.`,
      confirmLabel: "Delete handoff",
    },
    fallbackError: "Could not delete this handoff.",
    afterDelete: () => {
      if (window.location.pathname === new URL(returnHref, window.location.origin).pathname) router.refresh();
      else router.replace(returnHref);
    },
  });

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    const element = renameRef.current;
    if (!element) return;
    if (renaming && !element.open) element.showModal();
    if (!renaming && element.open) element.close();
  }, [renaming]);

  async function rename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setRenameError(null);
    try {
      const response = await fetch(endpoint, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not rename this handoff.");
      setRenaming(false);
      router.refresh();
    } catch (cause) {
      setRenameError(cause instanceof Error ? cause.message : "Could not rename this handoff.");
    } finally {
      setSaving(false);
    }
  }

  const itemClass = "flex h-9 w-full items-center gap-2 rounded-[7px] px-2.5 text-left text-[13px] text-foreground hover:bg-white/[0.07]";

  return (
    <div className="relative shrink-0" ref={menuRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Options for ${handoffName}`}
        className="grid size-9 place-items-center rounded-control text-foreground-muted transition-colors hover:bg-white/[0.08] hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
        disabled={deletion.pending}
        onClick={() => setOpen((value) => !value)}
        title="Options"
        type="button"
      >
        {deletion.pending ? (
          <span aria-hidden="true" className="size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" />
        ) : (
          <svg aria-hidden="true" className="size-4" fill="currentColor" viewBox="0 0 16 16"><circle cx="3.5" cy="8" r="1.25" /><circle cx="8" cy="8" r="1.25" /><circle cx="12.5" cy="8" r="1.25" /></svg>
        )}
      </button>
      {open ? (
        <div className="dial-popover absolute right-0 top-10 z-30 w-44 p-1" role="menu">
          <button className={itemClass} onClick={() => { setOpen(false); setName(handoffName); setRenameError(null); setRenaming(true); }} role="menuitem" type="button">
            <svg aria-hidden="true" className="size-3.5 text-foreground-subtle" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" viewBox="0 0 16 16"><path d="M10 3.5 12.5 6M3 13l.8-3L10.5 3.3a1.2 1.2 0 0 1 1.7 0l.5.5a1.2 1.2 0 0 1 0 1.7L6 12.2Z" /></svg>
            Rename
          </button>
          <button className={itemClass} onClick={() => { setOpen(false); setAccessOpen(true); }} role="menuitem" type="button">
            <svg aria-hidden="true" className="size-3.5 text-foreground-subtle" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" viewBox="0 0 16 16"><circle cx="6" cy="5.5" r="2.3" /><path d="M2 13c.4-2.3 2-3.7 4-3.7s3.6 1.4 4 3.7M11 5v4M9 7h4" /></svg>
            Edit access
          </button>
          <button className="flex h-9 w-full items-center gap-2 rounded-[7px] px-2.5 text-left text-[13px] text-danger hover:bg-danger/10" onClick={() => { setOpen(false); void deletion.remove(); }} role="menuitem" type="button">
            <svg aria-hidden="true" className="size-3.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" viewBox="0 0 16 16"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" /></svg>
            Delete
          </button>
        </div>
      ) : null}
      {deletion.error ? <p className="absolute right-0 top-10 z-20 w-56 rounded-control bg-surface-raised px-2.5 py-1.5 text-[11px] text-danger" role="alert">{deletion.error}</p> : null}
      <dialog
        aria-labelledby={`rename-handoff-title-${endpoint}`}
        className="dial-popover m-auto w-[min(92vw,380px)] p-0 text-foreground backdrop:bg-black/70"
        onClose={() => setRenaming(false)}
        ref={renameRef}
      >
        <form className="p-5" onSubmit={rename}>
          <h2 className="text-[15px] font-semibold" id={`rename-handoff-title-${endpoint}`}>Rename handoff</h2>
          <label className="sr-only" htmlFor={`rename-handoff-input-${endpoint}`}>Handoff name</label>
          <input
            autoFocus
            className="mt-4 h-10 w-full rounded-control bg-surface-inset px-3 text-[13px] text-foreground outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            id={`rename-handoff-input-${endpoint}`}
            maxLength={100}
            onChange={(event) => setName(event.target.value)}
            required
            value={name}
          />
          {renameError ? <p className="mt-2 text-[11px] text-danger" role="alert">{renameError}</p> : null}
          <div className="mt-5 flex justify-end gap-2">
            <button className="dial-button min-h-8 px-3 text-[12px]" onClick={() => setRenaming(false)} type="button">Cancel</button>
            <button className="min-h-8 rounded-control bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50" disabled={saving || !name.trim() || name.trim() === handoffName} type="submit">
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </dialog>
      <HandoffAccessDialog endpoint={endpoint} handoffName={handoffName} onOpenChange={setAccessOpen} open={accessOpen} />
      {deletion.dialog}
    </div>
  );
}
