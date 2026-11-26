"use client";

import { Avatar } from "@/src/components/Avatar";
import { profileSubtitle } from "@/src/lib/profile-fields";
import { useEffect, useMemo, useRef, useState } from "react";
import { useConfirm } from "@/src/components/ConfirmDialog";
import type { Member } from "@/src/server/services/members";
import { inviteRoleLabel, inviteRoles, jobRoles, memberRoleLabel, memberRoleValue, workspaceRoleDetails, type InviteRole } from "@/src/lib/team-roles";
import { dayMs, formatLastActive } from "@/src/lib/last-active";

type RoleFilter = "all" | "requests" | Member["role"];
type SortKey = "name" | "active" | "joined";

const roleLabel = (role: string) => workspaceRoleDetails.find((detail) => detail.role === role)?.label ?? role;
const jobLabel = (job: string | null) => (job && job in jobRoles ? jobRoles[job as keyof typeof jobRoles].label : job);
function csvCell(value: string) {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * The full member directory on the Team page: search, filter by role, sort, change roles, remove
 * people and export the list. Only owners can change anything; designers see it read-only.
 */
type OpenInvite = { id: string; role: string; jobRole: string | null; expiresAt: string | null };

/** Search, sort and role filters only earn their space once the team is this big. */
const toolsFrom = 8;

/** A "…" button with a short list of actions. */
function RowMenu({ label, items }: { label: string; items: Array<{ label: string; onSelect: () => void; danger?: boolean; disabled?: boolean }> }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={label}
        className="grid size-8 place-items-center rounded-control text-foreground-subtle transition-colors hover:bg-white/[0.07] hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <svg aria-hidden="true" className="size-4" fill="currentColor" viewBox="0 0 16 16"><circle cx="3.5" cy="8" r="1.25" /><circle cx="8" cy="8" r="1.25" /><circle cx="12.5" cy="8" r="1.25" /></svg>
      </button>
      {open ? (
        <div className="dial-popover absolute right-0 top-9 z-30 w-48 p-1" role="menu">
          {items.map((item) => (
            <button
              className={"flex h-9 w-full items-center rounded-[7px] px-2.5 text-left text-[13px] disabled:opacity-50 " + (item.danger ? "text-danger hover:bg-danger/10" : "text-foreground hover:bg-white/[0.07]")}
              disabled={item.disabled}
              key={item.label}
              onClick={() => { setOpen(false); item.onSelect(); }}
              role="menuitem"
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function TeamDirectory({
  workspaceId,
  initial,
  currentUserId,
  canEdit,
  invites: initialInvites = [],
}: {
  workspaceId: string;
  initial: Member[];
  currentUserId: string;
  canEdit: boolean;
  /** Invite links nobody has used up yet; owners see them in the list. */
  invites?: OpenInvite[];
}) {
  const [members, setMembers] = useState(initial);
  const [invites, setInvites] = useState(initialInvites);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [sort, setSort] = useState<SortKey>("name");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const { confirm, dialog } = useConfirm();
  // Read once per render pass; relative dates don't need to tick.
  const [now] = useState(() => Date.now());

  const counts = useMemo(() => {
    const byRole: Record<string, number> = {};
    for (const member of members) byRole[member.role] = (byRole[member.role] ?? 0) + 1;
    return {
      byRole,
      requests: members.filter((member) => member.requestedRole).length,
      activeWeek: members.filter((member) => member.lastActiveAt && now - new Date(member.lastActiveAt).getTime() < 7 * dayMs).length,
      neverSignedIn: members.filter((member) => !member.lastActiveAt).length,
    };
  }, [members, now]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = members.filter((member) => {
      if (roleFilter === "requests" ? !member.requestedRole : roleFilter !== "all" && member.role !== roleFilter) return false;
      return !needle || `${member.name} ${member.email} ${memberRoleLabel(member.role, member.jobRole)} ${member.title ?? ""} ${member.department ?? ""}`.toLowerCase().includes(needle);
    });
    const time = (iso: string | null) => (iso ? new Date(iso).getTime() : 0);
    return filtered.sort((a, b) =>
      sort === "active" ? time(b.lastActiveAt) - time(a.lastActiveAt)
        : sort === "joined" ? time(b.joinedAt) - time(a.joinedAt)
          : a.name.localeCompare(b.name));
  }, [members, query, roleFilter, sort]);

  async function send(member: Member, init: RequestInit, success: string) {
    setBusy(member.id);
    setMessage("");
    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(member.id)}`, {
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

  async function changeRole(member: Member, role: InviteRole) {
    if (role === memberRoleValue(member.role, member.jobRole)) return;
    if (role === "owner") {
      const confirmed = await confirm({
        title: `Make ${member.name} an owner?`,
        description: "Owners can invite and remove people, change anyone's role, and add other owners.",
        confirmLabel: "Make owner",
      });
      if (!confirmed) return;
    }
    await send(member, { method: "PATCH", body: JSON.stringify({ jobRole: role }) }, `${member.name} is now ${role === "owner" ? "an owner" : inviteRoleLabel(role)}.`);
  }

  async function remove(member: Member) {
    const confirmed = await confirm({
      title: `Remove ${member.name}?`,
      description: "They lose access to every project and handoff right away, and their shares are revoked. Invite them again to bring them back.",
      confirmLabel: "Remove",
    });
    if (confirmed) await send(member, { method: "DELETE" }, `${member.name} was removed.`);
  }

  function exportCsv() {
    const header = ["Name", "Email", "Role", "Access", "Joined", "Last active"];
    const rows = shown.map((member) => [
      member.name,
      member.email,
      memberRoleLabel(member.role, member.jobRole),
      roleLabel(member.role),
      member.joinedAt.slice(0, 10),
      member.lastActiveAt ? member.lastActiveAt.slice(0, 10) : "never",
    ]);
    const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = Object.assign(document.createElement("a"), { href: url, download: "team-members.csv" });
    link.click();
    URL.revokeObjectURL(url);
  }

  async function revokeInvite(invite: OpenInvite) {
    const confirmed = await confirm({
      title: "Revoke this invite link?",
      description: "Nobody new can join with it. People who already joined keep their access.",
      confirmLabel: "Revoke link",
    });
    if (!confirmed) return;
    setBusy(invite.id);
    setMessage("");
    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/invites/${encodeURIComponent(invite.id)}`, { method: "DELETE" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "We couldn't revoke this invite link.");
      setInvites((current) => current.filter((item) => item.id !== invite.id));
      setMessage("Invite link revoked.");
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy("");
    }
  }

  const filters: Array<{ value: RoleFilter; label: string; count: number }> = [
    { value: "all", label: "All", count: members.length },
    ...(counts.requests ? [{ value: "requests" as const, label: "Requests", count: counts.requests }] : []),
    ...workspaceRoleDetails
      .map((detail) => ({ value: detail.role, label: detail.label, count: counts.byRole[detail.role] ?? 0 }))
      .filter((filter) => filter.count > 0),
  ];
  const showTools = members.length >= toolsFrom;
  const summary = [
    `${members.length} ${members.length === 1 ? "member" : "members"}`,
    `${counts.activeWeek} active this week`,
    ...(counts.neverSignedIn ? [`${counts.neverSignedIn} never signed in`] : []),
  ].join(" · ");
  const inviteExpiry = (iso: string | null) => (iso ? `Expires ${new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : "No expiry");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <p className="min-w-0 flex-1 text-[13px] text-foreground-muted">{summary}</p>
        <RowMenu items={[{ label: "Export as CSV", onSelect: exportCsv, disabled: !shown.length }]} label="More team options" />
      </div>

      {canEdit && counts.requests ? (
        <section aria-labelledby="team-requests-title" className="members-request rounded-panel p-3">
          <h2 className="px-1 text-[13px] font-semibold text-foreground" id="team-requests-title">Waiting for approval <span className="font-mono text-[11px] text-foreground-subtle">{counts.requests}</span></h2>
          <ul className="mt-2 space-y-1">
            {members.filter((member) => member.requestedRole).map((member) => (
              <li className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-control px-1 py-1.5" key={member.id}>
                <Avatar name={member.name} size={28} src={member.image} />
                <p className="min-w-0 flex-1 text-[13px] text-foreground">
                  <span className="font-medium">{member.name}</span>
                  <span className="text-foreground-muted"> asked for designer access</span>
                  <span className="block truncate text-[11px] text-foreground-subtle">{member.email}</span>
                </p>
                <span className="flex gap-2">
                  <button className="h-8 rounded-control bg-primary px-3 text-[12px] font-semibold text-primary-foreground hover:bg-primary-hover disabled:opacity-50" disabled={busy === member.id} onClick={() => void send(member, { method: "PATCH", body: JSON.stringify({ role: "designer" }) }, `${member.name} is now a product designer.`)} type="button">Approve</button>
                  <button className="dial-button min-h-8 px-3 text-[12px]" disabled={busy === member.id} onClick={() => void send(member, { method: "PATCH", body: JSON.stringify({ request: "decline" }) }, `Declined ${member.name}'s request.`)} type="button">Decline</button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {showTools ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="team-search">Search members</label>
            <input
              className="h-9 min-w-[12rem] flex-1 rounded-control border border-transparent bg-surface-inset px-3 text-[13px] text-foreground outline-none placeholder:text-foreground-subtle focus-visible:border-foreground/30"
              id="team-search"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by name, email or job"
              type="search"
              value={query}
            />
            <label className="sr-only" htmlFor="team-sort">Sort members</label>
            <select className="h-9 rounded-control border border-transparent bg-surface-inset px-2.5 text-[13px] text-foreground outline-none" id="team-sort" onChange={(event) => setSort(event.target.value as SortKey)} value={sort}>
              <option value="name">Sort by name</option>
              <option value="active">Recently active</option>
              <option value="joined">Newest</option>
            </select>
          </div>
          {filters.length > 2 ? (
            <div aria-label="Filter by role" className="flex flex-wrap gap-1.5" role="group">
              {filters.map((filter) => (
                <button
                  aria-pressed={roleFilter === filter.value}
                  className={"flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12px] transition-colors " + (roleFilter === filter.value ? "bg-white/[0.12] text-foreground" : "bg-white/[0.04] text-foreground-muted hover:bg-white/[0.07] hover:text-foreground")}
                  key={filter.value}
                  onClick={() => setRoleFilter(filter.value)}
                  type="button"
                >
                  {filter.label}
                  <span className="font-mono text-[10px] text-foreground-subtle">{filter.count}</span>
                </button>
              ))}
            </div>
          ) : null}
        </>
      ) : null}

      <div className="hidden items-center gap-3 border-b border-border px-3 pb-2 text-[11px] font-medium text-foreground-subtle sm:flex">
        <span className="flex-1">Member</span>
        <span className="w-28 shrink-0">Last active</span>
        <span className="w-[13.5rem] shrink-0">Role</span>
      </div>

      <ul className="space-y-0.5">
        {shown.map((member) => {
          const isYou = member.id === currentUserId;
          const locked = !canEdit || isYou;
          const lastActive = formatLastActive(member.lastActiveAt, now);
          return (
            <li className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[10px] px-3 py-2.5 transition-colors hover:bg-white/[0.04]" key={member.id}>
              <Avatar name={member.name} size={32} src={member.image} />
              <span className="min-w-0 flex-1 basis-48">
                <span className="block truncate text-[13px] font-medium text-foreground">
                  {member.name}
                  {isYou ? <span className="ml-1.5 font-normal text-foreground-subtle">(you)</span> : null}
                  {member.requestedRole ? <span className="ml-1.5 rounded-full bg-warning/15 px-1.5 py-px text-[10px] font-medium text-warning">Requested designer</span> : null}
                </span>
                <a className="block truncate text-[12px] text-foreground-subtle hover:text-foreground" href={`mailto:${member.email}`}>
                  {profileSubtitle(member)}{member.title || member.department ? " · " : ""}{member.email}
                </a>
                <span className="mt-0.5 block text-[11px] text-foreground-subtle sm:hidden">{member.lastActiveAt ? `Active ${lastActive.toLowerCase()}` : lastActive}</span>
              </span>
              <span className="w-28 shrink-0 text-[12px] text-foreground-muted max-sm:hidden" title={`Joined ${new Date(member.joinedAt).toLocaleDateString()}`}>{lastActive}</span>
              <span className="flex w-[13.5rem] shrink-0 items-center gap-1 max-sm:ml-11 max-sm:w-auto">
                {locked ? (
                  <span className="flex-1 px-2.5 text-[13px] text-foreground-muted max-sm:px-0" title={`${roleLabel(member.role)} access`}>{memberRoleLabel(member.role, member.jobRole)}</span>
                ) : (
                  <>
                    <label className="sr-only" htmlFor={`team-role-${member.id}`}>Role for {member.name}</label>
                    <select
                      className="h-8 min-w-0 flex-1 rounded-control border border-transparent bg-surface-inset pl-2.5 pr-1.5 text-[13px] text-foreground outline-none hover:bg-surface-raised focus-visible:border-foreground/30 disabled:opacity-50 max-sm:h-9 max-sm:w-[160px] max-sm:flex-none"
                      disabled={busy === member.id}
                      id={`team-role-${member.id}`}
                      onChange={(event) => void changeRole(member, event.target.value as InviteRole)}
                      title={`${roleLabel(member.role)} access`}
                      value={memberRoleValue(member.role, member.jobRole)}
                    >
                      {memberRoleValue(member.role, member.jobRole) === "reviewer" ? <option disabled value="reviewer">Reviewer</option> : null}
                      {inviteRoles.map((role) => <option key={role} value={role}>{inviteRoleLabel(role)}</option>)}
                    </select>
                  </>
                )}
                {locked ? <span aria-hidden="true" className="size-8 shrink-0 max-sm:hidden" /> : (
                  <RowMenu items={[{ label: "Remove from team", onSelect: () => void remove(member), danger: true, disabled: busy === member.id }]} label={`Options for ${member.name}`} />
                )}
              </span>
            </li>
          );
        })}
        {!shown.length ? <li className="px-3 py-6 text-center text-[12px] text-foreground-subtle">No members match.</li> : null}
        {canEdit && roleFilter === "all" && !query ? invites.map((invite) => (
          <li className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[10px] px-3 py-2.5" key={invite.id}>
            <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full border border-dashed border-foreground-subtle/50 text-foreground-subtle">
              <svg className="size-3.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" viewBox="0 0 16 16"><path d="M6.5 9.5 9.5 6.5M7 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1M9 11.5l-1 1a2.5 2.5 0 0 1-3.5-3.5l1-1" /></svg>
            </span>
            <span className="min-w-0 flex-1 basis-48">
              <span className="block text-[13px] font-medium text-foreground-muted">Invite link</span>
              <span className="block truncate text-[12px] text-foreground-subtle">{inviteExpiry(invite.expiresAt)}</span>
            </span>
            <span className="w-28 shrink-0 text-[12px] text-foreground-subtle max-sm:hidden">Not joined</span>
            <span className="flex w-[13.5rem] shrink-0 items-center gap-1 max-sm:ml-11 max-sm:w-auto">
              <span className="flex-1 px-2.5 text-[13px] text-foreground-subtle max-sm:px-0">{jobLabel(invite.jobRole) ?? roleLabel(invite.role)}</span>
              <RowMenu items={[{ label: "Revoke link", onSelect: () => void revokeInvite(invite), danger: true, disabled: busy === invite.id }]} label="Options for invite link" />
            </span>
          </li>
        )) : null}
      </ul>
      {message ? <p aria-live="polite" className="text-[12px] leading-5 text-foreground-muted">{message}</p> : null}
      {dialog}
    </div>
  );
}

/** What each role can do, with how many people have it. */
export function RoleGuide({ counts }: { counts: Record<string, number> }) {
  return (
    <ul className="space-y-2">
      {workspaceRoleDetails.map((detail) => (
        <li className="rounded-[10px] bg-white/[0.03] px-3 py-2.5" key={detail.role}>
          <p className="flex items-center justify-between gap-2 text-[12px]">
            <span className="font-medium text-foreground">{detail.label}</span>
            <span className="font-mono text-[10px] text-foreground-subtle">{counts[detail.role] ?? 0}</span>
          </p>
          <p className="mt-0.5 text-[11px] text-foreground-muted">{detail.summary}</p>
          <ul className="mt-1.5 space-y-0.5 text-[11px] leading-4 text-foreground-subtle">
            {detail.can.map((item) => <li className="flex gap-1.5" key={item}><span aria-hidden="true">·</span>{item}</li>)}
          </ul>
        </li>
      ))}
    </ul>
  );
}
