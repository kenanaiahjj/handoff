"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import {
  claudeCodeMcpConfiguration,
  codexMcpConfiguration,
  geminiCliMcpConfiguration,
  genericMcpConfiguration,
  workspaceMcpEndpoint,
} from "../integrations/mcp-configuration";

type ClientKind = "codex" | "claude" | "gemini" | "other";

const clientLabels: Record<ClientKind, string> = {
  codex: "Codex",
  claude: "Claude Code",
  gemini: "Gemini CLI",
  other: "Other client",
};

export function McpConnectionPanel({
  workspaceId,
  canManageIntegrations,
}: {
  workspaceId: string;
  canManageIntegrations: boolean;
}) {
  const endpoint = useSyncExternalStore(
    () => () => {},
    () => workspaceMcpEndpoint(window.location.origin, workspaceId),
    () => "/api/mcp?workspaceId=" + encodeURIComponent(workspaceId),
  );
  const [client, setClient] = useState<ClientKind>("codex");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const configuration = {
    codex: codexMcpConfiguration(endpoint),
    claude: claudeCodeMcpConfiguration(endpoint),
    gemini: geminiCliMcpConfiguration(endpoint),
    other: genericMcpConfiguration(endpoint),
  }[client];
  const tokenVariable = client === "claude" || client === "gemini"
    ? "ASBIR_HANDOFF_ACCESS"
    : "ASBIR_MCP_TOKEN";
  const clientSetup = {
    codex: "Add this TOML block to ~/.codex/config.toml.",
    claude: "Claude Code: add this JSON to the project’s .mcp.json file. Set ASBIR_HANDOFF_ACCESS before launching Claude Code.",
    gemini: "Gemini CLI: merge this object into ~/.gemini/settings.json. Set ASBIR_HANDOFF_ACCESS before launching Gemini CLI.",
    other: "Use this Streamable HTTP JSON shape. Follow your client’s documented environment-variable syntax for the token.",
  }[client];

  async function copy(value: string, label: string) {
    setError(null);
    setNotice(null);
    try {
      await navigator.clipboard.writeText(value);
      setNotice(label + " copied.");
    } catch {
      setError("Could not copy. Select the value and copy it manually.");
    }
  }

  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-[#202020] p-3 text-[#d0d0d0]">
      <section className="rounded-[7px] border border-[#3b3b3b] bg-[#252525] p-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-[12px] font-semibold text-[#ededed]">Connect an agent</h2>
            <p className="mt-1 text-[10px] leading-4 text-[#999]">
              Connect Codex, Claude Code, Gemini CLI, or another MCP client to this workspace’s frozen designs, layers, measurements, and diffs.
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-[#303030] px-2 py-1 font-mono text-[9px] text-[#b8b8b8]">MCP</span>
        </div>
        <Link
          className="mt-3 inline-flex min-h-8 items-center rounded-[5px] border border-[#484848] px-2.5 text-[10px] font-medium text-[#ddd] hover:bg-[#333] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#aaa]"
          href={"/workspace/" + encodeURIComponent(workspaceId) + "/integrations"}
        >
          {canManageIntegrations ? "Create or manage a token" : "Open workspace integrations"}
          <span aria-hidden="true" className="ml-1.5">↗</span>
        </Link>
        {!canManageIntegrations ? (
          <p className="mt-2 text-[10px] leading-4 text-[#929292]">Ask a Workspace Owner to create a scoped token if you do not have one.</p>
        ) : null}
      </section>

      <section aria-labelledby="mcp-steps-title" className="rounded-[7px] border border-[#3b3b3b] bg-[#252525] p-3">
        <h3 className="text-[11px] font-semibold text-[#dedede]" id="mcp-steps-title">Setup</h3>
        <ol className="mt-2 space-y-2 text-[10px] leading-4 text-[#a9a9a9]">
          <li className="flex gap-2"><span className="font-mono text-[#d7b86e]">1</span><span>Create a token with <code className="font-mono text-[#d7d7d7]">handoffs:read</code>. Add <code className="font-mono text-[#d7d7d7]">comments:write</code> if your agent should comment.</span></li>
          <li className="flex gap-2"><span className="font-mono text-[#d7b86e]">2</span><span>Copy the matching config below into your MCP client.</span></li>
          <li className="flex gap-2"><span className="font-mono text-[#d7d7d7]">3</span><span>Set <code className="font-mono text-[#d7d7d7]">{tokenVariable}</code> in that client’s environment, then restart the client.</span></li>
        </ol>
        {client === "claude" || client === "gemini" ? (
          <p className="mt-2 text-[10px] leading-4 text-[#929292]">
            These clients filter remote-header variables with names such as <code className="font-mono text-[#d7d7d7]">*_TOKEN</code> or <code className="font-mono text-[#d7d7d7]">*_SECRET</code>. The config uses <code className="font-mono text-[#d7d7d7]">ASBIR_HANDOFF_ACCESS</code> as a local alias for your token.
          </p>
        ) : null}
      </section>

      <section aria-labelledby="mcp-config-title" className="rounded-[7px] border border-[#3b3b3b] bg-[#252525] p-3">
        <h3 className="text-[11px] font-semibold text-[#dedede]" id="mcp-config-title">Connection example</h3>
        <div aria-label="MCP client configuration" className="mt-2 grid grid-cols-4 rounded-[5px] bg-[#1d1d1d] p-0.5" role="group">
          {(["codex", "claude", "gemini", "other"] as const).map((kind) => (
            <button
              aria-label={clientLabels[kind]}
              aria-pressed={client === kind}
              className={"min-w-0 truncate rounded-[4px] px-1 py-1.5 text-[9px] " + (client === kind ? "bg-[#414141] text-white" : "text-[#999] hover:text-white")}
              key={kind}
              onClick={() => setClient(kind)}
              title={clientLabels[kind]}
              type="button"
            >
              {kind === "claude" ? "Claude Code" : kind === "gemini" ? "Gemini CLI" : kind === "other" ? "Other" : "Codex"}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[10px] leading-4 text-[#929292]">{clientSetup}</p>
        {client === "claude" ? (
          <a className="mt-1 inline-flex text-[10px] text-[#c6b37f] underline underline-offset-2 hover:text-[#ead69c]" href="https://code.claude.com/docs/en/mcp" rel="noreferrer" target="_blank">
            Claude Code MCP setup guide
          </a>
        ) : null}
        {client === "gemini" ? (
          <a className="mt-1 inline-flex text-[10px] text-[#c6b37f] underline underline-offset-2 hover:text-[#ead69c]" href="https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md" rel="noreferrer" target="_blank">
            Gemini CLI MCP setup guide
          </a>
        ) : null}
        <pre className="mt-2 max-h-48 overflow-auto rounded-[5px] border border-[#383838] bg-[#1b1b1b] p-2.5 font-mono text-[9px] leading-[1.55] text-[#d2d2d2]">
          <code>{configuration}</code>
        </pre>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button
            className="min-h-8 rounded-[5px] bg-[#d7b86e] px-2.5 text-[10px] font-semibold text-[#2b2415] hover:bg-[#e8cc89] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f1d99c]"
            onClick={() => void copy(configuration, clientLabels[client] + " config")}
            type="button"
          >
            Copy {clientLabels[client]} config
          </button>
          <button
            className="min-h-8 rounded-[5px] border border-[#484848] px-2.5 text-[10px] text-[#c8c8c8] hover:bg-[#333] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#aaa]"
            onClick={() => void copy(endpoint, "Endpoint URL")}
            type="button"
          >
            Copy endpoint
          </button>
        </div>
        <p className="mt-2 text-[10px] leading-4 text-[#929292]">The config uses a token variable. Never paste a live token into a shared config or commit it to your repository.</p>
      </section>

      {error ? <p className="rounded-[5px] border border-[#70413d] bg-[#382624] px-2.5 py-2 text-[10px] leading-4 text-[#f0a29c]" role="alert">{error}</p> : null}
      {notice ? <p className="text-[10px] text-[#9fcf9a]" role="status">{notice}</p> : null}
    </div>
  );
}
