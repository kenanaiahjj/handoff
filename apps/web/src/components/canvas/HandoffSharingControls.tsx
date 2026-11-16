"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/src/components/ConfirmDialog";

type SharingMode = "workspace" | "invited" | "anyone";
type InviteRole = "pd" | "qa" | "dev" | "exec";
type HandoffInvite = { id: string; email: string; role: InviteRole; expiresAt: string | null; createdAt: string };
type WorkspaceMember = { id: string; name: string; email: string; role: "owner" | "designer" | "reviewer" | "developer" | "qa" };
type SharingPayload = { mode: SharingMode; reviewUrl: string | null; invites: HandoffInvite[]; workspaceMembers: WorkspaceMember[]; error?: string };
type InviteResponse = { invite?: { inviteUrl: string; id: string; email: string; role: InviteRole; expiresAt: string | null }; error?: string };

export type SharingPublishTarget = { versionId: string; isLatestVersion: boolean };

export function HandoffSharingControls({ endpoint, handoffName, refreshKey = 0, publishTarget }: { endpoint: string; handoffName?: string; refreshKey?: number; publishTarget?: SharingPublishTarget }) {
  const router = useRouter();
  const [mode, setMode] = useState<SharingMode>("workspace");
  const [reviewUrl, setReviewUrl] = useState("");
  const [invites, setInvites] = useState<HandoffInvite[]>([]);
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMember[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<InviteRole>("exec");
  const [inviteExpiry, setInviteExpiry] = useState("7");
  const [createdInviteUrl, setCreatedInviteUrl] = useState("");
  const [createdInviteEmail, setCreatedInviteEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const canvasLinkCopied = message === "Canvas link copied.";
  const { confirm, dialog } = useConfirm();

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

  async function publishLatest() {
    if (!publishTarget?.isLatestVersion) return;
    setPending(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`${endpoint}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId: publishTarget.versionId }),
      });
      const payload = await response.json() as { reviewUrl?: string; error?: string };
      if (!response.ok || !payload.reviewUrl) throw new Error(payload.error ?? "Could not publish this canvas.");
      await refreshSharing();
      setMessage("Published. The review link is ready to share.");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not publish this canvas.");
    } finally {
      setPending(false);
    }
  }

  async function updateMode(nextMode: SharingMode, revokePublicLink = false) {
    if (nextMode === mode && !revokePublicLink) return;
    const confirmation = revokePublicLink
      ? { title: "Revoke public link?", description: "The current link and any outstanding invitation links will stop working. A new link will require team sign-in.", confirmLabel: "Revoke link" }
      : nextMode === "anyone"
        ? { title: "Make this canvas public?", description: "Anyone with the link will be able to view and comment without signing in.", confirmLabel: "Make public", tone: "default" as const }
        : null;
    if (confirmation && !(await confirm(confirmation))) return;
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
        setMessage("Public link revoked. Outstanding invitation links were also revoked. The new canvas link requires team sign-in.");
      } else {
        setMessage(mode === "anyone" && payload.mode !== "anyone"
          ? "Public access is off. The canvas link now requires team access."
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
    setError("");
    setMessage("");
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
    setCreatedInviteEmail("");
    try {
      const response = await fetch(`${endpoint}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole, expiresInDays: inviteExpiry === "never" ? null : Number(inviteExpiry) }),
      });
      const payload = await response.json() as InviteResponse;
      if (!response.ok || !payload.invite) throw new Error(payload.error ?? "Could not create this invitation.");
      setCreatedInviteUrl(payload.invite.inviteUrl);
      setCreatedInviteEmail(payload.invite.email);
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

  function emailInvite() {
    if (!createdInviteUrl || !createdInviteEmail) return;
    const inviteUrl = new URL(createdInviteUrl, window.location.origin).toString();
    const subject = `You're invited to review ${handoffName || "a design handoff"}`;
    const body = [
      `Please review ${handoffName || "this design handoff"}.`,
      "",
      inviteUrl,
      "",
      "Anyone with this invitation link can open the canvas and comment.",
    ].join("\n");
    window.location.href = `mailto:${encodeURIComponent(createdInviteEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  async function revokeInvite(inviteId: string) {
    const invite = invites.find((entry) => entry.id === inviteId);
    const confirmed = await confirm({
      title: "Revoke invitation?",
      description: `${invite?.email ?? "This person"} will no longer be able to open the canvas with their link.`,
      confirmLabel: "Revoke",
    });
    if (!confirmed) return;
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
    <div className="mt-4 space-y-4 border-t border-border pt-4">
      <label className="grid gap-1.5 text-xs text-foreground-muted" htmlFor="handoff-sharing-mode">
        Who can open this canvas?
        <select className="min-h-10 w-full rounded-control border border-transparent bg-surface-inset px-3 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" disabled={pending || loading} id="handoff-sharing-mode" onChange={(event) => void updateMode(event.target.value as SharingMode)} value={mode}>
          <option value="workspace">Team members — sign in required</option>
          <option value="invited">Only invited people — role-based link</option>
          <option value="anyone">Anyone with the link — no sign-in</option>
        </select>
      </label>

      {loading ? <p className="text-xs text-foreground-subtle" role="status">Loading access…</p> : null}
      {!loading && !reviewUrl ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-surface bg-surface-inset px-3 py-2.5">
          <p className="min-w-0 flex-1 text-xs leading-5 text-foreground-muted">
            {publishTarget
              ? publishTarget.isLatestVersion ? "Publish this version to create a review link." : "Switch to the latest version to publish a review link."
              : "Open the handoff and publish its latest version to create a review link."}
          </p>
          {publishTarget?.isLatestVersion ? (
            <button aria-busy={pending} className="canvas-publish-action min-h-9 shrink-0 px-4 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60" disabled={pending} onClick={() => void publishLatest()} type="button">
              {pending ? "Publishing…" : "Publish"}
            </button>
          ) : null}
        </div>
      ) : null}
      {mode === "invited" && reviewUrl ? <p className="text-xs leading-5 text-foreground-muted">Invite links don’t require sign-in. All roles get the same canvas and comment tools. Comments use the invite’s email and role as labels; neither is verified. Anyone who gets a link can view and comment until it expires or you revoke it.</p> : null}
      {mode === "anyone" && reviewUrl ? (
        <div>
          <p className="text-[11px] leading-4 text-foreground-subtle">This also invalidates outstanding invitation links.</p>
          <button className="mt-1 min-h-9 rounded-control px-2.5 text-xs font-medium text-danger hover:bg-danger/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger disabled:opacity-50" disabled={pending || loading} onClick={() => void updateMode("workspace", true)} type="button">Revoke public link</button>
        </div>
      ) : null}

      {reviewUrl ? <section aria-labelledby="handoff-access-list-heading">
        <h4 className="text-[12px] font-semibold text-foreground-muted" id="handoff-access-list-heading">Who can open the published canvas?</h4>
        {reviewUrl && mode === "workspace" ? <p className="mt-1 text-xs leading-5 text-foreground-muted">All listed team members can open this canvas.</p> : null}
        {reviewUrl && mode === "invited" ? <p className="mt-1 text-xs leading-5 text-foreground-muted">Owners and designers, plus anyone with an active invite link, can view and comment. Emails below are recipient labels.</p> : null}
        {reviewUrl && mode === "anyone" ? <p className="mt-1 text-xs leading-5 text-foreground-muted">Anyone with this link can view the canvas. Link viewers are not identifiable here. Owners and designers can manage it.</p> : null}

        {mode === "workspace" ? (
          workspaceMembers.length ? (
            <ul className="mt-2 max-h-44 divide-y divide-border overflow-y-auto rounded-md border border-transparent bg-surface-inset px-3">
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
          ) : <p className="mt-1 text-xs text-foreground-subtle">No team members were found.</p>
        ) : null}

        {mode !== "workspace" ? (
          <>
            <p className="mt-3 text-[12px] font-semibold text-foreground-subtle">Owners and designers</p>
            {workspaceMembers.some((member) => member.role === "owner" || member.role === "designer") ? (
              <ul className="mt-2 divide-y divide-border rounded-md border border-transparent bg-surface-inset px-4">
                {workspaceMembers.filter((member) => member.role === "owner" || member.role === "designer").map((member) => (
                  <li className="flex min-h-12 items-center justify-between gap-3 py-3" key={member.id}>
                    <span className="min-w-0">
                    <span className="block truncate text-xs text-foreground">{member.name}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-foreground-subtle">{member.email}</span>
                    </span>
                  <span className="shrink-0 text-[11px] capitalize text-foreground-subtle">{member.role}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-1 text-xs text-foreground-subtle">No owners or designers were found.</p>}
          </>
        ) : null}
      </section> : null}

      {reviewUrl ? (
        <div className="flex items-center gap-3 rounded-md border border-transparent bg-surface-inset px-3 py-3">
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] uppercase tracking-wide text-foreground-subtle">Canvas link</span>
            <span className="mt-1 block break-all font-mono text-[11px] text-foreground-muted">{reviewUrl}</span>
          </span>
          <button
            aria-label={canvasLinkCopied ? "Canvas link copied" : "Copy canvas link"}
            className="grid size-9 shrink-0 place-items-center rounded-control border border-border-strong bg-surface-raised text-foreground-muted transition-colors hover:bg-surface-strong/80 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            onClick={() => void copyCanvasLink()}
            title={canvasLinkCopied ? "Canvas link copied" : "Copy canvas link"}
            type="button"
          >
            {canvasLinkCopied ? (
              <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 16 16">
                <path d="m3.5 8.2 2.8 2.8 6.2-6.2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
              </svg>
            ) : (
              <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 16 16">
                <rect height="9.5" rx="1.5" stroke="currentColor" strokeWidth="1.3" width="9.5" x="5" y="5" />
                <path d="M10.5 3H4.5A1.5 1.5 0 0 0 3 4.5v6A1.5 1.5 0 0 0 4.5 12H5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.3" />
              </svg>
            )}
          </button>
        </div>
      ) : null}

      {mode === "invited" && reviewUrl ? (
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => void createInvite(event)}>
          <label className="sr-only" htmlFor="handoff-invite-email">Recipient email</label>
          <input autoComplete="email" className="min-h-10 min-w-0 rounded-control border border-transparent bg-surface-inset px-3 text-xs text-foreground placeholder:text-foreground-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" disabled={!reviewUrl || loading || pending} id="handoff-invite-email" onChange={(event) => setInviteEmail(event.target.value)} placeholder="name@company.com" required type="email" value={inviteEmail} />
          <label className="sr-only" htmlFor="handoff-invite-role">Invite role</label>
          <select className="min-h-10 rounded-control border border-transparent bg-surface-inset px-3 text-xs uppercase text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" disabled={!reviewUrl || loading || pending} id="handoff-invite-role" onChange={(event) => setInviteRole(event.target.value as InviteRole)} value={inviteRole}>
            <option value="pd">PD</option><option value="qa">QA</option><option value="dev">DEV</option><option value="exec">EXEC</option>
          </select>
          <label className="sr-only" htmlFor="handoff-invite-expiry">Invitation expiry</label>
          <select className="min-h-10 rounded-control border border-transparent bg-surface-inset px-3 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" disabled={!reviewUrl || loading || pending} id="handoff-invite-expiry" onChange={(event) => setInviteExpiry(event.target.value)} value={inviteExpiry}>
            <option value="1">Expires in 1 day</option><option value="7">Expires in 7 days</option><option value="15">Expires in 15 days</option><option value="30">Expires in 30 days</option><option value="90">Expires in 90 days</option><option value="365">Expires in 1 year</option><option value="never">Never expires</option>
          </select>
          <button className="min-h-10 w-full rounded-control border border-border-strong bg-surface-raised px-3 text-xs font-medium text-foreground transition-colors hover:bg-surface-strong/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50" disabled={!reviewUrl || loading || pending} type="submit">Create invite</button>
        </form>
      ) : null}

      {createdInviteUrl ? (
        <div className="flex flex-wrap gap-2">
          <label className="sr-only" htmlFor="created-handoff-invite">Invitation link</label>
          <input className="min-h-10 min-w-0 flex-1 rounded-control border border-transparent bg-surface-inset px-3 font-mono text-[11px] text-foreground-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" id="created-handoff-invite" readOnly value={createdInviteUrl} />
          <button className="min-h-10 rounded-control border border-border-strong bg-surface-raised px-3 text-xs font-medium text-foreground transition-colors hover:bg-surface-strong/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" onClick={emailInvite} title="Open a prefilled email draft in your email app" type="button">Email invite</button>
          <button className="min-h-10 rounded-control bg-primary px-3 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" onClick={() => void copyInviteLink()} type="button">Copy invite link</button>
        </div>
      ) : null}

      {reviewUrl || invites.length ? <section aria-labelledby="handoff-invites-heading">
        <h4 className="text-[12px] font-semibold text-foreground-muted" id="handoff-invites-heading">{mode === "invited" && reviewUrl ? "Active invite links" : "Invitation links"} <span className="font-mono">{invites.length.toString().padStart(2, "0")}</span></h4>
        {mode !== "invited" && invites.length ? <p className="mt-1 text-[11px] leading-4 text-foreground-subtle">These invitation links are inactive while this handoff uses another access mode. You can still revoke them.</p> : null}
        {invites.length ? (
          <ul className="mt-2 divide-y divide-border rounded-md border border-transparent bg-surface-inset px-3">
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
      </section> : null}

      {error ? <p className="text-xs text-warning" role="alert">{error}</p> : null}
      {message ? <p className="text-xs text-foreground-muted" role="status">{message}</p> : null}
      {dialog}
    </div>
  );
}
