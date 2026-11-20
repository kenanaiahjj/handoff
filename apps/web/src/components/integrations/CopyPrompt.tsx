"use client";

import { useState } from "react";
import { showToast } from "@/src/components/shell/Toaster";

/** A ready-made prompt people paste into their AI assistant to set an integration up for them. */
export function CopyPrompt({ prompt, title = "Set up with AI" }: { prompt: string; title?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      showToast("Prompt copied");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section aria-label={title} className="overflow-hidden rounded-panel border border-border bg-surface">
      <header className="flex items-center justify-between gap-3 border-b border-border py-2 pl-4 pr-2">
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold text-foreground">{title}</h2>
          <p className="text-[12px] text-foreground-subtle">Paste into Claude, Codex or another assistant.</p>
        </div>
        <button
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-control bg-primary px-3 text-[12px] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          onClick={() => void copy()}
          type="button"
        >
          {copied ? (
            <svg aria-hidden="true" className="size-3.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 16 16"><path d="m3.5 8.5 3 3 6-7" /></svg>
          ) : (
            <svg aria-hidden="true" className="size-3.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" viewBox="0 0 16 16"><rect height="9" rx="1.5" width="9" x="5" y="5" /><path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" /></svg>
          )}
          {copied ? "Copied" : "Copy prompt"}
        </button>
      </header>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words px-4 py-3 font-mono text-[12px] leading-5 text-foreground-muted">{prompt}</pre>
    </section>
  );
}
