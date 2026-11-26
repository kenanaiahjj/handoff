"use client";

import Link from "next/link";
import { McpConnectGuide } from "@/src/components/integrations/McpConnectGuide";

/**
 * Connect an AI coding tool from inside a handoff. The tool signs in through the browser as the
 * person (OAuth), so there's no token to create or paste; tokens for scripts live on /integrations.
 */
export function McpConnectionPanel({ workspaceId: _workspaceId, canManageIntegrations: _canManage }: { workspaceId: string; canManageIntegrations: boolean }) {
  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-surface p-3 text-foreground-muted">
      <section className="rounded-panel bg-surface-raised p-3">
        <h2 className="text-[12px] font-semibold text-foreground">Connect an AI coding tool</h2>
        <p className="mt-1 text-[11px] leading-4 text-foreground-subtle">
          Claude Code, Codex or Cursor can then read this handoff: what changed between versions, before and after screenshots, measurements and comments.
        </p>
      </section>
      <McpConnectGuide compact />
      <Link className="inline-flex min-h-8 items-center rounded-control px-1 text-[11px] text-foreground-subtle hover:text-foreground" href="/integrations?open=mcp">
        Example prompts and tokens for scripts <span aria-hidden="true" className="ml-1">↗</span>
      </Link>
    </div>
  );
}
