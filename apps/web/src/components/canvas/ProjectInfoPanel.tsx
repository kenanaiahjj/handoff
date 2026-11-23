import { Avatar } from "@/src/components/Avatar";
import { projectRoleLabels } from "@/src/lib/project-roles";
import type { ProjectTeamMember } from "@/src/server/services/project-access";

/** The canvas Info tab: who works on this project, PD in charge first, so reviewers know who to ask. */
export function ProjectInfoPanel({ projectName, handoffName, team }: { projectName: string; handoffName: string; team: ProjectTeamMember[] }) {
  const pd = team.find((person) => person.isPdInCharge) ?? null;
  const rest = team.filter((person) => !person.isPdInCharge);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <dl className="space-y-2 px-1.5 pb-3">
        <div>
          <dt className="text-[11px] text-foreground-subtle">Project</dt>
          <dd className="truncate text-[12px] font-medium text-foreground">{projectName}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-foreground-subtle">Handoff</dt>
          <dd className="truncate text-[12px] font-medium text-foreground">{handoffName}</dd>
        </div>
      </dl>
      <section aria-labelledby="canvas-info-pd" className="border-t border-border pt-3">
        <h3 className="px-1.5 text-[11px] font-medium text-foreground-subtle" id="canvas-info-pd">PD in charge</h3>
        {pd ? <ul className="mt-1"><Person person={pd} /></ul> : <p className="mt-1 px-1.5 text-[12px] text-foreground-muted">No PD assigned yet.</p>}
      </section>
      <section aria-labelledby="canvas-info-team" className="mt-3 border-t border-border pt-3">
        <h3 className="flex items-baseline justify-between px-1.5 text-[11px] font-medium text-foreground-subtle" id="canvas-info-team">
          Team <span className="font-mono">{rest.length}</span>
        </h3>
        {rest.length ? (
          <ul className="mt-1 space-y-0.5">{rest.map((person) => <Person key={person.email} person={person} />)}</ul>
        ) : (
          <p className="mt-1 px-1.5 text-[12px] leading-5 text-foreground-muted">No one else on this project yet. A designer can add people from the project page.</p>
        )}
      </section>
    </div>
  );
}

function Person({ person }: { person: ProjectTeamMember }) {
  return (
    <li className="flex items-center gap-2.5 rounded-[8px] px-1.5 py-1.5">
      <Avatar name={person.name ?? person.email} size={28} src={person.image} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-medium text-foreground">{person.name ?? person.email}</span>
        <a className="block truncate text-[11px] text-foreground-subtle hover:text-foreground hover:underline" href={`mailto:${person.email}`}>{person.email}</a>
      </span>
      {person.isPdInCharge ? null : <span className="shrink-0 text-[11px] text-foreground-muted">{projectRoleLabels[person.role]}</span>}
    </li>
  );
}
