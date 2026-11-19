import { Avatar } from "@/src/components/Avatar";
import { projectRoleLabels } from "@/src/lib/project-roles";
import type { ProjectTeamMember } from "@/src/server/services/project-access";

/** Read-only project team, so reviewers, developers and QA know who to ask about what. */
export function ProjectTeamCard({ team }: { team: ProjectTeamMember[] }) {
  return (
    <section aria-labelledby="project-team-title" className="workspace-pane p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-[-0.02em] text-foreground" id="project-team-title">Project team</h2>
        <span className="font-mono text-[11px] text-foreground-subtle">{team.length}</span>
      </div>
      {team.length ? (
        <ul className="mt-3 space-y-0.5">
          {team.map((person) => (
            <li className="flex items-center gap-2.5 rounded-[8px] px-1.5 py-1.5" key={person.email}>
              <Avatar name={person.name ?? person.email} size={28} src={person.image} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-medium text-foreground">{person.name ?? person.email}</span>
                <a className="block truncate text-[11px] text-foreground-subtle hover:text-foreground hover:underline" href={`mailto:${person.email}`}>{person.email}</a>
              </span>
              <span className="shrink-0 text-[11px] text-foreground-muted">{person.isPdInCharge ? "PD in charge" : projectRoleLabels[person.role]}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-[13px] leading-5 text-foreground-muted">No team listed yet. A designer can add people to this project.</p>
      )}
    </section>
  );
}
