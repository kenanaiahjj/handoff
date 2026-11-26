import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { HandoffTabs } from "./HandoffTabs";

/**
 * A page for reviewers, developers and QA in the same app-like frame as their home (ViewerHome):
 * the handoff tabs, the workspace name, and a back link, instead of the managers' dashboard shell.
 */
export function ViewerPageShell({ title, homeHref = "/workspace", children }: { title: string; homeHref?: string; children: ReactNode }) {
  return (
    <div className="viewer-home min-h-dvh bg-background text-foreground">
      <header className="viewer-home-bar sticky top-0 z-20 border-b border-border">
        <HandoffTabs current={null} homeHref={homeHref} />
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4 sm:px-6">
          <Link aria-label="Asbir Handoff home" className="flex min-w-0 items-center gap-2.5 rounded-[8px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/40" href={homeHref}>
            <Image alt="" className="size-7 rounded-[8px]" height={28} src="/icons/asbir-handoff-v2-180.png" width={28} />
            <span className="truncate text-[14px] font-semibold tracking-[-0.01em]">{title}</span>
          </Link>
          <Link className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-[8px] px-2.5 text-[12px] text-foreground-muted hover:bg-white/[0.06] hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/40" href={homeHref}>
            <svg aria-hidden="true" className="size-3.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" viewBox="0 0 16 16"><path d="M10 3.5 5.5 8l4.5 4.5" /></svg>
            Your handoffs
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 pb-24 pt-8 sm:px-6 sm:pt-12">{children}</main>
    </div>
  );
}
