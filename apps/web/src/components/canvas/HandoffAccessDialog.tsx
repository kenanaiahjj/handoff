"use client";

import { useEffect, useRef, useState } from "react";
import { HandoffSharingControls, type SharingPublishTarget } from "./HandoffSharingControls";

type HandoffAccessDialogProps = {
  endpoint: string;
  handoffName: string;
  variant?: "access" | "share";
  publishTarget?: SharingPublishTarget;
};

export function HandoffAccessDialog({ endpoint, handoffName, variant = "access", publishTarget }: HandoffAccessDialogProps) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const isShareDialog = variant === "share";

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
        aria-label={isShareDialog ? `Share ${handoffName}` : `Manage access to ${handoffName}`}
        className={isShareDialog
          ? "dial-button h-11 shrink-0 px-3 text-[12px] lg:h-8"
          : "dial-button min-h-8 shrink-0 px-3 text-xs"}
        onClick={() => setOpen(true)}
        title={isShareDialog ? "Share handoff and manage access" : "Manage access"}
        type="button"
      >
        {isShareDialog ? (
          <svg aria-hidden="true" className="size-3.5" fill="none" viewBox="0 0 16 16">
            <path d="m5.4 8 5.2-2.8M5.4 8l5.2 2.8" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
            <circle cx="3.8" cy="8" r="1.65" stroke="currentColor" strokeWidth="1.3" />
            <circle cx="12.2" cy="3.6" r="1.65" stroke="currentColor" strokeWidth="1.3" />
            <circle cx="12.2" cy="12.4" r="1.65" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        ) : null}
        {isShareDialog ? "Share" : "Access"}
      </button>
      <dialog
        aria-labelledby="handoff-access-dialog-title"
        className="dial-popover fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-xl overflow-hidden p-0 text-foreground backdrop:bg-black/60 backdrop:backdrop-blur-sm"
        onClose={(event) => {
          // Nested dialogs (confirmations) also emit close; only react to this dialog closing.
          if (event.target === event.currentTarget) setOpen(false);
        }}
        ref={dialogRef}
      >
        {open ? (
          <div className="max-h-[calc(100dvh-2rem)] overflow-y-auto p-4 sm:p-5">
            <header className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                {!isShareDialog ? <p className="text-[12px] font-medium text-foreground-subtle">Handoff access</p> : null}
                <h2 className={isShareDialog ? "text-base font-semibold text-foreground" : "mt-1 text-base font-semibold text-foreground"} id="handoff-access-dialog-title">{isShareDialog ? "Share handoff" : "Manage access"}</h2>
                <p className="mt-1 truncate text-xs text-foreground-muted">{handoffName}</p>
              </div>
              <button
                aria-label={isShareDialog ? "Close sharing settings" : "Close access settings"}
                className="grid size-8 shrink-0 place-items-center rounded-control text-foreground-subtle hover:bg-surface-raised hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
                onClick={() => setOpen(false)}
                type="button"
              >
                <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 16 16"><path d="m4 4 8 8m0-8-8 8" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" /></svg>
              </button>
            </header>
            <HandoffSharingControls endpoint={endpoint} handoffName={handoffName} publishTarget={publishTarget} />
          </div>
        ) : null}
      </dialog>
    </>
  );
}
