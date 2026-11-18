"use client";

import { useEffect, useRef, useState } from "react";
import { NotificationSettings } from "./NotificationSettings";

/** Bell button in the sidebar footer that opens the Slack notification choice. */
export function NotificationSettingsButton() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        aria-expanded={open}
        aria-label="Notification settings"
        className="grid size-8 place-items-center rounded-control text-foreground-subtle transition-colors hover:bg-white/[0.07] hover:text-foreground"
        onClick={() => setOpen((value) => !value)}
        title="Notifications"
        type="button"
      >
        <svg aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" viewBox="0 0 16 16">
          <path d="M4 6.5a4 4 0 0 1 8 0c0 3 1.2 4.5 1.5 5h-11c.3-.5 1.5-2 1.5-5Z" />
          <path d="M6.5 13.5a1.6 1.6 0 0 0 3 0" />
        </svg>
      </button>
      {open ? (
        <div className="dial-popover absolute bottom-9 left-0 z-30 w-64 p-1.5">
          <NotificationSettings />
        </div>
      ) : null}
    </div>
  );
}
