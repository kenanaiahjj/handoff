import { getDatabase } from "../db";
import { normalizeInviteEmail, type HandoffInviteRole } from "./handoff-sharing";

export class ProjectAccessError extends Error {}

export type ProjectAccessPerson = {
  email: string;
  name: string | null;
  image: string | null;
  userId: string | null;
  /** Workspace role when they're a member of the workspace; null for people who haven't joined. */
  workspaceRole: string | null;
};

export type ProjectAccess = {
  /** Owners and designers: they see every project. */
  fullAccess: Array<ProjectAccessPerson & { isPdInCharge: boolean }>;
  /** Added to the whole project: every handoff, including future ones. */
  members: Array<ProjectAccessPerson & { role: HandoffInviteRole; addedAt: string }>;
  /** Invited to some handoffs only (from a handoff's Access dialog). */
  handoffOnly: Array<ProjectAccessPerson & { handoffNames: string[] }>;
  handoffCount: number;
};

export async function listProjectAccess(workspaceId: string, projectId: string): Promise<ProjectAccess> {
  const database = getDatabase();
  const project = (await database
    .prepare("SELECT pd_in_charge_user_id AS pdInChargeUserId FROM project WHERE id = ? AND workspace_id = ?")
    .get(projectId, workspaceId)) as { pdInChargeUserId: string | null } | undefined;
  if (!project) throw new ProjectAccessError("Project not found.");

  const [fullAccess, members, invites, handoffCount] = await Promise.all([
    database
      .prepare(
        `SELECT "user".id AS userId, "user".email, "user".name, "user".image, workspace_membership.role AS workspaceRole
         FROM workspace_membership JOIN "user" ON "user".id = workspace_membership.user_id
         WHERE workspace_membership.workspace_id = ? AND workspace_membership.role IN ('owner', 'designer')
         ORDER BY lower("user".name) COLLATE "C"`,
      )
      .all(workspaceId) as Promise<ProjectAccessPerson[]>,
    database
      .prepare(
        `SELECT project_member.email, project_member.role, project_member.created_at AS addedAt,
                "user".id AS userId, "user".name, "user".image, workspace_membership.role AS workspaceRole
         FROM project_member
         LEFT JOIN "user" ON lower("user".email) = project_member.email
         LEFT JOIN workspace_membership ON workspace_membership.user_id = "user".id AND workspace_membership.workspace_id = project_member.workspace_id
         WHERE project_member.project_id = ? AND project_member.workspace_id = ?
         ORDER BY lower(COALESCE("user".name, project_member.email)) COLLATE "C"`,
      )
      .all(projectId, workspaceId) as Promise<Array<ProjectAccessPerson & { role: HandoffInviteRole; addedAt: string }>>,
    database
      .prepare(
        `SELECT handoff_invite.email, handoff.name AS handoffName,
                "user".id AS userId, "user".name, "user".image, workspace_membership.role AS workspaceRole
         FROM handoff_invite
         JOIN handoff ON handoff.id = handoff_invite.handoff_id AND handoff.workspace_id = handoff_invite.workspace_id
         LEFT JOIN "user" ON lower("user".email) = handoff_invite.email
         LEFT JOIN workspace_membership ON workspace_membership.user_id = "user".id AND workspace_membership.workspace_id = handoff.workspace_id
         WHERE handoff.project_id = ? AND handoff.workspace_id = ? AND handoff_invite.revoked_at IS NULL
           AND (handoff_invite.expires_at IS NULL OR handoff_invite.expires_at > ?)
         ORDER BY handoff.name`,
      )
      .all(projectId, workspaceId, new Date().toISOString()) as Promise<Array<ProjectAccessPerson & { handoffName: string }>>,
    database.prepare("SELECT COUNT(*)::integer AS total FROM handoff WHERE project_id = ? AND workspace_id = ?").get(projectId, workspaceId) as Promise<{ total: number }>,
  ]);

  const memberEmails = new Set(members.map((member) => member.email));
  const fullEmails = new Set(fullAccess.map((person) => person.email.toLowerCase()));
  const byEmail = new Map<string, ProjectAccessPerson & { handoffNames: string[] }>();
  for (const invite of invites) {
    if (memberEmails.has(invite.email) || fullEmails.has(invite.email)) continue;
    const entry = byEmail.get(invite.email) ?? { email: invite.email, name: invite.name, image: invite.image, userId: invite.userId, workspaceRole: invite.workspaceRole, handoffNames: [] };
    if (!entry.handoffNames.includes(invite.handoffName)) entry.handoffNames.push(invite.handoffName);
    byEmail.set(invite.email, entry);
  }

  return {
    fullAccess: fullAccess.map((person) => ({ ...person, isPdInCharge: person.userId === project.pdInChargeUserId })),
    members: members.filter((member) => !fullEmails.has(member.email)),
    handoffOnly: [...byEmail.values()],
    handoffCount: handoffCount.total,
  };
}

const roles = new Set<HandoffInviteRole>(["pd", "qa", "dev", "exec"]);

export async function addProjectMember(input: { workspaceId: string; projectId: string; email: string; role: HandoffInviteRole; addedBy: string }) {
  const email = normalizeInviteEmail(input.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ProjectAccessError("Enter a valid email address.");
  if (!roles.has(input.role)) throw new ProjectAccessError("Choose a role.");
  const database = getDatabase();
  const project = await database.prepare("SELECT 1 FROM project WHERE id = ? AND workspace_id = ?").get(input.projectId, input.workspaceId);
  if (!project) throw new ProjectAccessError("Project not found.");
  await database
    .prepare(
      `INSERT INTO project_member (project_id, workspace_id, email, role, added_by_user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (project_id, email) DO UPDATE SET role = excluded.role`,
    )
    .run(input.projectId, input.workspaceId, email, input.role, input.addedBy, new Date().toISOString());
  return { email };
}

/** Removes someone from the project, and by default also revokes their invites to its handoffs. */
export async function removeProjectMember(input: { workspaceId: string; projectId: string; email: string; revokeHandoffInvites?: boolean }) {
  const email = normalizeInviteEmail(input.email);
  const database = getDatabase();
  let removed = 0;
  let revoked = 0;
  await database.transaction(async () => {
    removed = (await database.prepare("DELETE FROM project_member WHERE project_id = ? AND workspace_id = ? AND email = ?").run(input.projectId, input.workspaceId, email)).changes;
    if (input.revokeHandoffInvites !== false) {
      revoked = (await database
        .prepare(
          `UPDATE handoff_invite SET revoked_at = ?
           WHERE workspace_id = ? AND email = ? AND revoked_at IS NULL
             AND handoff_id IN (SELECT id FROM handoff WHERE project_id = ? AND workspace_id = ?)`,
        )
        .run(new Date().toISOString(), input.workspaceId, email, input.projectId, input.workspaceId)).changes;
    }
  })();
  return { removed, revoked };
}
