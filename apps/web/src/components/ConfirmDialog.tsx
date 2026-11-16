"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";

export type ConfirmOptions = {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "danger" | "default";
};

type PendingConfirm = ConfirmOptions & { resolve: (confirmed: boolean) => void };

/**
 * Promise-based confirmation that renders a styled modal instead of window.confirm.
 * Render `dialog` once in the component, then `if (!(await confirm({...}))) return;`.
 */
export function useConfirm() {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => {
    setPending({ ...options, resolve });
  }), []);

  const settle = useCallback((confirmed: boolean) => {
    setPending((current) => {
      current?.resolve(confirmed);
      return null;
    });
  }, []);

  const dialog = pending ? <ConfirmDialog options={pending} onSettle={settle} /> : null;
  return { confirm, dialog };
}

function ConfirmDialog({ options, onSettle }: { options: ConfirmOptions; onSettle: (confirmed: boolean) => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const danger = options.tone !== "default";

  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement as HTMLElement | null;
    if (dialog && !dialog.open) dialog.showModal();
    cancelRef.current?.focus();
    return () => {
      if (dialog?.open) dialog.close();
      opener?.focus?.();
    };
  }, []);

  return (
    <dialog
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      className="fixed inset-0 m-auto w-[calc(100vw-2rem)] max-w-sm overflow-hidden rounded-panel border border-border bg-surface p-0 text-foreground shadow-lg backdrop:bg-black/70"
      onCancel={(event) => {
        event.preventDefault();
        onSettle(false);
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onSettle(false);
      }}
      ref={dialogRef}
      role="alertdialog"
    >
      <div className="p-5">
        <h2 className="text-sm font-semibold text-foreground" id={titleId}>{options.title}</h2>
        <div className="mt-2 text-xs leading-5 text-foreground-muted" id={descriptionId}>{options.description}</div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            className="min-h-9 rounded-control px-3 text-xs text-foreground-muted hover:bg-surface-raised hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            onClick={() => onSettle(false)}
            ref={cancelRef}
            type="button"
          >
            {options.cancelLabel ?? "Cancel"}
          </button>
          <button
            className={danger
              ? "min-h-9 rounded-control bg-danger/15 px-3 text-xs font-semibold text-danger hover:bg-danger/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-danger"
              : "capture-primary-action min-h-9 rounded-control px-3 text-xs font-semibold"}
            onClick={() => onSettle(true)}
            type="button"
          >
            {options.confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
