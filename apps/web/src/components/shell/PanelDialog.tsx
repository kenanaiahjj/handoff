"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

/**
 * A header button that opens one or more existing panels in a modal. The panels keep their own
 * headings; inside the dialog their pane background and padding are dropped so they read as one sheet.
 */
export function PanelDialog({ label, labelledBy, primary = false, icon, children }: {
  label: string;
  labelledBy: string;
  primary?: boolean;
  icon?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  const pathname = usePathname();
  const previousPathname = useRef(pathname);
  const close = useCallback(() => {
    const dialog = ref.current;
    if (dialog?.open) dialog.close();
    setOpen(false);
  }, []);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    const routeChanged = previousPathname.current !== pathname;
    previousPathname.current = pathname;
    if (routeChanged) {
      close();
    } else if (open && !dialog.open) {
      dialog.showModal();
      dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    } else if (!open && dialog.open) dialog.close();

    return () => {
      if (dialog.open) dialog.close();
    };
  }, [open, pathname, close]);

  return (
    <>
      <button
        aria-haspopup="dialog"
        className={primary
          ? "inline-flex h-10 shrink-0 items-center gap-1.5 rounded-control bg-primary px-4 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:h-9"
          : "dial-button inline-flex h-10 shrink-0 items-center gap-1.5 px-3.5 text-[13px] sm:h-9"}
        onClick={() => setOpen(true)}
        type="button"
      >
        {icon}
        {label}
      </button>
      <dialog
        aria-labelledby={labelledBy}
        className="dial-popover fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-xl overflow-hidden p-0 text-foreground backdrop:bg-black/70"
        onClick={(event) => {
          // A click on the backdrop lands on the dialog element itself.
          if (event.target === event.currentTarget) close();
        }}
        onClose={(event) => {
          if (event.target === event.currentTarget) close();
        }}
        ref={ref}
      >
        {open ? (
          <div className="relative max-h-[calc(100dvh-2rem)] divide-y divide-border overflow-y-auto [&_.workspace-pane]:rounded-none [&_.workspace-pane]:bg-transparent [&_.workspace-pane]:p-5 sm:[&_.workspace-pane]:p-6">
            <button
              aria-label="Close"
              className="absolute right-3 top-3 z-10 grid size-9 place-items-center rounded-control text-foreground-subtle hover:bg-surface-raised hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
              onClick={close}
              type="button"
            >
              <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 16 16"><path d="m4 4 8 8m0-8-8 8" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" /></svg>
            </button>
            {children}
          </div>
        ) : null}
      </dialog>
    </>
  );
}
