"use client";

import { type FormEvent, useState } from "react";
import { Avatar } from "@/src/components/Avatar";
import { useConfirm } from "@/src/components/ConfirmDialog";
import type { ProjectAccess } from "@/src/server/services/project-access";
import { projectRoleLabels as roleLabels, projectRoles, type ProjectRole as Role } from "@/src/lib/project-roles";

type Suggestion = { email: string; name: string };

/**
 * The project team, and who else can see the project: the team with their roles (designers,
 * developers, QA, reviewers; editable here), people invited to single handoffs, and the owners and
 * designers who see everything anyway.
 */
export function ProjectAccessPanel({ workspaceId, projectId, initial, suggestions }: {
  workspaceId: string;
  projectId: string;
  initial: ProjectAccess;
  /** Workspace members, offered while typing an email. */
  suggestions: Suggestion[];
}) {
  const [access, setAccess] = useState(initial);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("exec");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [showFull, setShowFull] = useState(false);
  const { confirm, dialog } = useConfirm();
  const endpoint = `/api/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/members`;

  async function send(key: string, init: RequestInit, url = endpoint) {
    setBusy(key);
    setError("");
    try {
      const response = await fetch(url, init);
      const payload = (await response.json().catch(() => ({}))) as ProjectAccess & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not update access.");
      setAccess(payload);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update access.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    if (await send("add", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, role }) })) setEmail("");
  }

  async function changeRole(person: { email: string }, next: Role) {
    await send(person.email, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: person.email, role: next }) });
  }

  async function remove(person: { email: string; name: string | null }, fromHandoffs: boolean) {
    const confirmed = await confirm({
      title: `Remove ${person.name ?? person.email} from the team?`,
      description: fromHandoffs
        ? "They lose access to every handoff in this project they were invited to."
        : "They lose access to this project's handoffs, including any they were invited to one by one.",
      confirmLabel: "Remove access",
    });
    if (confirmed) await send(person.email, { method: "DELETE" }, `${endpoint}?email=${encodeURIComponent(person.email)}`);
  }

  const taken = new Set(access.members.map((person) => person.email.toLowerCase()));
  const available = suggestions.filter((suggestion) => !taken.has(suggestion.email.toLowerCase()));
  const total = access.fullAccess.length + access.members.length + access.handoffOnly.length;

  return (
    <section aria-labelledby="project-access-title" className="workspace-pane p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-[-0.02em] text-foreground" id="project-access-title">Project team</h2>
        <span className="font-mono text-[11px] text-foreground-subtle">{total}</span>
      </div>
      <p className="mt-1.5 text-[13px] leading-5 text-foreground-muted">Everyone who opens this project sees the team. People you add also get every handoff in it.</p>

      <form className="mt-4 flex flex-wrap gap-1.5" onSubmit={add}>
        <label className="sr-only" htmlFor={`project-access-email-${projectId}`}>Email</label>
        <input
          className="h-9 min-w-0 flex-1 basis-40 rounded-control bg-surface-inset px-3 text-[13px] text-foreground outline-none placeholder:text-foreground-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          id={`project-access-email-${projectId}`}
          list={`project-access-people-${projectId}`}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="name@company.com"
          type="email"
          value={email}
        />
        <datalist id={`project-access-people-${projectId}`}>
          {available.map((person) => <option key={person.email} label={person.name} value={person.email} />)}
        </datalist>
        <label className="sr-only" htmlFor={`project-access-role-${projectId}`}>Role</label>
        <select className="h-9 rounded-control bg-surface-inset px-2 text-[12px] text-foreground outline-none" id={`project-access-role-${projectId}`} onChange={(event) => setRole(event.target.value as Role)} value={role}>
          {projectRoles.map((key) => <option key={key} value={key}>{roleLabels[key]}</option>)}
        </select>
        <button className="h-9 rounded-control bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50" disabled={!email.trim() || busy === "add"} type="submit">
          {busy === "add" ? "Adding…" : "Add"}
        </button>
      </form>
      {error ? <p className="mt-2 text-[12px] text-danger" role="alert">{error}</p> : null}

      <ul className="mt-4 space-y-0.5">
        {!access.members.length ? (
          <li className="px-1.5 py-2 text-[12px] text-foreground-subtle">No one on the team yet.</li>
        ) : null}
        {access.members.map((person) => (
          <li className="group flex items-center gap-2.5 rounded-[8px] px-1.5 py-1.5 hover:bg-white/[0.03]" key={person.email}>
            <Avatar name={person.name ?? person.email} size={26} src={person.image} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] font-medium text-foreground">{person.name ?? person.email}</span>
              <span className="block truncate text-[11px] text-foreground-subtle">
                {person.name ? person.email : null}{person.workspaceRole ? "" : `${person.name ? " · " : ""}hasn't joined yet`}
              </span>
            </span>
            <label className="sr-only" htmlFor={`project-team-role-${person.email}`}>Role for {person.name ?? person.email}</label>
            <select
              className="h-7 shrink-0 rounded-control bg-transparent px-1.5 text-[11px] text-foreground-muted outline-none hover:bg-white/[0.07] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
              disabled={busy === person.email}
              id={`project-team-role-${person.email}`}
              onChange={(event) => void changeRole(person, event.target.value as Role)}
              value={person.role}
            >
              {projectRoles.map((key) => <option key={key} value={key}>{roleLabels[key]}</option>)}
            </select>
            <button aria-label={`Remove ${person.name ?? person.email}`} className="grid size-7 shrink-0 place-items-center rounded-control text-foreground-subtle opacity-60 hover:bg-white/[0.07] hover:text-danger group-hover:opacity-100 disabled:opacity-30" disabled={busy === person.email} onClick={() => void remove(person, false)} type="button">
              <svg aria-hidden="true" className="size-3.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" viewBox="0 0 16 16"><path d="m4 4 8 8M12 4l-8 8" /></svg>
            </button>
          </li>
        ))}
        {access.handoffOnly.length ? (
          <li className="px-1.5 pb-1 pt-3 text-[11px] font-medium text-foreground-subtle">Invited to single handoffs</li>
        ) : null}
        {access.handoffOnly.map((person) => (
          <li className="group flex items-center gap-2.5 rounded-[8px] px-1.5 py-1.5 hover:bg-white/[0.03]" key={person.email}>
            <Avatar name={person.name ?? person.email} size={26} src={person.image} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] font-medium text-foreground">{person.name ?? person.email}</span>
              <span className="block truncate text-[11px] text-foreground-subtle" title={person.handoffNames.join(", ")}>
                {person.handoffNames.length === 1 ? person.handoffNames[0] : `${person.handoffNames.length} of ${access.handoffCount} handoffs`} only
              </span>
            </span>
            <button className="h-7 shrink-0 rounded-control px-2 text-[11px] text-foreground-subtle opacity-0 hover:bg-white/[0.07] hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100" disabled={busy !== null} onClick={() => void send("add", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: person.email, role: "exec" }) })} title="Add to the team as a reviewer, with every handoff in this project" type="button">
              Add to team
            </button>
            <button aria-label={`Remove ${person.name ?? person.email}`} className="grid size-7 shrink-0 place-items-center rounded-control text-foreground-subtle opacity-60 hover:bg-white/[0.07] hover:text-danger group-hover:opacity-100 disabled:opacity-30" disabled={busy === person.email} onClick={() => void remove(person, true)} type="button">
              <svg aria-hidden="true" className="size-3.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" viewBox="0 0 16 16"><path d="m4 4 8 8M12 4l-8 8" /></svg>
            </button>
          </li>
        ))}

      </ul>

      <button
        aria-expanded={showFull}
        className="mt-3 flex w-full items-center justify-between rounded-[8px] px-1.5 py-1.5 text-left text-[12px] text-foreground-muted hover:bg-white/[0.03]"
        onClick={() => setShowFull((value) => !value)}
        type="button"
      >
        <span className="flex items-center gap-2">
          <span className="flex -space-x-1.5">
            {access.fullAccess.slice(0, 4).map((person) => <Avatar className="ring-2 ring-surface" key={person.email} name={person.name ?? person.email} size={20} src={person.image} />)}
          </span>
          {access.fullAccess.length} more owner{access.fullAccess.length === 1 ? "" : "s"} and designer{access.fullAccess.length === 1 ? "" : "s"} see everything
        </span>
        <svg aria-hidden="true" className={"size-3.5 transition-transform " + (showFull ? "rotate-180" : "")} fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" viewBox="0 0 16 16"><path d="m4 6 4 4 4-4" /></svg>
      </button>
      {showFull ? (
        <ul className="mt-1 space-y-0.5">
          {access.fullAccess.map((person) => (
            <li className="flex items-center gap-2.5 px-1.5 py-1" key={person.email}>
              <Avatar name={person.name ?? person.email} size={22} src={person.image} />
              <span className="min-w-0 flex-1 truncate text-[12px] text-foreground">{person.name ?? person.email}</span>
              <span className="shrink-0 text-[11px] capitalize text-foreground-subtle">{person.isPdInCharge ? "PD in charge" : person.workspaceRole}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {dialog}
    </section>
  );
}
