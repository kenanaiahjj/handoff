"use client";

import { useState } from "react";
import { useConfirm } from "@/src/components/ConfirmDialog";
import type { Member } from "@/src/server/services/members";

const roleOptions = [
  { value: "owner", label: "Owner" },
  { value: "designer", label: "Designer" },
  { value: "reviewer", label: "Reviewer" },
  { value: "developer", label: "Developer" },
  { value: "qa", label: "QA" },
] as const;

const jobLabels: Record<string, string> = {
  designer: "Product designer",
  dev: "Developer",
  qa: "QA",
  pm: "Product manager",
  marketing: "Marketing",
  exec: "Executive",
};

/** Team members. Owners change roles, remove people, and approve designer requests. */
export function MembersPanel({
  workspaceId,
  initial,
  currentUserId,
  canEdit,
}: {
  workspaceId: string;
  initial: Member[];
  currentUserId: string;
  canEdit: boolean;
}) {
  const [members, setMembers] = useState(initial);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const { confirm, dialog } = useConfirm();
  const pending = members.filter((member) => member.requestedRole);

  async function send(userId: string, init: RequestInit, success: string) {
    setBusy(userId);
    setMessage("");
    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(userId)}`, {
        ...init,
        headers: { "content-type": "application/json" },
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "That change didn't go through. Try again.");
      setMembers(result.members);
      setMessage(success);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy("");
    }
  }

  const changeRole = (member: Member, role: string) =>
    send(member.id, { method: "PATCH", body: JSON.stringify({ role }) }, `${member.name} is now ${roleOptions.find((option) => option.value === role)?.label.toLowerCase()}.`);

  async function remove(member: Member) {
    const confirmed = await confirm({
      title: `Remove ${member.name}?`,
      description: "They lose access to every project and handoff right away, and their shares are revoked. Invite them again to bring them back.",
      confirmLabel: "Remove",
    });
    if (confirmed) await send(member.id, { method: "DELETE" }, `${member.name} was removed.`);
  }

  return (
    <div className="space-y-3">
      {canEdit && pending.length ? (
        <ul aria-label="Designer access requests" className="space-y-1.5">
          {pending.map((member) => (
            <li className="members-request rounded-control px-3 py-2.5" key={member.id}>
              <p className="text-[12px] text-foreground">
                <span className="font-medium">{member.name}</span>
                <span className="text-foreground-muted"> asked for designer access</span>
              </p>
              <p className="truncate text-[11px] text-foreground-subtle">{member.email}</p>
              <div className="mt-2 flex gap-1.5">
                <button
                  className="h-7 rounded-[7px] bg-[#f4f4f4] px-2.5 text-[11px] font-medium text-[#161616] hover:bg-white disabled:opacity-50"
                  disabled={busy === member.id}
                  onClick={() => void changeRole(member, "designer")}
                  type="button"
                >
                  Approve
                </button>
                <button
                  className="dial-button min-h-7 px-2.5 text-[11px]"
                  disabled={busy === member.id}
                  onClick={() => void send(member.id, { method: "PATCH", body: JSON.stringify({ request: "decline" }) }, `Declined ${member.name}'s request.`)}
                  type="button"
                >
                  Decline
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <ul className="space-y-1">
        {members.map((member) => {
          const isYou = member.id === currentUserId;
          const locked = !canEdit || isYou || member.isAdmin;
          return (
            <li className="dial-row flex items-center gap-2.5 px-2.5 py-2" key={member.id}>
              <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-strong text-[10px] font-semibold">
                {member.name.trim().slice(0, 1).toUpperCase() || "?"}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-medium text-foreground">
                  {member.name}
                  {isYou ? <span className="ml-1.5 font-normal text-foreground-subtle">(you)</span> : null}
                </span>
                <span className="block truncate text-[11px] text-foreground-subtle">
                  {member.isAdmin ? "Admin · " : ""}
                  {member.jobRole ? `${jobLabels[member.jobRole] ?? member.jobRole} · ` : ""}
                  {member.email}
                </span>
              </span>
              {locked ? (
                <span className="shrink-0 text-[11px] capitalize text-foreground-muted" title={member.isAdmin ? "Admins are managed under Admins" : undefined}>
                  {roleOptions.find((option) => option.value === member.role)?.label ?? member.role}
                </span>
              ) : (
                <>
                  <label className="sr-only" htmlFor={`member-role-${member.id}`}>Role for {member.name}</label>
                  <select
                    className="h-7 shrink-0 rounded-[7px] border border-transparent bg-surface-inset px-1.5 text-[11px] text-foreground outline-none focus-visible:border-foreground/30 disabled:opacity-50"
                    disabled={busy === member.id}
                    id={`member-role-${member.id}`}
                    onChange={(event) => void changeRole(member, event.target.value)}
                    value={member.role}
                  >
                    {roleOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <button
                    aria-label={`Remove ${member.name}`}
                    className="grid size-7 shrink-0 place-items-center rounded-[7px] text-foreground-subtle hover:bg-surface-raised hover:text-foreground disabled:opacity-50"
                    disabled={busy === member.id}
                    onClick={() => void remove(member)}
                    title="Remove from team"
                    type="button"
                  >
                    <svg aria-hidden="true" className="size-3.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" viewBox="0 0 16 16">
                      <path d="m4.5 4.5 7 7m0-7-7 7" />
                    </svg>
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>
      {message ? <p aria-live="polite" className="text-[12px] leading-5 text-foreground-muted">{message}</p> : null}
      {dialog}
    </div>
  );
}
