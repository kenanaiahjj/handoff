"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type SharingMode = "workspace" | "invited" | "anyone";
type HandoffInvite = { id: string; email: string; expiresAt: string | null; createdAt: string };
type WorkspaceMember = { id: string; name: string; email: string; role: "owner" | "designer" | "reviewer" | "developer" | "qa" };
type SharingPayload = { mode: SharingMode; reviewUrl: string | null; invites: HandoffInvite[]; workspaceMembers: WorkspaceMember[]; error?: string };
type InviteResponse = { invite?: { inviteUrl: string; id: string; email: string; expiresAt: string | null }; error?: string };

export function HandoffSharingControls({ endpoint, refreshKey = 0 }: { endpoint: string; refreshKey?: number }) {
  const [mode, setMode] = useState<SharingMode>("workspace");
  const [reviewUrl, setReviewUrl] = useState("");
  const [invites, setInvites] = useState<HandoffInvite[]>([]);
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMember[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteExpiry, setInviteExpiry] = useState("7");
  const [createdInviteUrl, setCreatedInviteUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const refreshSharing = useCallback(async () => {
    const response = await fetch(`${endpoint}/sharing`, { cache: "no-store" });
    const payload = await response.json() as SharingPayload;
    if (!response.ok) throw new Error(payload.error ?? "Could not load sharing settings.");
    setMode(payload.mode);
    setReviewUrl(payload.reviewUrl ?? "");
    setInvites(payload.invites ?? []);
    setWorkspaceMembers(payload.workspaceMembers ?? []);
  }, [endpoint]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    fetch(`${endpoint}/sharing`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as SharingPayload;
        if (!response.ok) throw new Error(payload.error ?? "Could not load sharing settings.");
        if (!active) return;
        setMode(payload.mode);
        setReviewUrl(payload.reviewUrl ?? "");
        setInvites(payload.invites ?? []);
        setWorkspaceMembers(payload.workspaceMembers ?? []);
        setError("");
      })
      .catch((cause: unknown) => {
        if (active && !(cause instanceof DOMException && cause.name === "AbortError")) {
          setError(cause instanceof Error ? cause.message : "Could not load sharing settings.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [endpoint, refreshKey]);

  async function updateMode(nextMode: SharingMode) {
    setPending(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`${endpoint}/sharing`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: nextMode }),
      });
      const payload = await response.json() as { mode?: SharingMode; error?: string };
      if (!response.ok || !payload.mode) throw new Error(payload.error ?? "Could not update sharing settings.");
      setMode(payload.mode);
      setMessage(mode === "anyone" && payload.mode !== "anyone"
        ? "Public access revoked. The canvas link now requires another access method."
        : "Sharing settings updated.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update sharing settings.");
    } finally {
      setPending(false);
    }
  }

  async function copyCanvasLink() {
    if (!reviewUrl) return;
    try {
      await navigator.clipboard.writeText(reviewUrl);
      setMessage("Canvas link copied.");
    } catch {
      setError("Clipboard access is unavailable. Select and copy the canvas link.");
    }
  }

  async function createInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    setMessage("");
    setCreatedInviteUrl("");
    try {
      const response = await fetch(`${endpoint}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, expiresInDays: inviteExpiry === "never" ? null : Number(inviteExpiry) }),
      });
      const payload = await response.json() as InviteResponse;
      if (!response.ok || !payload.invite) throw new Error(payload.error ?? "Could not create this invitation.");
      setCreatedInviteUrl(payload.invite.inviteUrl);
      setInviteEmail("");
      setMessage(`Invitation link created for ${payload.invite.email}. Copy it and send it to them.`);
      await refreshSharing();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create this invitation.");
    } finally {
      setPending(false);
    }
  }

  async function copyInviteLink() {
    if (!createdInviteUrl) return;
    try {
      await navigator.clipboard.writeText(createdInviteUrl);
      setMessage("Invitation link copied.");
    } catch {
      setError("Clipboard access is unavailable. Select and copy the invitation link.");
    }
  }

  async function revokeInvite(inviteId: string) {
    setPending(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`${endpoint}/invites/${encodeURIComponent(inviteId)}`, { method: "DELETE" });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not revoke this invitation.");
      setInvites((current) => current.filter((invite) => invite.id !== inviteId));
      setMessage("Invitation revoked.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not revoke this invitation.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-3 space-y-3 border-t border-[#393939] pt-3">
      <label className="grid gap-1.5 text-[10px] text-[#999]" htmlFor="handoff-sharing-mode">
        Who can open this canvas?
        <select className="h-9 w-full rounded-[5px] border border-[#414141] bg-[#191919] px-2.5 text-[11px] text-[#ddd] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#aaa]" disabled={pending || loading} id="handoff-sharing-mode" onChange={(event) => void updateMode(event.target.value as SharingMode)} value={mode}>
          <option value="workspace">Workspace members — sign in required</option>
          <option value="invited">Only invited people — matching email sign-in</option>
          <option value="anyone">Anyone with the link — no sign-in</option>
        </select>
      </label>

      {loading ? <p className="text-[11px] text-[#888]" role="status">Loading access…</p> : null}
      {!loading && !reviewUrl ? <p className="rounded-[5px] bg-[#191919] px-3 py-2.5 text-[11px] leading-5 text-[#999]">This handoff has no published canvas link yet. Open the canvas to publish a version.</p> : null}
      {mode === "invited" ? <p className="text-[11px] leading-5 text-[#999]">Invite people by email, including people outside your workspace. The app creates a link for you to copy and send.</p> : null}
      {mode === "anyone" && reviewUrl ? <button className="min-h-8 rounded-[5px] px-2 text-[11px] font-medium text-[#e69a90] hover:bg-[#432e2c] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#e69a90] disabled:opacity-50" disabled={pending || loading} onClick={() => void updateMode("workspace")} type="button">Revoke public link</button> : null}

      <section aria-labelledby="handoff-access-list-heading">
        <h4 className="text-[10px] font-semibold uppercase tracking-wide text-[#999]" id="handoff-access-list-heading">Who can open the published canvas?</h4>
        {!reviewUrl ? <p className="mt-1 text-[11px] leading-5 text-[#888]">Review link access starts after you publish a version.</p> : null}
        {reviewUrl && mode === "workspace" ? <p className="mt-1 text-[11px] leading-5 text-[#999]">All listed workspace members can open this canvas.</p> : null}
        {reviewUrl && mode === "invited" ? <p className="mt-1 text-[11px] leading-5 text-[#999]">Workspace owners and designers, plus the active invited emails below, can open this canvas.</p> : null}
        {reviewUrl && mode === "anyone" ? <p className="mt-1 text-[11px] leading-5 text-[#999]">Anyone with this link can view the canvas. Link viewers are not identifiable here. Workspace owners and designers can manage it.</p> : null}

        {mode === "workspace" ? (
          workspaceMembers.length ? (
            <ul className="mt-2 max-h-44 divide-y divide-[#383838] overflow-y-auto rounded-[5px] border border-[#383838] px-2.5">
              {workspaceMembers.map((member) => (
                <li className="flex min-h-10 items-center justify-between gap-2 py-2" key={member.id}>
                  <span className="min-w-0">
                    <span className="block truncate text-[11px] text-[#d0d0d0]">{member.name}</span>
                    <span className="mt-0.5 block truncate text-[9px] text-[#888]">{member.email}</span>
                  </span>
                  <span className="shrink-0 text-[9px] capitalize text-[#888]">{member.role}</span>
                </li>
              ))}
            </ul>
          ) : <p className="mt-1 text-[11px] text-[#888]">No workspace members were found.</p>
        ) : null}

        {mode !== "workspace" ? (
          <>
            <p className="mt-2 text-[9px] font-medium uppercase tracking-wide text-[#888]">Workspace owners and designers</p>
            {workspaceMembers.some((member) => member.role === "owner" || member.role === "designer") ? (
              <ul className="mt-1 divide-y divide-[#383838] rounded-[5px] border border-[#383838] px-2.5">
                {workspaceMembers.filter((member) => member.role === "owner" || member.role === "designer").map((member) => (
                  <li className="flex min-h-10 items-center justify-between gap-2 py-2" key={member.id}>
                    <span className="min-w-0">
                      <span className="block truncate text-[11px] text-[#d0d0d0]">{member.name}</span>
                      <span className="mt-0.5 block truncate text-[9px] text-[#888]">{member.email}</span>
                    </span>
                    <span className="shrink-0 text-[9px] capitalize text-[#888]">{member.role}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-1 text-[11px] text-[#888]">No workspace owners or designers were found.</p>}
          </>
        ) : null}
      </section>

      {reviewUrl ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[5px] border border-[#383838] bg-[#191919] px-2.5 py-2">
          <span className="min-w-0 flex-1">
            <span className="block text-[9px] uppercase tracking-wide text-[#888]">Canvas link</span>
            <span className="mt-1 block break-all font-mono text-[10px] text-[#c8c8c8]">{reviewUrl}</span>
          </span>
          {mode !== "invited" ? <button className="h-8 shrink-0 rounded-[5px] border border-[#464646] px-3 text-[11px] font-medium text-[#ddd] hover:bg-[#303030]" onClick={() => void copyCanvasLink()} type="button">Copy link</button> : null}
        </div>
      ) : null}

      {mode === "invited" ? (
        <form className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_140px_auto]" onSubmit={(event) => void createInvite(event)}>
          <label className="sr-only" htmlFor="handoff-invite-email">Email address</label>
          <input autoComplete="email" className="h-9 min-w-0 rounded-[5px] border border-[#414141] bg-[#191919] px-2.5 text-[11px] text-[#ddd] placeholder:text-[#888] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#aaa]" disabled={!reviewUrl || loading || pending} id="handoff-invite-email" onChange={(event) => setInviteEmail(event.target.value)} placeholder="name@company.com" required type="email" value={inviteEmail} />
          <label className="sr-only" htmlFor="handoff-invite-expiry">Invitation expiry</label>
          <select className="h-9 rounded-[5px] border border-[#414141] bg-[#191919] px-2 text-[11px] text-[#ddd] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#aaa]" disabled={!reviewUrl || loading || pending} id="handoff-invite-expiry" onChange={(event) => setInviteExpiry(event.target.value)} value={inviteExpiry}>
            <option value="1">Expires in 1 day</option><option value="7">Expires in 7 days</option><option value="15">Expires in 15 days</option><option value="30">Expires in 30 days</option><option value="90">Expires in 90 days</option><option value="365">Expires in 1 year</option><option value="never">Never expires</option>
          </select>
          <button className="h-9 rounded-[5px] border border-[#464646] px-3 text-[11px] font-medium text-[#ddd] hover:bg-[#303030] disabled:opacity-50" disabled={!reviewUrl || loading || pending} type="submit">Create invite</button>
        </form>
      ) : null}

      {createdInviteUrl ? (
        <div className="flex flex-wrap gap-2">
          <label className="sr-only" htmlFor="created-handoff-invite">Invitation link</label>
          <input className="h-9 min-w-0 flex-1 rounded-[5px] border border-[#3b3b3b] bg-[#171717] px-2.5 font-mono text-[10px] text-[#c8c8c8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#aaa]" id="created-handoff-invite" readOnly value={createdInviteUrl} />
          <button className="h-9 rounded-control bg-primary px-3 text-[11px] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover" onClick={() => void copyInviteLink()} type="button">Copy invite link</button>
        </div>
      ) : null}

      <section aria-labelledby="handoff-invites-heading">
        <h4 className="text-[10px] font-semibold uppercase tracking-wide text-[#999]" id="handoff-invites-heading">{mode === "invited" && reviewUrl ? "Invited people with access" : "Invitation links"} <span className="font-mono">{invites.length.toString().padStart(2, "0")}</span></h4>
        {mode !== "invited" && invites.length ? <p className="mt-1 text-[10px] leading-4 text-[#888]">These invitation links are inactive while this handoff uses another access mode. You can still revoke them.</p> : null}
        {invites.length ? (
          <ul className="mt-2 divide-y divide-[#383838] rounded-[5px] border border-[#383838] px-2.5">
            {invites.map((invite) => (
              <li className="flex min-h-10 items-center justify-between gap-2 py-2" key={invite.id}>
                <span className="min-w-0">
                  <span className="block truncate text-[11px] text-[#d0d0d0]">{invite.email}</span>
                  <span className="mt-0.5 block text-[9px] text-[#888]">{invite.expiresAt ? `Expires ${new Date(invite.expiresAt).toLocaleDateString()}` : "Never expires"}</span>
                </span>
                <button className="min-h-8 shrink-0 rounded-[4px] px-2 text-[10px] text-[#aaa] hover:bg-[#333] hover:text-white disabled:opacity-50" disabled={pending || loading} onClick={() => void revokeInvite(invite.id)} type="button">Revoke</button>
              </li>
            ))}
          </ul>
        ) : <p className="mt-1 text-[11px] text-[#888]">No active invitations.</p>}
      </section>

      {error ? <p className="text-[11px] text-[#efaa4a]" role="alert">{error}</p> : null}
      {message ? <p className="text-[11px] text-[#aaa]" role="status">{message}</p> : null}
    </div>
  );
}
