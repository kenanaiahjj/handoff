"use client";

import { Avatar } from "@/src/components/Avatar";
import { profileSubtitle } from "@/src/lib/profile-fields";
import { useMemo, useState } from "react";
import { useConfirm } from "@/src/components/ConfirmDialog";
import type { Member } from "@/src/server/services/members";
import { jobRoles, workspaceRoleDetails } from "@/src/lib/team-roles";
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
export function TeamDirectory({
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
      return !needle || `${member.name} ${member.email} ${jobLabel(member.jobRole) ?? ""} ${member.title ?? ""} ${member.department ?? ""}`.toLowerCase().includes(needle);
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

  async function changeRole(member: Member, role: Member["role"]) {
    if (role === member.role) return;
    if (role === "owner") {
      const confirmed = await confirm({
        title: `Make ${member.name} an owner?`,
        description: "Owners can invite and remove people, change anyone's role, and add other owners.",
        confirmLabel: "Make owner",
      });
      if (!confirmed) return;
    }
    await send(member, { method: "PATCH", body: JSON.stringify({ role }) }, `${member.name} is now ${roleLabel(role).toLowerCase()}.`);
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
    const header = ["Name", "Email", "Role", "Job", "Joined", "Last active"];
    const rows = shown.map((member) => [
      member.name,
      member.email,
      roleLabel(member.role),
      jobLabel(member.jobRole) ?? "",
      member.joinedAt.slice(0, 10),
      member.lastActiveAt ? member.lastActiveAt.slice(0, 10) : "never",
    ]);
    const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = Object.assign(document.createElement("a"), { href: url, download: "team-members.csv" });
    link.click();
    URL.revokeObjectURL(url);
  }

  const filters: Array<{ value: RoleFilter; label: string; count: number }> = [
    { value: "all", label: "All", count: members.length },
    ...(counts.requests ? [{ value: "requests" as const, label: "Requests", count: counts.requests }] : []),
    ...workspaceRoleDetails.map((detail) => ({ value: detail.role, label: detail.label, count: counts.byRole[detail.role] ?? 0 })),
  ];

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["Members", members.length],
          ["Active this week", counts.activeWeek],
          ["Never signed in", counts.neverSignedIn],
          ["Waiting for approval", counts.requests],
        ].map(([label, value]) => (
          <div className="rounded-[10px] bg-white/[0.03] px-3 py-2.5" key={label}>
            <dt className="text-[11px] text-foreground-subtle">{label}</dt>
            <dd className="mt-0.5 font-mono text-[18px] tabular-nums text-foreground">{value}</dd>
          </div>
        ))}
      </dl>

      {canEdit && counts.requests ? (
        <ul aria-label="Designer access requests" className="space-y-1.5">
          {members.filter((member) => member.requestedRole).map((member) => (
            <li className="members-request flex flex-wrap items-center gap-x-3 gap-y-2 rounded-control px-3 py-2.5" key={member.id}>
              <p className="min-w-0 flex-1 text-[12px] text-foreground">
                <span className="font-medium">{member.name}</span>
                <span className="text-foreground-muted"> asked for designer access · {member.email}</span>
              </p>
              <span className="flex gap-1.5">
                <button className="h-7 rounded-[7px] bg-[#f4f4f4] px-2.5 text-[11px] font-medium text-[#161616] hover:bg-white disabled:opacity-50" disabled={busy === member.id} onClick={() => void send(member, { method: "PATCH", body: JSON.stringify({ role: "designer" }) }, `${member.name} is now a product designer.`)} type="button">Approve</button>
                <button className="dial-button min-h-7 px-2.5 text-[11px]" disabled={busy === member.id} onClick={() => void send(member, { method: "PATCH", body: JSON.stringify({ request: "decline" }) }, `Declined ${member.name}'s request.`)} type="button">Decline</button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="team-search">Search members</label>
        <input
          className="h-8 min-w-[12rem] flex-1 rounded-control border border-transparent bg-surface-inset px-2.5 text-[12px] text-foreground outline-none placeholder:text-foreground-subtle focus-visible:border-foreground/30"
          id="team-search"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name, email or job"
          type="search"
          value={query}
        />
        <label className="sr-only" htmlFor="team-sort">Sort members</label>
        <select className="h-8 rounded-control border border-transparent bg-surface-inset px-2 text-[12px] text-foreground outline-none" id="team-sort" onChange={(event) => setSort(event.target.value as SortKey)} value={sort}>
          <option value="name">Name</option>
          <option value="active">Recently active</option>
          <option value="joined">Newest</option>
        </select>
        <button className="dial-button min-h-8 px-2.5 text-[12px]" disabled={!shown.length} onClick={exportCsv} title="Download the members shown as a CSV file" type="button">Export CSV</button>
      </div>

      <div aria-label="Filter by role" className="flex flex-wrap gap-1.5" role="group">
        {filters.map((filter) => (
          <button
            aria-pressed={roleFilter === filter.value}
            className={"flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[11px] transition-colors " + (roleFilter === filter.value ? "bg-white/[0.12] text-foreground" : "bg-white/[0.04] text-foreground-muted hover:bg-white/[0.07] hover:text-foreground")}
            key={filter.value}
            onClick={() => setRoleFilter(filter.value)}
            type="button"
          >
            {filter.label}
            <span className="font-mono text-[10px] text-foreground-subtle">{filter.count}</span>
          </button>
        ))}
      </div>

      <ul className="space-y-0.5">
        {shown.map((member) => {
          const isYou = member.id === currentUserId;
          const locked = !canEdit || isYou;
          return (
            <li className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[10px] px-3 py-2.5 transition-colors hover:bg-white/[0.04]" key={member.id}>
              <Avatar name={member.name} size={32} src={member.image} />
              <span className="min-w-0 flex-1 basis-48">
                <span className="block truncate text-[13px] font-medium text-foreground">
                  {member.name}
                  {isYou ? <span className="ml-1.5 font-normal text-foreground-subtle">(you)</span> : null}
                  {member.requestedRole ? <span className="ml-1.5 rounded-full bg-warning/15 px-1.5 py-px text-[10px] font-medium text-warning">Requested designer</span> : null}
                </span>
                <a className="block truncate text-[11px] text-foreground-subtle hover:text-foreground" href={`mailto:${member.email}`}>
                  {profileSubtitle(member, member.jobRole ? jobLabel(member.jobRole) ?? "" : "")}{member.title || member.department || member.jobRole ? " · " : ""}{member.email}
                </a>
              </span>
              <span className="w-28 shrink-0 text-[11px] text-foreground-muted max-sm:order-last max-sm:w-auto" title={`Joined ${new Date(member.joinedAt).toLocaleDateString()}`}>
                {formatLastActive(member.lastActiveAt, now)}
              </span>
              {locked ? (
                <span className="w-32 shrink-0 text-right text-[11px] text-foreground-muted">{roleLabel(member.role)}</span>
              ) : (
                <span className="flex w-32 shrink-0 items-center justify-end gap-1">
                  <label className="sr-only" htmlFor={`team-role-${member.id}`}>Role for {member.name}</label>
                  <select
                    className="h-7 min-w-0 flex-1 rounded-[7px] border border-transparent bg-surface-inset px-1.5 text-[11px] text-foreground outline-none focus-visible:border-foreground/30 disabled:opacity-50"
                    disabled={busy === member.id}
                    id={`team-role-${member.id}`}
                    onChange={(event) => void changeRole(member, event.target.value as Member["role"])}
                    value={member.role}
                  >
                    {workspaceRoleDetails.map((detail) => <option key={detail.role} value={detail.role}>{detail.label}</option>)}
                  </select>
                  <button
                    aria-label={`Remove ${member.name}`}
                    className="grid size-7 shrink-0 place-items-center rounded-[7px] text-foreground-subtle hover:bg-danger/15 hover:text-danger disabled:opacity-50"
                    disabled={busy === member.id}
                    onClick={() => void remove(member)}
                    title="Remove from team"
                    type="button"
                  >
                    <svg aria-hidden="true" className="size-3.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" viewBox="0 0 16 16"><path d="m4.5 4.5 7 7m0-7-7 7" /></svg>
                  </button>
                </span>
              )}
            </li>
          );
        })}
        {!shown.length ? <li className="px-3 py-6 text-center text-[12px] text-foreground-subtle">No members match.</li> : null}
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
