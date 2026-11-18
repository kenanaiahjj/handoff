"use client";

/** Opens the ⌘K palette; shows the shortcut so people learn it. */
export function SearchButton() {
  return (
    <button
      className="flex h-8 w-full items-center gap-2 rounded-[8px] bg-white/[0.03] px-2.5 text-left text-[13px] text-foreground-subtle transition-colors hover:bg-white/[0.06] hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      onClick={() => window.dispatchEvent(new Event("asbir:quick-open"))}
      type="button"
    >
      <svg aria-hidden="true" className="size-3.5 shrink-0" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" /></svg>
      <span className="flex-1">Search</span>
      <kbd className="font-mono text-[10px] text-foreground-subtle">⌘K</kbd>
    </button>
  );
}
