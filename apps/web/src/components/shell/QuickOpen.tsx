"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

export type QuickOpenItem = { id: string; label: string; detail: string; href: string; isNew?: boolean; kind?: "project" | "handoff" | "screen" };

/**
 * ⌘K / Ctrl+K: type part of a project, handoff or screen name, arrows to move, Enter to open.
 * Pass `items`, or an `endpoint` that returns { items } and is fetched the first time it opens.
 */
export function QuickOpen({ items: givenItems, endpoint }: { items?: QuickOpenItem[]; endpoint?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [loaded, setLoaded] = useState<QuickOpenItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const items = useMemo(() => givenItems ?? loaded ?? [], [givenItems, loaded]);

  useEffect(() => {
    if (!open || givenItems || loaded || !endpoint) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- show the loading row while the index loads.
    setLoading(true);
    fetch(endpoint)
      .then((response) => (response.ok ? response.json() : { items: [] }))
      .then((payload: { items?: QuickOpenItem[] }) => { if (!cancelled) setLoaded(payload.items ?? []); })
      .catch(() => { if (!cancelled) setLoaded([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, givenItems, loaded, endpoint]);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("asbir:quick-open", onOpen);
    return () => window.removeEventListener("asbir:quick-open", onOpen);
  }, []);

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
    if (!words.length) return items.filter((item) => item.kind !== "screen").slice(0, 12);
    const rank = (item: QuickOpenItem) => {
      const label = item.label.toLowerCase();
      const kindOrder = item.kind === "project" ? 0 : item.kind === "handoff" ? 1 : 2;
      return (label.startsWith(words[0]) ? 0 : label.includes(words[0]) ? 3 : 6) + kindOrder;
    };
    return items
      .filter((item) => words.every((word) => `${item.label} ${item.detail}`.toLowerCase().includes(word)))
      .sort((a, b) => rank(a) - rank(b))
      .slice(0, 20);
  }, [items, query]);

  function go(item: QuickOpenItem | undefined) {
    if (!item) return;
    setOpen(false);
    router.push(item.href);
  }

  if (!open) return null;

  return (
    <div className="overlay-scrim fixed inset-0 z-[65] flex items-start justify-center px-4 pt-[14vh]" onMouseDown={() => setOpen(false)}>
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
            className="h-12 min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-foreground-subtle focus-visible:outline-none"
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
            placeholder={endpoint ? "Search projects, handoffs and screens…" : "Jump to a project or handoff…"}
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
                {item.kind ? (
                  <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-[7px] bg-white/[0.05] text-foreground-subtle">
                    <svg className="size-3.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" viewBox="0 0 16 16">
                      {item.kind === "project" ? <path d="M2.5 4.5h4l1.3 1.4h5.7v6.6h-11z" /> : item.kind === "handoff" ? <path d="M3 3.5h10v9H3zM5.5 6h5M5.5 8.5h3" /> : <path d="M5 2.5h6v11H5zM7 11.5h2" />}
                    </svg>
                  </span>
                ) : null}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-foreground">{item.label}</span>
                  <span className="block truncate text-[12px] text-foreground-subtle">{item.detail}</span>
                </span>
                {item.isNew ? <span className="shrink-0 text-[11px] font-medium text-[#ffa264]">New</span> : null}
              </li>
            ))
          ) : (
            <li className="px-3 py-6 text-center text-[13px] text-foreground-subtle">{loading ? <span className="loading-sheen-text">Loading…</span> : "No matches"}</li>
          )}
        </ul>
      </div>
    </div>
  );
}
