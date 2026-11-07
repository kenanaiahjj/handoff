"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/src/client/auth-client";

export function SignOutButton({ hidden = false }: { hidden?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  if (hidden) return null;

  async function signOut() {
    setPending(true);
    await authClient.signOut();
    router.replace("/sign-in");
    router.refresh();
  }

  return (
    <button
      className="h-9 rounded-control border border-border px-3 text-sm text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground disabled:opacity-60"
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
      router.push(`/workspace/${result.workspace.id}`);
      router.refresh();
    } catch {
      setErrorMessage("We couldn't reach the workspace service. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="flex flex-col gap-3 sm:flex-row" onSubmit={createWorkspace}>
      <label className="sr-only" htmlFor="workspace-name">Workspace name</label>
      <input
        className="h-9 min-w-0 flex-1 rounded-[5px] border border-[#383838] bg-[#171717] px-3 text-[12px] text-[#dedede] outline-none placeholder:text-[#a0a0a0] focus-visible:border-[#777] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#777]"
        id="workspace-name"
        maxLength={80}
        onChange={(event) => setName(event.target.value)}
        placeholder="For example, Product design"
        required
        value={name}
      />
      <button
        className="h-9 rounded-[5px] bg-[#65a854] px-4 text-[12px] font-semibold text-[#111] transition-colors hover:bg-[#75b563] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#aaa] disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? "Creating…" : "Create workspace"}
      </button>
      {errorMessage && <p className="text-sm text-danger sm:basis-full" role="alert">{errorMessage}</p>}
    </form>
  );
}

export function CreateProjectForm({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function createProject(event: FormEvent<HTMLFormElement>) {
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
      router.push(`/workspace/${workspaceId}/projects/${result.project.id}`);
      router.refresh();
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
        className="h-9 min-w-0 flex-1 rounded-[5px] border border-[#383838] bg-[#171717] px-3 text-[12px] text-[#dedede] outline-none placeholder:text-[#a0a0a0] focus-visible:border-[#777] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#777]"
        id="project-name"
        maxLength={80}
        onChange={(event) => setName(event.target.value)}
        placeholder="For example, Mobile app redesign"
        required
        value={name}
      />
      <button
        className="h-9 rounded-[5px] bg-[#65a854] px-4 text-[12px] font-semibold text-[#111] transition-colors hover:bg-[#75b563] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#aaa] disabled:opacity-60"
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
      <p className="max-w-[68ch] text-[12px] leading-5 text-[#a6a6a6]">Anyone with a link can join with this role. Links can be reused until they expire or you revoke them. Copy each link before leaving; you can’t retrieve it later.</p>
      <form className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_170px_auto]" onSubmit={createInvite}>
        <label className="space-y-1.5 text-[12px] text-[#dedede]" htmlFor="invite-role">
          <span className="block font-medium">Team role</span>
          <select
            className="h-9 w-full rounded-[5px] border border-[#383838] bg-[#171717] px-3 text-[12px] text-[#dedede] outline-none focus-visible:border-[#777] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#777]"
            id="invite-role"
            onChange={(event) => setRole(event.target.value)}
            value={role}
          >
            <option value="designer">Designer</option>
            <option value="reviewer">Product manager / reviewer</option>
            <option value="developer">Developer</option>
            <option value="qa">QA</option>
            <option value="owner">Owner</option>
          </select>
        </label>
        <label className="space-y-1.5 text-[12px] text-[#dedede]" htmlFor="invite-expiry">
          <span className="block font-medium">Link expires</span>
          <select
            className="h-9 w-full rounded-[5px] border border-[#383838] bg-[#171717] px-3 text-[12px] text-[#dedede] outline-none focus-visible:border-[#777] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#777]"
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
            <option value="never">Never (until revoked)</option>
          </select>
        </label>
        <button
          className="h-9 self-end rounded-[5px] bg-[#65a854] px-3 text-[12px] font-semibold text-[#111] transition-colors hover:bg-[#75b563] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#aaa] disabled:opacity-60"
          disabled={pending}
          type="submit"
        >
          {pending ? "Creating…" : "Create invite"}
        </button>
      </form>

      {invites.length ? (
        <section aria-labelledby="active-invites-title" className="border-t border-[#383838] pt-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-[12px] font-semibold text-[#dedede]" id="active-invites-title">Active invite links</h3>
            <span className="font-mono text-[10px] text-[#999]">{invites.length.toString().padStart(2, "0")}</span>
          </div>
          <ul className="mt-2 divide-y divide-[#383838]">
            {invites.map((invite) => (
              <li className="flex flex-wrap items-center gap-2 py-2.5" key={invite.id}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-medium capitalize text-[#dedede]">{invite.role}</span>
                  <span className="mt-0.5 block text-[10px] text-[#999]">
                    {invite.expiresAt ? `Expires ${new Date(invite.expiresAt).toLocaleDateString()}` : "Never expires"}
                    <span aria-hidden="true"> · </span>
                    Created {new Date(invite.createdAt).toLocaleDateString()}
                  </span>
                </span>
                {invite.inviteUrl ? (
                  <button className="h-7 rounded-[5px] border border-[#464646] px-2.5 text-[10px] font-medium text-[#ccc] transition-colors hover:bg-[#303030] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#aaa]" onClick={() => copyInvite(invite.inviteUrl!)} type="button">Copy link</button>
                ) : null}
                <button className="h-7 rounded-[5px] border border-[#464646] px-2.5 text-[10px] font-medium text-[#ccc] transition-colors hover:border-[#7d4a46] hover:bg-[#3a2422] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#aaa] disabled:opacity-50" disabled={revokingId === invite.id} onClick={() => revokeInvite(invite.id)} type="button">
                  {revokingId === invite.id ? "Revoking…" : "Revoke"}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="border-t border-[#383838] pt-3 text-[11px] text-[#999]">No active invite links.</p>
      )}
      {message && <p className="text-[11px] text-[#bdbdbd]" role="status">{message}</p>}
    </div>
  );
}
