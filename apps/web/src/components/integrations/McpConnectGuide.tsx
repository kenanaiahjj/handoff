"use client";

import { useState, useSyncExternalStore } from "react";
import { showToast } from "@/src/components/shell/Toaster";
import { mcpServerUrl } from "./mcp-configuration";

type Client = "claude" | "codex" | "cursor" | "other";

const clientLabels: Record<Client, string> = { claude: "Claude Code", codex: "Codex", cursor: "Cursor", other: "Other" };


function setupFor(client: Client, url: string): { steps: string[]; code: string; codeLabel: string } {
  switch (client) {
    case "claude":
      return {
        codeLabel: "Run in your terminal",
        code: `claude mcp add --transport http --scope user asbir-handoff ${url}`,
        steps: ["Run the command once.", "In Claude Code, type /mcp, pick asbir-handoff and choose Authenticate.", "Sign in in the browser and click Allow."],
      };
    case "codex":
      return {
        codeLabel: "Run in your terminal",
        code: `codex mcp add asbir-handoff --url ${url}\ncodex mcp login asbir-handoff`,
        steps: ["Run both commands.", "Sign in in the browser that opens and click Allow.", "Start Codex; the Asbir Handoff tools are ready."],
      };
    case "cursor":
      return {
        codeLabel: "Add to ~/.cursor/mcp.json",
        code: JSON.stringify({ mcpServers: { "asbir-handoff": { url } } }, null, 2),
        steps: ["Add the server to Cursor's MCP settings.", "Click Connect (or Needs login) next to asbir-handoff.", "Sign in in the browser and click Allow."],
      };
    default:
      return {
        codeLabel: "Server URL (streamable HTTP, OAuth sign-in)",
        code: url,
        steps: ["Add a remote MCP server with this URL.", "When the client asks you to sign in, use your Asbir Handoff account.", "Click Allow."],
      };
  }
}

/** Things worth asking once connected, so people see what the tools are for. */
const examples = [
  "What changed in the latest version of the Checkout handoff? List each changed screen.",
  "Show me the before and after screenshots of the screens that changed.",
  "Give me the exact spacing, sizes, colours and fonts for the Sign up screen.",
  "Compare my running app with the latest design and list what doesn't match.",
  "Summarise the open comments on this handoff and who they're for.",
];

async function copyText(value: string, label: string) {
  try {
    await navigator.clipboard.writeText(value);
    showToast(`${label} copied`);
  } catch {
    showToast("Couldn't copy. Select the text and copy it.");
  }
}

export function McpConnectGuide({ compact = false }: { compact?: boolean }) {
  const [client, setClient] = useState<Client>("claude");
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => "",
  );
  const url = origin ? mcpServerUrl(origin) : "/api/mcp";
  const setup = setupFor(client, url);
  const text = compact ? "text-[11px]" : "text-[13px]";

  return (
    <div className={compact ? "space-y-3" : "space-y-6"}>
      <section aria-label="Connect an AI tool" className="overflow-hidden rounded-panel border border-border bg-surface">
        <div aria-label="AI tool" className="flex gap-1 border-b border-border px-2 pt-2" role="tablist">
          {(Object.keys(clientLabels) as Client[]).map((kind) => (
            <button
              aria-selected={client === kind}
              className={"rounded-t-[7px] px-3 py-2 text-[12px] font-medium transition-colors " + (client === kind ? "bg-surface-raised text-foreground" : "text-foreground-subtle hover:text-foreground")}
              key={kind}
              onClick={() => setClient(kind)}
              role="tab"
              type="button"
            >
              {clientLabels[kind]}
            </button>
          ))}
        </div>
        <div className="space-y-3 p-4" role="tabpanel">
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-[11px] text-foreground-subtle">{setup.codeLabel}</span>
              <button className="h-7 rounded-control bg-surface-raised px-2.5 text-[11px] font-medium text-foreground-muted hover:bg-border hover:text-foreground" onClick={() => void copyText(setup.code, "Setup")} type="button">Copy</button>
            </div>
            <pre className="overflow-x-auto whitespace-pre rounded-control bg-surface-inset px-3 py-2.5 font-mono text-[12px] leading-5 text-foreground">{setup.code}</pre>
          </div>
          <ol className={"space-y-1.5 " + text + " leading-5 text-foreground-muted"}>
            {setup.steps.map((step, index) => (
              <li className="flex gap-2.5" key={step}>
                <span className="w-3 shrink-0 tabular-nums text-foreground-subtle">{index + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <p className="text-[11px] leading-4 text-foreground-subtle">No token to copy: you sign in once, and your AI tool sees exactly the handoffs you can see.</p>
        </div>
      </section>

      {!compact ? (
        <section aria-labelledby="mcp-examples-title">
          <h2 className="text-[14px] font-semibold text-foreground" id="mcp-examples-title">Then try asking</h2>
          <ul className="mt-3 divide-y divide-border rounded-panel border border-border">
            {examples.map((example) => (
              <li className="flex items-center gap-3 px-4 py-3" key={example}>
                <span className="min-w-0 flex-1 text-[13px] text-foreground">{example}</span>
                <button aria-label={`Copy: ${example}`} className="h-7 shrink-0 rounded-control px-2.5 text-[11px] text-foreground-subtle hover:bg-surface-raised hover:text-foreground" onClick={() => void copyText(example, "Prompt")} type="button">Copy</button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
