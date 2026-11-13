"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type SharingMode = "workspace" | "invited" | "anyone";
type InviteRole = "pd" | "qa" | "dev" | "exec";
type HandoffInvite = { id: string; email: string; role: InviteRole; expiresAt: string | null; createdAt: string };
type WorkspaceMember = { id: string; name: string; email: string; role: "owner" | "designer" | "reviewer" | "developer" | "qa" };
type SharingPayload = { mode: SharingMode; reviewUrl: string | null; invites: HandoffInvite[]; workspaceMembers: WorkspaceMember[]; error?: string };
type InviteResponse = { invite?: { inviteUrl: string; id: string; email: string; role: InviteRole; expiresAt: string | null }; error?: string };

export function HandoffSharingControls({ endpoint, refreshKey = 0 }: { endpoint: string; refreshKey?: number }) {
  const [mode, setMode] = useState<SharingMode>("workspace");
  const [reviewUrl, setReviewUrl] = useState("");
  const [invites, setInvites] = useState<HandoffInvite[]>([]);
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMember[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<InviteRole>("exec");
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

  async function updateMode(nextMode: SharingMode, revokePublicLink = false) {
    setPending(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`${endpoint}/sharing`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: nextMode, ...(revokePublicLink ? { revokePublicLink: true } : {}) }),
      });
      const payload = await response.json() as {
        mode?: SharingMode;
        reviewUrl?: string;
        invites?: HandoffInvite[];
        error?: string;
      };
      if (!response.ok || !payload.mode) throw new Error(payload.error ?? "Could not update sharing settings.");
      setMode(payload.mode);
      if (payload.reviewUrl) setReviewUrl(payload.reviewUrl);
      if (revokePublicLink) {
        setInvites(payload.invites ?? []);
        setCreatedInviteUrl("");
        setMessage("Public link revoked. Outstanding invitation links were also revoked. The new canvas link requires workspace sign-in.");
      } else {
        setMessage(mode === "anyone" && payload.mode !== "anyone"
          ? "Public access is off. The canvas link now requires workspace access."
          : "Sharing settings updated.");
      }
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
        body: JSON.stringify({ email: inviteEmail, role: inviteRole, expiresInDays: inviteExpiry === "never" ? null : Number(inviteExpiry) }),
      });
      const payload = await response.json() as InviteResponse;
      if (!response.ok || !payload.invite) throw new Error(payload.error ?? "Could not create this invitation.");
      setCreatedInviteUrl(payload.invite.inviteUrl);
      setInviteEmail("");
      setMessage(`Invite link created for ${payload.invite.email} · ${payload.invite.role.toUpperCase()}. Anyone with the link can view and comment without signing in.`);
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
    <div className="mt-3 space-y-3 border-t border-border pt-3">
      <label className="grid gap-1.5 text-xs text-foreground-muted" htmlFor="handoff-sharing-mode">
        Who can open this canvas?
        <select className="min-h-10 w-full rounded-control border border-border bg-surface-inset px-3 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" disabled={pending || loading} id="handoff-sharing-mode" onChange={(event) => void updateMode(event.target.value as SharingMode)} value={mode}>
          <option value="workspace">Workspace members — sign in required</option>
          <option value="invited">Only invited people — role-based link</option>
          <option value="anyone">Anyone with the link — no sign-in</option>
        </select>
      </label>

      {loading ? <p className="text-xs text-foreground-subtle" role="status">Loading access…</p> : null}
      {!loading && !reviewUrl ? <p className="rounded-md bg-surface-inset px-3 py-2.5 text-xs leading-5 text-foreground-muted">This handoff has no published canvas link yet. Open the canvas to publish a version.</p> : null}
      {mode === "invited" ? <p className="text-xs leading-5 text-foreground-muted">Invite links don’t require sign-in. All roles get the same canvas and comment tools. Comments use the invite’s email and role as labels; neither is verified. Anyone who gets a link can view and comment until it expires or you revoke it.</p> : null}
      {mode === "anyone" && reviewUrl ? (
        <div>
          <p className="text-[11px] leading-4 text-foreground-subtle">This also invalidates outstanding invitation links.</p>
          <button className="mt-1 min-h-9 rounded-control px-2.5 text-xs font-medium text-danger hover:bg-danger/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger disabled:opacity-50" disabled={pending || loading} onClick={() => void updateMode("workspace", true)} type="button">Revoke public link</button>
        </div>
      ) : null}

      <section aria-labelledby="handoff-access-list-heading">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-foreground-muted" id="handoff-access-list-heading">Who can open the published canvas?</h4>
        {!reviewUrl ? <p className="mt-1 text-xs leading-5 text-foreground-subtle">Review link access starts after you publish a version.</p> : null}
        {reviewUrl && mode === "workspace" ? <p className="mt-1 text-xs leading-5 text-foreground-muted">All listed workspace members can open this canvas.</p> : null}
        {reviewUrl && mode === "invited" ? <p className="mt-1 text-xs leading-5 text-foreground-muted">Workspace owners and designers, plus anyone with an active invite link, can view and comment. Emails below are recipient labels.</p> : null}
        {reviewUrl && mode === "anyone" ? <p className="mt-1 text-xs leading-5 text-foreground-muted">Anyone with this link can view the canvas. Link viewers are not identifiable here. Workspace owners and designers can manage it.</p> : null}

        {mode === "workspace" ? (
          workspaceMembers.length ? (
            <ul className="mt-2 max-h-44 divide-y divide-border overflow-y-auto rounded-md border border-border bg-surface-inset px-3">
              {workspaceMembers.map((member) => (
                <li className="flex min-h-10 items-center justify-between gap-2 py-2" key={member.id}>
                  <span className="min-w-0">
                  <span className="block truncate text-xs text-foreground">{member.name}</span>
                  <span className="mt-0.5 block truncate text-[11px] text-foreground-subtle">{member.email}</span>
                  </span>
                <span className="shrink-0 text-[11px] capitalize text-foreground-subtle">{member.role}</span>
                </li>
              ))}
            </ul>
          ) : <p className="mt-1 text-xs text-foreground-subtle">No workspace members were found.</p>
        ) : null}

        {mode !== "workspace" ? (
          <>
            <p className="mt-2 text-[11px] font-medium uppercase tracking-wide text-foreground-subtle">Workspace owners and designers</p>
            {workspaceMembers.some((member) => member.role === "owner" || member.role === "designer") ? (
              <ul className="mt-1 divide-y divide-border rounded-md border border-border bg-surface-inset px-3">
                {workspaceMembers.filter((member) => member.role === "owner" || member.role === "designer").map((member) => (
                  <li className="flex min-h-10 items-center justify-between gap-2 py-2" key={member.id}>
                    <span className="min-w-0">
                    <span className="block truncate text-xs text-foreground">{member.name}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-foreground-subtle">{member.email}</span>
                    </span>
                  <span className="shrink-0 text-[11px] capitalize text-foreground-subtle">{member.role}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-1 text-xs text-foreground-subtle">No workspace owners or designers were found.</p>}
          </>
        ) : null}
      </section>

      {reviewUrl ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface-inset px-3 py-2.5">
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] uppercase tracking-wide text-foreground-subtle">Canvas link</span>
            <span className="mt-1 block break-all font-mono text-[11px] text-foreground-muted">{reviewUrl}</span>
          </span>
          {mode !== "invited" ? <button className="min-h-9 shrink-0 rounded-control border border-border-strong bg-surface-raised px-3 text-xs font-medium text-foreground transition-colors hover:bg-surface-raised/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" onClick={() => void copyCanvasLink()} type="button">Copy link</button> : null}
        </div>
      ) : null}

      {mode === "invited" ? (
        <form className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_104px_140px_auto]" onSubmit={(event) => void createInvite(event)}>
          <label className="sr-only" htmlFor="handoff-invite-email">Recipient email label</label>
          <input autoComplete="email" className="min-h-10 min-w-0 rounded-control border border-border bg-surface-inset px-3 text-xs text-foreground placeholder:text-foreground-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" disabled={!reviewUrl || loading || pending} id="handoff-invite-email" onChange={(event) => setInviteEmail(event.target.value)} placeholder="name@company.com" required type="email" value={inviteEmail} />
          <label className="sr-only" htmlFor="handoff-invite-role">Invite role</label>
          <select className="min-h-10 rounded-control border border-border bg-surface-inset px-3 text-xs uppercase text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" disabled={!reviewUrl || loading || pending} id="handoff-invite-role" onChange={(event) => setInviteRole(event.target.value as InviteRole)} value={inviteRole}>
            <option value="pd">PD</option><option value="qa">QA</option><option value="dev">DEV</option><option value="exec">EXEC</option>
          </select>
          <label className="sr-only" htmlFor="handoff-invite-expiry">Invitation expiry</label>
          <select className="min-h-10 rounded-control border border-border bg-surface-inset px-3 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" disabled={!reviewUrl || loading || pending} id="handoff-invite-expiry" onChange={(event) => setInviteExpiry(event.target.value)} value={inviteExpiry}>
            <option value="1">Expires in 1 day</option><option value="7">Expires in 7 days</option><option value="15">Expires in 15 days</option><option value="30">Expires in 30 days</option><option value="90">Expires in 90 days</option><option value="365">Expires in 1 year</option><option value="never">Never expires</option>
          </select>
          <button className="min-h-10 rounded-control border border-border-strong bg-surface-raised px-3 text-xs font-medium text-foreground transition-colors hover:bg-surface-raised/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50" disabled={!reviewUrl || loading || pending} type="submit">Create invite</button>
        </form>
      ) : null}

      {createdInviteUrl ? (
        <div className="flex flex-wrap gap-2">
          <label className="sr-only" htmlFor="created-handoff-invite">Invitation link</label>
          <input className="min-h-10 min-w-0 flex-1 rounded-control border border-border bg-surface-inset px-3 font-mono text-[11px] text-foreground-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" id="created-handoff-invite" readOnly value={createdInviteUrl} />
          <button className="min-h-10 rounded-control bg-primary px-3 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" onClick={() => void copyInviteLink()} type="button">Copy invite link</button>
        </div>
      ) : null}

      <section aria-labelledby="handoff-invites-heading">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-foreground-muted" id="handoff-invites-heading">{mode === "invited" && reviewUrl ? "Active invite links" : "Invitation links"} <span className="font-mono">{invites.length.toString().padStart(2, "0")}</span></h4>
        {mode !== "invited" && invites.length ? <p className="mt-1 text-[11px] leading-4 text-foreground-subtle">These invitation links are inactive while this handoff uses another access mode. You can still revoke them.</p> : null}
        {invites.length ? (
          <ul className="mt-2 divide-y divide-border rounded-md border border-border bg-surface-inset px-3">
            {invites.map((invite) => (
              <li className="flex min-h-10 items-center justify-between gap-2 py-2" key={invite.id}>
                <span className="min-w-0">
                <span className="block truncate text-xs text-foreground">{invite.email} <span className="ml-1 rounded bg-surface-raised px-1.5 py-0.5 font-mono text-[10px] uppercase text-foreground-subtle">{invite.role}</span></span>
                <span className="mt-0.5 block text-[11px] text-foreground-subtle">{invite.expiresAt ? `Expires ${new Date(invite.expiresAt).toLocaleDateString()}` : "Never expires"}</span>
                </span>
              <button className="min-h-9 shrink-0 rounded-control px-2.5 text-xs font-medium text-danger hover:bg-danger/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger disabled:opacity-50" disabled={pending || loading} onClick={() => void revokeInvite(invite.id)} type="button">Revoke</button>
              </li>
            ))}
          </ul>
        ) : <p className="mt-1 text-xs text-foreground-subtle">No active invitations.</p>}
      </section>

      {error ? <p className="text-xs text-warning" role="alert">{error}</p> : null}
      {message ? <p className="text-xs text-foreground-muted" role="status">{message}</p> : null}
    </div>
  );
}
