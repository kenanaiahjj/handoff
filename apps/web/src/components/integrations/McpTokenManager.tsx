"use client";

import { useEffect, useState } from "react";
import { workspaceMcpEndpoint } from "./mcp-configuration";

type McpScope = "handoffs:read" | "comments:write" | "changelog:write" | "tasks:write";
type TokenRecord = {
  id: string;
  name: string;
  scopes: McpScope[];
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
  expired: boolean;
  createdBy: string;
  createdByName: string;
};

const scopeLabels: Record<McpScope, string> = {
  "handoffs:read": "Read projects, snapshots, measurements, diffs, comments, and findings",
  "comments:write": "Add comments to a frozen version",
  "changelog:write": "Draft, review, approve, and publish AI changelogs",
  "tasks:write": "Link tasks created through your AI client’s other MCP tools",
};

export function McpTokenManager({ workspaceId, canManageAll }: { workspaceId: string; canManageAll: boolean }) {
  const endpoint = `/api/workspaces/${encodeURIComponent(workspaceId)}/mcp-tokens`;
  const [tokens, setTokens] = useState<TokenRecord[]>([]);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<McpScope[]>(["handoffs:read"]);
  const [expiresInDays, setExpiresInDays] = useState(90);
  const [oneTimeToken, setOneTimeToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch(endpoint, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Could not load MCP tokens.");
        if (active) setTokens(payload.tokens ?? []);
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Could not load MCP tokens.");
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
      if (!response.ok) throw new Error(payload.error || "Could not create this MCP token.");
      setOneTimeToken(payload.token);
      setTokens((current) => [{ ...payload.metadata, createdBy: "", createdByName: "You" }, ...current]);
      setName("");
      setNotice("Copy this token now. Asbir Handoff will not show it again.");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create this MCP token.");
    } finally {
      setSaving(false);
    }
  }

  async function revokeToken(tokenId: string) {
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

  const endpointUrl = typeof window === "undefined"
    ? `/api/mcp?workspaceId=${encodeURIComponent(workspaceId)}`
    : workspaceMcpEndpoint(window.location.origin, workspaceId);

  return (
    <div className="space-y-5">
      <section className="rounded-panel bg-surface p-4 sm:p-5" aria-labelledby="mcp-endpoint-title">
        <h2 id="mcp-endpoint-title" className="text-sm font-semibold text-foreground">MCP endpoint</h2>
        <p className="mt-1 text-xs leading-5 text-foreground-muted">Connect an MCP-compatible agent to read this workspace’s frozen handoffs. Writes require a token scope.</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <label className="sr-only" htmlFor="mcp-endpoint-url">MCP endpoint URL</label>
          <input id="mcp-endpoint-url" readOnly value={endpointUrl} className="min-h-10 min-w-0 flex-1 rounded-control border border-border/70 bg-surface-inset px-3 font-mono text-xs text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" />
          <button type="button" onClick={() => void copy(endpointUrl, "Endpoint URL")} className="min-h-10 rounded-control bg-surface-raised px-3 text-xs font-medium text-foreground-muted hover:bg-border hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">Copy endpoint</button>
        </div>
      </section>

      <section className="rounded-panel bg-surface p-4 sm:p-5" aria-labelledby="create-token-title">
        <h2 id="create-token-title" className="text-sm font-semibold text-foreground">Create access token</h2>
        <p className="mt-1 text-xs leading-5 text-foreground-muted">Use a separate token for each of your agents. You can revoke your tokens at any time{canManageAll ? ", and workspace members can revoke any workspace token while flows are under review" : ""}.</p>
        <form className="mt-4 space-y-4" onSubmit={createToken}>
          <label className="block text-xs font-medium text-foreground-muted">
            Token name
            <input autoComplete="off" maxLength={80} required value={name} onChange={(event) => setName(event.target.value)} placeholder="For example, QA agent" className="mt-1.5 min-h-10 w-full rounded-control border border-border/70 bg-surface-inset px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" />
          </label>
          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-foreground-muted">Access scopes</legend>
            {(Object.keys(scopeLabels) as McpScope[]).map((scope) => (
              <label className="flex cursor-pointer items-start gap-2.5 rounded-control bg-surface-raised/70 px-3 py-2.5 text-xs leading-5 text-foreground-muted transition-colors hover:bg-surface-raised" key={scope}>
                <input type="checkbox" checked={scopes.includes(scope)} onChange={() => toggleScope(scope)} className="mt-0.5 size-4 accent-[var(--color-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" />
                <span><span className="font-mono text-foreground">{scope}</span><span className="mt-0.5 block">{scopeLabels[scope]}</span></span>
              </label>
            ))}
          </fieldset>
          <label className="block text-xs font-medium text-foreground-muted">
            Expires after
            <select value={expiresInDays} onChange={(event) => setExpiresInDays(Number(event.target.value))} className="mt-1.5 min-h-10 w-full rounded-control border border-border/70 bg-surface-inset px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
              <option value={180}>180 days</option>
              <option value={365}>365 days</option>
            </select>
          </label>
          <button disabled={saving || scopes.length === 0} className="min-h-10 rounded-control bg-primary px-4 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50" type="submit">{saving ? "Creating…" : "Create token"}</button>
        </form>
      </section>

      {oneTimeToken ? (
        <section className="rounded-panel bg-surface p-4 sm:p-5" aria-labelledby="new-token-title">
          <h2 id="new-token-title" className="text-sm font-semibold text-foreground">Copy your new token</h2>
          <p className="mt-1 text-xs leading-5 text-foreground-muted">This is the only time the token is shown. Store it in your MCP client’s secret settings.</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <label className="sr-only" htmlFor="new-mcp-token">New MCP token</label>
            <input id="new-mcp-token" readOnly value={oneTimeToken} className="min-h-10 min-w-0 flex-1 rounded-control border border-border/70 bg-surface-inset px-3 font-mono text-xs text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" />
            <button type="button" onClick={() => void copy(oneTimeToken, "Token")} className="min-h-10 rounded-control bg-surface-raised px-3 text-xs font-medium text-foreground hover:bg-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">Copy token</button>
            <button type="button" onClick={() => setOneTimeToken(null)} className="min-h-10 rounded-control bg-surface-raised px-3 text-xs font-medium text-foreground-muted hover:bg-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">Hide token</button>
          </div>
        </section>
      ) : null}

      <section className="rounded-panel bg-surface p-4 sm:p-5" aria-labelledby="active-tokens-title">
        <div className="flex items-center justify-between gap-3">
          <h2 id="active-tokens-title" className="text-sm font-semibold text-foreground">{canManageAll ? "Workspace tokens" : "Your tokens"}</h2>
          <span className="font-mono text-xs text-foreground-subtle">{tokens.length.toString().padStart(2, "0")}</span>
        </div>
        {loading ? <p className="mt-3 text-xs text-foreground-subtle" role="status">Loading tokens…</p> : null}
        {!loading && tokens.length === 0 ? <p className="mt-3 rounded-control bg-surface-raised px-3 py-3 text-xs leading-5 text-foreground-subtle">No MCP tokens have been created.</p> : null}
        <ul className="mt-3 space-y-2">
          {tokens.map((token) => {
            const inactive = Boolean(token.revokedAt) || token.expired;
            return (
              <li className="rounded-control bg-surface-raised/70 p-3" key={token.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">{token.name}</span>
                  <span className={`rounded-pill px-2 py-1 font-mono text-[10px] uppercase tracking-wide ${inactive ? "bg-surface text-foreground-subtle" : "bg-success/15 text-success"}`}>{token.revokedAt ? "Revoked" : inactive ? "Expired" : "Active"}</span>
                </div>
                <p className="mt-1 text-xs text-foreground-subtle">Expires {new Date(token.expiresAt).toLocaleDateString()}</p>
                {canManageAll ? <p className="mt-1 text-xs text-foreground-subtle">Created by {token.createdByName}</p> : null}
                <div className="mt-2 flex flex-wrap gap-1.5">{token.scopes.map((scope) => <span className="rounded-pill bg-surface-raised px-2 py-1 font-mono text-[10px] text-foreground-muted" key={scope}>{scope}</span>)}</div>
                {!inactive ? <button type="button" className="mt-3 min-h-8 rounded-control px-2.5 text-xs text-danger hover:bg-danger/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger" onClick={() => void revokeToken(token.id)}>Revoke token</button> : null}
              </li>
            );
          })}
        </ul>
      </section>

      {error ? <p className="rounded-control border border-warning/40 bg-warning/10 px-3 py-2.5 text-xs leading-5 text-warning" role="alert">{error}</p> : null}
      {notice ? <p className="text-xs text-success" role="status">{notice}</p> : null}
    </div>
  );
}
