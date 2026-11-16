"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

export type QuickOpenItem = { id: string; label: string; detail: string; href: string; isNew?: boolean };

/** ⌘K / Ctrl+K: type part of a project or handoff name, arrows to move, Enter to open. */
export function QuickOpen({ items }: { items: QuickOpenItem[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
      } else if (event.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the search each time it opens.
    setQuery("");
    setActive(0);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const results = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const matching = words.length
      ? items.filter((item) => words.every((word) => `${item.label} ${item.detail}`.toLowerCase().includes(word)))
      : items;
    return matching.slice(0, 12);
  }, [items, query]);

  function go(item: QuickOpenItem | undefined) {
    if (!item) return;
    setOpen(false);
    router.push(item.href);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[65] flex items-start justify-center bg-black/50 px-4 pt-[14vh] backdrop-blur-[2px]" onMouseDown={() => setOpen(false)}>
      <div
        aria-label="Quick open"
        aria-modal="true"
        className="dial-popover quick-open w-full max-w-[560px] overflow-hidden"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="flex items-center gap-2.5 border-b border-border px-4">
          <svg aria-hidden="true" className="size-4 shrink-0 text-foreground-subtle" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" viewBox="0 0 16 16">
            <circle cx="7" cy="7" r="4.5" />
            <path d="m10.5 10.5 3 3" />
          </svg>
          <input
            aria-activedescendant={results[active] ? `quick-open-${results[active].id}` : undefined}
            aria-controls="quick-open-results"
            className="h-12 min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-foreground-subtle"
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((index) => Math.min(index + 1, results.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((index) => Math.max(index - 1, 0));
              } else if (event.key === "Enter") {
                event.preventDefault();
                go(results[active]);
              }
            }}
            placeholder="Jump to a project or handoff…"
            ref={inputRef}
            role="combobox"
            aria-expanded="true"
            value={query}
          />
          <kbd className="onboarding-kbd">esc</kbd>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto p-1.5" id="quick-open-results" role="listbox">
          {results.length ? (
            results.map((item, index) => (
              <li
                aria-selected={index === active}
                className="quick-open-item flex cursor-pointer items-center gap-3 rounded-[8px] px-3 py-2"
                data-active={index === active || undefined}
                id={`quick-open-${item.id}`}
                key={item.id}
                onClick={() => go(item)}
                onMouseMove={() => setActive(index)}
                role="option"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-foreground">{item.label}</span>
                  <span className="block truncate text-[12px] text-foreground-subtle">{item.detail}</span>
                </span>
                {item.isNew ? <span aria-label="New version" className="viewer-dot" /> : null}
              </li>
            ))
          ) : (
            <li className="px-3 py-6 text-center text-[13px] text-foreground-subtle">No matches</li>
          )}
        </ul>
      </div>
    </div>
  );
}
