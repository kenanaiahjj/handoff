"use client";

import { type FormEvent, useState } from "react";
import { inviteRoleLabel, inviteRoles, isInviteRole, workspaceRoleLabel } from "@/src/lib/team-roles";
import { useConfirm } from "@/src/components/ConfirmDialog";
import { useRouter } from "next/navigation";
import { authClient } from "@/src/client/auth-client";
import { clearDeviceCache } from "@/src/client/device-cache";

export function SignOutButton({ devBypass = false, icon = false }: { devBypass?: boolean; icon?: boolean }) {
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    await clearDeviceCache();
    if (devBypass) {
      // Development: leave the local bypass for this browser so the real sign-in page shows.
      await fetch("/api/dev/bypass", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: false }) }).catch(() => undefined);
    }
    await authClient.signOut().catch(() => undefined);
    // A full load drops every cached render from the signed-in session.
    window.location.replace("/sign-in");
  }

  if (icon) {
    return (
      <button
        aria-label="Sign out"
        className="grid size-8 shrink-0 place-items-center rounded-control text-foreground-subtle transition-colors hover:bg-white/[0.07] hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-60"
        disabled={pending}
        onClick={signOut}
        title="Sign out"
        type="button"
      >
        {pending ? (
          <span aria-hidden="true" className="size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" />
        ) : (
          <svg aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" viewBox="0 0 16 16"><path d="M9.5 3H4.5v10h5M7 8h6.5m-2-2 2 2-2 2" /></svg>
        )}
      </button>
    );
  }

  return (
    <button
      className="h-8 shrink-0 rounded-control px-2.5 text-[12px] text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground disabled:opacity-60"
      disabled={pending}
      onClick={signOut}
      type="button"
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}

export function CreateWorkspaceForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function createWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setErrorMessage("");

    try {
      const response = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const result = await response.json();
      if (!response.ok) {
        setErrorMessage(result.error ?? "Workspace creation failed.");
        return;
      }
      router.push(`/workspace`);
      router.refresh();
    } catch {
      setErrorMessage("We couldn't reach the workspace service. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="flex flex-wrap gap-3" onSubmit={createWorkspace}>
      <label className="sr-only" htmlFor="workspace-name">Workspace name</label>
      <input
        className="h-9 min-w-[12rem] flex-1 basis-48 rounded-control border border-transparent bg-surface-inset px-3 text-[12px] text-foreground outline-none placeholder:text-foreground-subtle focus-visible:border-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-hover"
        id="workspace-name"
        maxLength={80}
        onChange={(event) => setName(event.target.value)}
        placeholder="For example, Product design"
        required
        value={name}
      />
      <button
        className="capture-primary-action h-9 shrink-0 px-4 text-[12px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-hover disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? "Creating…" : "Create workspace"}
      </button>
      {errorMessage && <p className="basis-full text-sm text-danger" role="alert">{errorMessage}</p>}
    </form>
  );
}

export function CreateProjectForm({ workspaceId, autoFocus = false }: { workspaceId: string; autoFocus?: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function createProject(event: FormEvent<HTMLFormElement>) {
    const form = event.currentTarget;
    event.preventDefault();
    setPending(true);
    setErrorMessage("");

    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/projects`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const result = await response.json();
      if (!response.ok) {
        setErrorMessage(result.error ?? "Project creation failed.");
        return;
      }
      const dialog = form.closest("dialog");
      if (dialog instanceof HTMLDialogElement && dialog.open) dialog.close();
      router.push(result.projectHref ?? `/projects/${result.project.id}`);
    } catch {
      setErrorMessage("We couldn't reach the project service. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="flex flex-col gap-3 sm:flex-row" onSubmit={createProject}>
      <label className="sr-only" htmlFor="project-name">Project name</label>
      <input
        data-autofocus={autoFocus || undefined}
        className="h-10 min-w-0 rounded-control border border-transparent bg-surface-inset px-3 text-[12px] sm:h-9 sm:flex-1 text-foreground outline-none placeholder:text-foreground-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-hover"
        id="project-name"
        maxLength={80}
        onChange={(event) => setName(event.target.value)}
        placeholder="For example, Mobile app redesign"
        required
        value={name}
      />
      <button
        className="capture-primary-action h-10 px-4 text-[12px] font-semibold sm:h-9 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-hover disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? "Creating…" : "Create project"}
      </button>
      {errorMessage && <p className="text-sm text-danger sm:basis-full" role="alert">{errorMessage}</p>}
    </form>
  );
}

type InviteEntry = {
  id: string;
  role: string;
  jobRole?: string | null;
  expiresAt: string | null;
  createdAt: string;
  inviteUrl?: string;
};

export function CreateInviteForm({ workspaceId, initialInvites = [] }: { workspaceId: string; initialInvites?: InviteEntry[] }) {
  const [invites, setInvites] = useState(initialInvites);
  const [role, setRole] = useState("designer");
  const [expiresInDays, setExpiresInDays] = useState("7");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [revokingId, setRevokingId] = useState("");
  const { confirm, dialog } = useConfirm();

  async function createInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");

    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/invites`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role, expiresInDays: expiresInDays === "never" ? null : Number(expiresInDays) }),
      });
      const result = await response.json();
      if (!response.ok) {
        setMessage(result.error ?? "We couldn't create the invitation.");
        return;
      }
      setInvites((current) => [{ ...result.invite, inviteUrl: result.inviteUrl }, ...current]);
      setMessage(result.invite.expiresAt
        ? `Reusable invite link created. It expires ${new Date(result.invite.expiresAt).toLocaleDateString()}.`
        : "Reusable invite link created. It stays active until you revoke it.");
    } catch {
      setMessage("We couldn't reach the invitation service. Try again.");
    } finally {
      setPending(false);
    }
  }

  async function copyInvite(inviteUrl: string) {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setMessage("Invite link copied.");
    } catch {
      setMessage("Select the invite link and copy it.");
    }
  }

  async function revokeInvite(inviteId: string) {
    const invite = invites.find((entry) => entry.id === inviteId);
    const confirmed = await confirm({
      title: "Revoke invite link?",
      description: `Anyone holding this ${invite?.role ?? ""} invite link will no longer be able to join the workspace.`,
      confirmLabel: "Revoke link",
    });
    if (!confirmed) return;
    setRevokingId(inviteId);
    setMessage("");

    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/invites/${inviteId}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) {
        setMessage(result.error ?? "We couldn't revoke this invitation.");
        return;
      }
      setInvites((current) => current.filter((invite) => invite.id !== inviteId));
      setMessage("Invite link revoked. It can no longer be used to join.");
    } catch {
      setMessage("We couldn't reach the invitation service. Try again.");
    } finally {
      setRevokingId("");
    }
  }

  return (
    <div className="space-y-4">
      <p className="max-w-[68ch] text-[12px] leading-5 text-foreground-muted">Anyone with the link joins with this role until it expires or you revoke it. Copy it right away; it can’t be shown again.</p>
      <form className="grid gap-3" onSubmit={createInvite}>
        <label className="space-y-1.5 text-[12px] text-foreground" htmlFor="invite-role">
          <span className="block font-medium">Team role</span>
          <select
            className="h-9 w-full rounded-control border border-transparent bg-surface-inset px-3 text-[12px] text-foreground outline-none focus-visible:border-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-hover"
            id="invite-role"
            onChange={(event) => setRole(event.target.value)}
            value={role}
          >
            {inviteRoles.map((option) => (
              <option key={option} value={option}>{inviteRoleLabel(option)}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1.5 text-[12px] text-foreground" htmlFor="invite-expiry">
          <span className="block font-medium">Link expires</span>
          <select
            className="h-9 w-full rounded-control border border-transparent bg-surface-inset px-3 text-[12px] text-foreground outline-none focus-visible:border-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-hover"
            id="invite-expiry"
            onChange={(event) => setExpiresInDays(event.target.value)}
            value={expiresInDays}
          >
            <option value="1">1 day</option>
            <option value="7">7 days</option>
            <option value="15">15 days</option>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
            <option value="365">1 year</option>
            <option value="never">Never</option>
          </select>
        </label>
        <button
          className="capture-primary-action h-9 self-end px-3 text-[12px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-hover disabled:opacity-60"
          disabled={pending}
          type="submit"
        >
          {pending ? "Creating…" : "Create invite"}
        </button>
      </form>

      {invites.length ? (
        <section aria-labelledby="active-invites-title" className="pt-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-[12px] font-semibold text-foreground" id="active-invites-title">Active invite links</h3>
            <span className="text-[11px] tabular-nums text-foreground-subtle">{invites.length}</span>
          </div>
          <ul className="mt-2 divide-y divide-border">
            {invites.map((invite) => (
              <li className="flex flex-wrap items-center gap-2 py-2.5" key={invite.id}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-medium text-foreground">{invite.jobRole && isInviteRole(invite.jobRole) ? inviteRoleLabel(invite.jobRole) : workspaceRoleLabel(invite.role)}</span>
                  <span className="mt-0.5 block text-[10px] text-foreground-subtle">
                    {invite.expiresAt ? `Expires ${new Date(invite.expiresAt).toLocaleDateString()}` : "Never expires"}
                    <span aria-hidden="true"> · </span>
                    Created {new Date(invite.createdAt).toLocaleDateString()}
                  </span>
                </span>
                {invite.inviteUrl ? (
                  <button className="h-7 rounded-control bg-surface-raised px-2.5 text-[10px] font-medium text-foreground-muted transition-colors hover:bg-border hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" onClick={() => copyInvite(invite.inviteUrl!)} type="button">Copy link</button>
                ) : null}
                <button className="h-7 rounded-control px-2.5 text-[10px] font-medium text-danger transition-colors hover:bg-danger/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-danger disabled:opacity-50" disabled={revokingId === invite.id} onClick={() => revokeInvite(invite.id)} type="button">
                  {revokingId === invite.id ? "Revoking…" : "Revoke"}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="pt-3 text-[11px] text-foreground-subtle">No active invite links.</p>
      )}
      {message && <p className="text-[11px] text-foreground-muted" role="status">{message}</p>}
      {dialog}
    </div>
  );
}
