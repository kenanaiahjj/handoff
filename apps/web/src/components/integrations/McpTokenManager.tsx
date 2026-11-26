"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  claudeCodeMcpConfiguration,
  codexMcpConfiguration,
  geminiCliMcpConfiguration,
  genericMcpConfiguration,
  workspaceMcpEndpoint,
} from "./mcp-configuration";
import { useConfirm } from "@/src/components/ConfirmDialog";
import { formatLastUsed } from "./McpClientList";

type McpScope = "handoffs:read" | "comments:write" | "changelog:write" | "tasks:write" | "implementation:write";
type TokenRecord = {
  id: string;
  name: string;
  scopes: McpScope[];
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expired: boolean;
  createdBy: string;
  createdByName: string;
};

const scopeLabels: Record<McpScope, string> = {
  "handoffs:read": "Read projects, snapshots, measurements, diffs, comments and findings",
  "comments:write": "Add comments to a frozen version",
  "changelog:write": "Draft, review, approve and publish AI changelogs",
  "tasks:write": "Link tasks created through your AI client’s other MCP tools",
  "implementation:write": "Record which code builds a design component and report build progress",
};

type ClientKind = "codex" | "claude" | "gemini" | "other";
const clients: Array<{ kind: ClientKind; label: string; where: string; variable: string }> = [
  { kind: "codex", label: "Codex", where: "Add to ~/.codex/config.toml", variable: "ASBIR_MCP_TOKEN" },
  { kind: "claude", label: "Claude Code", where: "Add to the project’s .mcp.json", variable: "ASBIR_HANDOFF_ACCESS" },
  { kind: "gemini", label: "Gemini CLI", where: "Merge into ~/.gemini/settings.json", variable: "ASBIR_HANDOFF_ACCESS" },
  { kind: "other", label: "Other", where: "Streamable HTTP; use your client’s variable syntax", variable: "ASBIR_MCP_TOKEN" },
];

const field = "min-h-9 w-full rounded-control border border-transparent bg-surface-inset px-3 text-[13px] text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const quietButton = "min-h-8 shrink-0 rounded-control bg-surface-raised px-3 text-[12px] font-medium text-foreground-muted transition-colors hover:bg-border hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

export function McpTokenManager({ workspaceId, canManageAll }: { workspaceId: string; canManageAll: boolean }) {
  const { confirm, dialog } = useConfirm();
  const endpoint = `/api/workspaces/${encodeURIComponent(workspaceId)}/mcp-tokens`;
  const [tokens, setTokens] = useState<TokenRecord[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<McpScope[]>(["handoffs:read"]);
  const [expiresInDays, setExpiresInDays] = useState(90);
  const [oneTimeToken, setOneTimeToken] = useState<string | null>(null);
  const [client, setClient] = useState<ClientKind>("codex");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const endpointUrl = useSyncExternalStore(
    () => () => {},
    () => workspaceMcpEndpoint(window.location.origin, workspaceId),
    () => `/api/mcp?workspaceId=${encodeURIComponent(workspaceId)}`,
  );
  const activeClient = clients.find((item) => item.kind === client)!;
  const configuration = {
    codex: codexMcpConfiguration,
    claude: claudeCodeMcpConfiguration,
    gemini: geminiCliMcpConfiguration,
    other: genericMcpConfiguration,
  }[client](endpointUrl);

  useEffect(() => {
    let active = true;
    fetch(endpoint, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Could not load tokens.");
        if (active) setTokens(payload.tokens ?? []);
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Could not load tokens.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [endpoint]);

  async function createToken(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, scopes, expiresInDays }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not create this token.");
      setOneTimeToken(payload.token);
      setTokens((current) => [{ ...payload.metadata, createdBy: "", createdByName: "You" }, ...current]);
      setName("");
      setCreating(false);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create this token.");
    } finally {
      setSaving(false);
    }
  }

  async function revokeToken(tokenId: string) {
    const confirmed = await confirm({
      title: "Revoke this token?",
      description: "Any MCP client using it loses access immediately. This can’t be undone.",
      confirmLabel: "Revoke token",
    });
    if (!confirmed) return;
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(endpoint, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: tokenId }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not revoke this token.");
      setTokens((current) => current.map((token) => token.id === tokenId ? { ...token, revokedAt: new Date().toISOString() } : token));
      setNotice("Token revoked.");
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : "Could not revoke this token.");
    }
  }

  async function copy(value: string, label: string) {
    setError(null);
    try {
      await navigator.clipboard.writeText(value);
      setNotice(`${label} copied.`);
    } catch {
      setError(`Could not copy the ${label.toLowerCase()}. Select it and copy it manually.`);
    }
  }

  function toggleScope(scope: McpScope) {
    setScopes((current) => current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope]);
  }

  return (
    <div className="space-y-8">
      <section aria-labelledby="mcp-connect-title">
        <h2 className="text-[14px] font-semibold text-foreground" id="mcp-connect-title">Connect a client</h2>
        <div className="mt-3 overflow-hidden rounded-panel border border-border">
          <div aria-label="MCP client" className="flex gap-1 border-b border-border bg-surface px-2 pt-2" role="tablist">
            {clients.map((item) => (
              <button
                aria-selected={client === item.kind}
                className={"-mb-px rounded-t-[7px] border-b-2 px-3 py-2 text-[12px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary " + (client === item.kind ? "border-foreground text-foreground" : "border-transparent text-foreground-subtle hover:text-foreground")}
                key={item.kind}
                onClick={() => setClient(item.kind)}
                role="tab"
                type="button"
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="bg-surface-inset/60 p-4" role="tabpanel">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[12px] text-foreground-muted">{activeClient.where}. Then set <code className="font-mono text-foreground">{activeClient.variable}</code> to your token and restart the client.</p>
              <button className={quietButton} onClick={() => void copy(configuration, `${activeClient.label} config`)} type="button">Copy config</button>
            </div>
            <pre className="mt-3 overflow-x-auto rounded-control bg-background/60 p-3 font-mono text-[11px] leading-[1.6] text-foreground"><code>{configuration}</code></pre>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-foreground-subtle">
              <span>Endpoint</span>
              <code className="min-w-0 truncate font-mono text-[11px] text-foreground-muted">{endpointUrl}</code>
              <button className="text-foreground-muted underline-offset-2 hover:text-foreground hover:underline" onClick={() => void copy(endpointUrl, "Endpoint")} type="button">Copy</button>
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="mcp-tokens-title">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[14px] font-semibold text-foreground" id="mcp-tokens-title">{canManageAll ? "Workspace tokens" : "Your tokens"}</h2>
          {!creating ? (
            <button className="min-h-8 rounded-control bg-primary px-3 text-[12px] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" onClick={() => { setCreating(true); setOneTimeToken(null); }} type="button">New token</button>
          ) : null}
        </div>
        <p className="mt-1 text-[12px] text-foreground-subtle">One token per client. A token stops working when it’s revoked or expires, or when its owner leaves the workspace.</p>

        {oneTimeToken ? (
          <div className="mt-3 rounded-panel border border-success/30 bg-success/5 p-4">
            <p className="text-[13px] font-medium text-foreground">Copy your new token now. It won’t be shown again.</p>
            <div className="mt-2.5 flex flex-col gap-2 sm:flex-row">
              <label className="sr-only" htmlFor="new-mcp-token">New MCP token</label>
              <input className={field + " font-mono text-[12px]"} id="new-mcp-token" readOnly value={oneTimeToken} />
              <button className={quietButton + " min-h-9"} onClick={() => void copy(oneTimeToken, "Token")} type="button">Copy token</button>
              <button className={quietButton + " min-h-9"} onClick={() => setOneTimeToken(null)} type="button">Done</button>
            </div>
          </div>
        ) : null}

        {creating ? (
          <form className="mt-3 space-y-4 rounded-panel border border-border bg-surface p-4" onSubmit={createToken}>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px]">
              <label className="block text-[12px] font-medium text-foreground-muted">
                Name
                <input autoComplete="off" autoFocus className={field + " mt-1.5"} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="For example, Codex on my laptop" required value={name} />
              </label>
              <label className="block text-[12px] font-medium text-foreground-muted">
                Expires after
                <select className={field + " mt-1.5"} onChange={(event) => setExpiresInDays(Number(event.target.value))} value={expiresInDays}>
                  <option value={30}>30 days</option>
                  <option value={90}>90 days</option>
                  <option value={180}>180 days</option>
                  <option value={365}>365 days</option>
                </select>
              </label>
            </div>
            <fieldset>
              <legend className="text-[12px] font-medium text-foreground-muted">Access</legend>
              <div className="mt-1.5 divide-y divide-border rounded-control border border-border">
                {(Object.keys(scopeLabels) as McpScope[]).map((scope) => (
                  <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5 hover:bg-surface-raised/50" key={scope}>
                    <input checked={scopes.includes(scope)} className="mt-0.5 size-4 accent-[var(--color-accent)]" onChange={() => toggleScope(scope)} type="checkbox" />
                    <span className="min-w-0">
                      <span className="block text-[12px] text-foreground">{scopeLabels[scope]}</span>
                      <span className="block font-mono text-[11px] text-foreground-subtle">{scope}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="flex gap-2">
              <button className="min-h-9 rounded-control bg-primary px-4 text-[12px] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50" disabled={saving || scopes.length === 0} type="submit">{saving ? "Creating…" : "Create token"}</button>
              <button className={quietButton + " min-h-9"} onClick={() => setCreating(false)} type="button">Cancel</button>
            </div>
          </form>
        ) : null}

        {loading ? <p className="mt-3 text-[12px] text-foreground-subtle" role="status">Loading tokens…</p> : null}
        {!loading && tokens.length === 0 && !creating ? <p className="mt-3 rounded-panel border border-dashed border-border px-4 py-6 text-center text-[12px] text-foreground-subtle">No tokens yet.</p> : null}
        {tokens.length ? (
          <ul className="mt-3 divide-y divide-border rounded-panel border border-border">
            {tokens.map((token) => {
              const inactive = Boolean(token.revokedAt) || token.expired;
              return (
                <li className={"flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3 " + (inactive ? "opacity-60" : "")} key={token.id}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-foreground">{token.name}</span>
                    <span className="block truncate text-[11px] text-foreground-subtle">
                      {token.revokedAt ? "Revoked" : token.expired ? "Expired" : `${formatLastUsed(token.lastUsedAt)} · Expires ${new Date(token.expiresAt).toLocaleDateString()}`}
                      {canManageAll ? ` · ${token.createdByName}` : ""}
                      {" · "}{token.scopes.join(", ")}
                    </span>
                  </span>
                  {!inactive ? <button className="min-h-8 rounded-control px-2.5 text-[12px] text-danger hover:bg-danger/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger" onClick={() => void revokeToken(token.id)} type="button">Revoke</button> : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>

      {error ? <p className="rounded-control border border-warning/40 bg-warning/10 px-3 py-2.5 text-[12px] leading-5 text-warning" role="alert">{error}</p> : null}
      {notice ? <p className="text-[12px] text-success" role="status">{notice}</p> : null}
      {dialog}
    </div>
  );
}
