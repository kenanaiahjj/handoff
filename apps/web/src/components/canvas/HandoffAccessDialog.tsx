"use client";

import { useEffect, useRef, useState } from "react";
import { HandoffSharingControls } from "./HandoffSharingControls";

export function HandoffAccessDialog({ endpoint, handoffName }: { endpoint: string; handoffName: string }) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <>
      <button
        aria-haspopup="dialog"
        aria-label={`Manage access to ${handoffName}`}
        className="min-h-9 shrink-0 rounded-control px-2.5 text-xs font-medium text-foreground-muted hover:bg-surface-raised hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        onClick={() => setOpen(true)}
        title="Manage access"
        type="button"
      >
        Access
      </button>
      <dialog
        aria-labelledby="handoff-access-dialog-title"
        className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-xl overflow-hidden rounded-[8px] border border-border bg-surface p-0 text-foreground shadow-2xl backdrop:bg-black/70"
        onClose={() => setOpen(false)}
        ref={dialogRef}
      >
        {open ? (
          <div className="max-h-[calc(100dvh-2rem)] overflow-y-auto p-4 sm:p-5">
            <header className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-foreground-subtle">Handoff access</p>
                <h2 className="mt-1 text-base font-semibold text-foreground" id="handoff-access-dialog-title">Manage access</h2>
                <p className="mt-1 truncate text-xs text-foreground-muted">{handoffName}</p>
              </div>
              <button
                aria-label="Close access settings"
                className="grid size-8 shrink-0 place-items-center rounded-control text-foreground-subtle hover:bg-surface-raised hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
                onClick={() => setOpen(false)}
                type="button"
              >
                <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 16 16"><path d="m4 4 8 8m0-8-8 8" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" /></svg>
              </button>
            </header>
            <HandoffSharingControls endpoint={endpoint} />
          </div>
        ) : null}
      </dialog>
    </>
  );
}
