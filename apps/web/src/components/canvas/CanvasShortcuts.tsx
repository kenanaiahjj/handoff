"use client";

import { useEffect, useRef } from "react";

const groups: Array<{ title: string; items: Array<[string[], string]> }> = [
  {
    title: "Tools",
    items: [
      [["V"], "View: pan around without selecting"],
      [["I"], "Inspect: select elements"],
      [["C"], "Place a comment"],
      [["Esc"], "Cancel or close"],
    ],
  },
  {
    title: "Screens",
    items: [
      [["["], "Previous screen (zooms to it)"],
      [["]"], "Next screen (zooms to it)"],
      [["⌘", "F"], "Search text, colors and elements"],
      [["⌘", "L"], "Copy a link to the selected screen or element"],
    ],
  },
  {
    title: "View",
    items: [
      [["O"], "Outline every element"],
      [["G"], "Layout grids"],
      [["D"], "Show or hide change highlights"],
      [["+", "−"], "Zoom in and out (also ⌘+ and ⌘−)"],
      [["0"], "Fit everything (also ⌘0)"],
      [["⇧", "2"], "Zoom to the selected screen"],
      [["Alt"], "Hold over an element to measure distances"],
    ],
  },
  {
    title: "Panel",
    items: [
      [["⌘", "\\"], "Show or hide the side panels"],
      [["U"], "Cycle units: px, pt, dp, rem"],
      [["?"], "Show these shortcuts"],
    ],
  },
];

/** The "?" sheet listing every canvas shortcut. */
export function CanvasShortcuts({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "?") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      previous?.focus();
    };
  }, [onClose]);

  return (
    <div className="overlay-scrim fixed inset-0 z-[70] grid place-items-center p-4" onClick={onClose}>
      <div
        aria-labelledby="canvas-shortcuts-title"
        aria-modal="true"
        className="canvas-shortcuts w-full max-w-[560px] rounded-[14px] border border-white/[0.08] bg-[#141414] p-5 shadow-[0_24px_64px_-12px_rgb(0_0_0/0.85)] outline-none"
        onClick={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-foreground" id="canvas-shortcuts-title">Keyboard shortcuts</h2>
          <button aria-label="Close" className="grid size-8 place-items-center rounded-[8px] text-foreground-subtle hover:bg-white/[0.06] hover:text-foreground" onClick={onClose} type="button">
            <svg aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" viewBox="0 0 16 16"><path d="m4 4 8 8M12 4l-8 8" /></svg>
          </button>
        </div>
        <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          {groups.map((group) => (
            <section key={group.title}>
              <h3 className="mb-2 text-[11px] font-medium uppercase tracking-[0.06em] text-foreground-subtle">{group.title}</h3>
              <dl className="space-y-1.5">
                {group.items.map(([keys, label]) => (
                  <div className="flex items-center justify-between gap-3" key={label}>
                    <dt className="text-[12px] text-foreground-muted">{label}</dt>
                    <dd className="flex shrink-0 gap-1">
                      {keys.map((key) => <kbd className="canvas-kbd" key={key}>{key}</kbd>)}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
