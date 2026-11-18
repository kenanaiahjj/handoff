"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState, useTransition } from "react";
import { useConfirm } from "@/src/components/ConfirmDialog";

type ProjectActionsProps = {
  workspaceId: string;
  projectId: string;
  projectName: string;
  handoffCount: number;
  /** Where to go after deleting when the project's own page is open. */
  afterDeleteHref: string;
  align?: "start" | "end";
};

/** Owners and designers: a "…" menu to rename or delete a project. */
export function ProjectActions({ workspaceId, projectId, projectName, handoffCount, afterDeleteHref, align = "end" }: ProjectActionsProps) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(projectName);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const menuRef = useRef<HTMLDivElement>(null);
  const renameRef = useRef<HTMLDialogElement>(null);
  const endpoint = `/api/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}`;

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

  async function rename(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(endpoint, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not rename this project.");
      setRenaming(false);
      startRefresh(() => router.refresh());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not rename this project.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setOpen(false);
    const confirmed = await confirm({
      title: `Delete ${projectName}?`,
      description: handoffCount
        ? `This deletes the project and its ${handoffCount === 1 ? "handoff" : `${handoffCount} handoffs`}, with every version, comment and note. This cannot be undone.`
        : "This deletes the project. This cannot be undone.",
      confirmLabel: "Delete project",
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      const response = await fetch(endpoint, { method: "DELETE" });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not delete this project.");
      startRefresh(() => {
        if (window.location.pathname.includes(`/projects/${projectId}`)) router.replace(afterDeleteHref);
        router.refresh();
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete this project.");
    } finally {
      setBusy(false);
    }
  }

  const pending = busy || refreshing;

  return (
    <div className="project-actions relative shrink-0" ref={menuRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Actions for ${projectName}`}
        className="grid size-8 place-items-center rounded-control text-foreground-subtle transition-colors hover:bg-white/[0.07] hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
        disabled={pending}
        onClick={() => setOpen((value) => !value)}
        title="Rename or delete"
        type="button"
      >
        {pending ? (
          <span aria-hidden="true" className="size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" />
        ) : (
          <svg aria-hidden="true" className="size-4" fill="currentColor" viewBox="0 0 16 16"><circle cx="3.5" cy="8" r="1.25" /><circle cx="8" cy="8" r="1.25" /><circle cx="12.5" cy="8" r="1.25" /></svg>
        )}
      </button>
      {open ? (
        <div className={"dial-popover absolute top-9 z-30 w-44 p-1 " + (align === "end" ? "right-0" : "left-0")} role="menu">
          <button className="flex h-8 w-full items-center gap-2 rounded-[7px] px-2.5 text-left text-[12px] text-foreground hover:bg-white/[0.07]" onClick={() => { setOpen(false); setName(projectName); setError(""); setRenaming(true); }} role="menuitem" type="button">
            <svg aria-hidden="true" className="size-3.5 text-foreground-subtle" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" viewBox="0 0 16 16"><path d="M10 3.5 12.5 6M3 13l.8-3L10.5 3.3a1.2 1.2 0 0 1 1.7 0l.5.5a1.2 1.2 0 0 1 0 1.7L6 12.2Z" /></svg>
            Rename
          </button>
          <button className="flex h-8 w-full items-center gap-2 rounded-[7px] px-2.5 text-left text-[12px] text-danger hover:bg-danger/10" onClick={() => void remove()} role="menuitem" type="button">
            <svg aria-hidden="true" className="size-3.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" viewBox="0 0 16 16"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" /></svg>
            Delete project
          </button>
        </div>
      ) : null}
      {error && !renaming ? <p className="absolute right-0 top-9 z-20 w-56 rounded-control bg-surface-raised px-2.5 py-1.5 text-[11px] text-danger" role="alert">{error}</p> : null}
      <dialog
        aria-labelledby={`rename-project-${projectId}`}
        className="dial-popover m-auto w-[min(92vw,380px)] p-0 text-foreground backdrop:bg-black/60 backdrop:backdrop-blur-sm"
        onClose={() => setRenaming(false)}
        ref={renameRef}
      >
        <form className="p-5" onSubmit={rename}>
          <h2 className="text-[15px] font-semibold" id={`rename-project-${projectId}`}>Rename project</h2>
          <label className="sr-only" htmlFor={`rename-project-input-${projectId}`}>Project name</label>
          <input
            autoFocus
            className="mt-4 h-10 w-full rounded-control bg-surface-inset px-3 text-[13px] text-foreground outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            id={`rename-project-input-${projectId}`}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            required
            value={name}
          />
          {error ? <p className="mt-2 text-[11px] text-danger" role="alert">{error}</p> : null}
          <div className="mt-5 flex justify-end gap-2">
            <button className="dial-button min-h-8 px-3 text-[12px]" onClick={() => setRenaming(false)} type="button">Cancel</button>
            <button className="min-h-8 rounded-control bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50" disabled={busy || !name.trim() || name.trim() === projectName} type="submit">
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </dialog>
      {dialog}
    </div>
  );
}
