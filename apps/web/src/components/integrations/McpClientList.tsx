"use client";

import { useEffect, useState } from "react";
import { useConfirm } from "@/src/components/ConfirmDialog";
import { formatLastActive } from "@/src/lib/last-active";

type ClientRecord = {
  userId: string;
  userName: string;
  clientId: string;
  clientName: string;
  firstUsedAt: string;
  lastUsedAt: string;
  revokedAt: string | null;
};

function isActive(client: ClientRecord) {
  return !client.revokedAt || Date.parse(client.lastUsedAt) > Date.parse(client.revokedAt);
}

/** "Used today" / "Used 3 days ago": the same wording members see for last activity. */
export function formatLastUsed(iso: string | null, now = Date.now()) {
  if (!iso) return "Never used";
  const label = formatLastActive(iso, now);
  return label === "Today" || label === "Yesterday" ? `Used ${label.toLowerCase()}` : `Last used ${label}`;
}

/** AI tools people signed in with. Disconnecting one stops it straight away and asks for Allow again next time. */
export function McpClientList({ workspaceId, canManageAll }: { workspaceId: string; canManageAll: boolean }) {
  const { confirm, dialog } = useConfirm();
  const endpoint = `/api/workspaces/${encodeURIComponent(workspaceId)}/mcp-clients`;
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch(endpoint, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Could not load connected clients.");
        if (active) { setClients(payload.clients ?? []); setViewerId(payload.viewerId ?? null); }
      })
      .catch((loadError: unknown) => { if (active) setError(loadError instanceof Error ? loadError.message : "Could not load connected clients."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [endpoint]);

  async function disconnect(client: ClientRecord) {
    const own = client.userId === viewerId;
    const confirmed = await confirm({
      title: `Disconnect ${client.clientName}?`,
      description: own
        ? "It stops working within seconds. To use it again, sign in from the tool and click Allow."
        : `${client.userName || "This person"}'s ${client.clientName} stops working within seconds. They can sign in again from the tool if they still need it.`,
      confirmLabel: "Disconnect",
    });
    if (!confirmed) return;
    setError(null);
    setNotice(null);
    const key = (item: ClientRecord) => item.userId === client.userId && item.clientId === client.clientId;
    const revokedAt = new Date().toISOString();
    const previous = clients;
    setClients((current) => current.map((item) => key(item) ? { ...item, revokedAt } : item));
    try {
      const response = await fetch(endpoint, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: client.userId, clientId: client.clientId }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not disconnect this client.");
      setNotice(`${client.clientName} disconnected.`);
    } catch (revokeError) {
      setClients(previous);
      setError(revokeError instanceof Error ? revokeError.message : "Could not disconnect this client.");
    }
  }

  return (
    <section aria-labelledby="mcp-clients-title">
      <h2 className="text-[14px] font-semibold text-foreground" id="mcp-clients-title">{canManageAll ? "Connected AI clients" : "Your connected AI clients"}</h2>
      <p className="mt-1 text-[12px] text-foreground-subtle">
        {canManageAll ? "AI tools people in this workspace signed in with. Disconnect one you don’t recognise, or one on a lost device." : "AI tools you signed in with. Disconnect one you no longer use, or one on a lost device."}
      </p>
      {loading ? <p className="mt-3 text-[12px] text-foreground-subtle" role="status">Loading connected clients…</p> : null}
      {!loading && !error && clients.length === 0 ? (
        <p className="mt-3 rounded-panel border border-dashed border-border px-4 py-6 text-center text-[12px] text-foreground-subtle">No AI clients yet. They show up here after their first request.</p>
      ) : null}
      {clients.length ? (
        <ul className="mt-3 divide-y divide-border rounded-panel border border-border">
          {clients.map((client) => {
            const active = isActive(client);
            const who = client.userId === viewerId ? "You" : client.userName;
            return (
              <li className={"flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3 " + (active ? "" : "opacity-60")} key={`${client.userId}:${client.clientId}`}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-foreground">{client.clientName}</span>
                  <span className="block truncate text-[11px] text-foreground-subtle">
                    {canManageAll ? `${who} · ` : ""}
                    {active ? formatLastUsed(client.lastUsedAt) : "Disconnected"}
                    {" · "}Connected {new Date(client.firstUsedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </span>
                </span>
                {active ? (
                  <button className="min-h-8 rounded-control px-2.5 text-[12px] text-danger hover:bg-danger/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger" onClick={() => void disconnect(client)} type="button">
                    Disconnect<span className="sr-only"> {client.clientName}{canManageAll && client.userId !== viewerId ? ` for ${who}` : ""}</span>
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {error ? <p className="mt-3 rounded-control border border-warning/40 bg-warning/10 px-3 py-2.5 text-[12px] leading-5 text-warning" role="alert">{error}</p> : null}
      {notice ? <p className="mt-3 text-[12px] text-success" role="status">{notice}</p> : null}
      {dialog}
    </section>
  );
}
