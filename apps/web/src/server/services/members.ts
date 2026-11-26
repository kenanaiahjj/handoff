import { getDatabase } from "../db";
import type { WorkspaceRole } from "../workspace-access";
import { removeSuperadmin } from "./superadmins";
import { jobRoleForAccessChange, workspaceRoleForInvite, type InviteRole } from "@/src/lib/team-roles";

export class MemberChangeError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 409) {
    super(message);
    this.name = "MemberChangeError";
  }
}

export type Member = {
  id: string;
  name: string;
  email: string;
  role: WorkspaceRole;
  jobRole: string | null;
  requestedRole: "designer" | null;
  joinedAt: string;
  image: string | null;
  title: string | null;
  department: string | null;
  /** Last time they used the app (their most recent session), or null if they never signed in. */
  lastActiveAt: string | null;
};

export async function listMembers(workspaceId: string): Promise<Member[]> {
  const rows = (await getDatabase()
    .prepare(
      `SELECT "user".id, "user".name, "user".email, "user".image, workspace_membership.role,
              user_about.title, user_about.department,
              user_profile.job_role AS jobRole, user_profile.requested_role AS requestedRole,
              workspace_membership.created_at AS joinedAt,
              GREATEST(
                (SELECT MAX(session."updatedAt") FROM session WHERE session."userId" = "user".id),
                (SELECT user_presence.last_seen_at FROM user_presence WHERE user_presence.user_id = "user".id)
              ) AS lastActiveAt
       FROM workspace_membership
       JOIN "user" ON "user".id = workspace_membership.user_id
       LEFT JOIN user_profile ON user_profile.user_id = workspace_membership.user_id
       LEFT JOIN user_about ON user_about.user_id = workspace_membership.user_id
       WHERE workspace_membership.workspace_id = ?
       ORDER BY user_profile.requested_role IS NULL, lower("user".name) COLLATE "C"`,
    )
    .all(workspaceId)) as Array<Omit<Member, "lastActiveAt"> & { lastActiveAt: string | Date | null }>;
  return rows.map((row) => ({
    ...row,
    lastActiveAt: row.lastActiveAt instanceof Date ? row.lastActiveAt.toISOString() : row.lastActiveAt ? new Date(row.lastActiveAt).toISOString() : null,
  }));
}

/** The person being changed: a member of the team other than the actor. */
async function editableMember(workspaceId: string, actorId: string, userId: string) {
  if (userId === actorId) throw new MemberChangeError("You can't change your own access. Ask another owner.", 400);
  const member = (await getDatabase()
    .prepare(
      `SELECT workspace_membership.role, "user".email FROM workspace_membership
       JOIN "user" ON "user".id = workspace_membership.user_id
       WHERE workspace_membership.workspace_id = ? AND workspace_membership.user_id = ?`,
    )
    .get(workspaceId, userId)) as { role: WorkspaceRole; email: string } | undefined;
  if (!member) throw new MemberChangeError("That person isn't on the team.", 404);
  return member;
}

async function ownerCount(workspaceId: string) {
  return ((await getDatabase().prepare("SELECT COUNT(*) AS total FROM workspace_membership WHERE workspace_id = ? AND role = 'owner'").get(workspaceId)) as { total: number }).total;
}

/** Serializes membership changes in one workspace, as SQLite's single writer did, so two owners can't demote each other at once. */
async function lockWorkspace(workspaceId: string) {
  (await getDatabase().prepare("SELECT id FROM workspace WHERE id = ? FOR UPDATE").get(workspaceId));
}

/**
 * Changes someone's role. Pass `jobRole` (what they do: Marketing, QA, Owner…) and their access follows
 * from it, or `role` to set access directly. Either way the job role is kept in step, so the team
 * only ever sees one role for a person.
 */
export async function changeMemberRole(input: { workspaceId: string; actorId: string; userId: string } & ({ role: WorkspaceRole } | { jobRole: InviteRole })) {
  const database = getDatabase();
  const role = "jobRole" in input ? (workspaceRoleForInvite(input.jobRole) as WorkspaceRole) : input.role;
  await database.transaction(async () => {
    await lockWorkspace(input.workspaceId);
    const member = (await editableMember(input.workspaceId, input.actorId, input.userId));
    if (member.role === "owner" && role !== "owner" && (await ownerCount(input.workspaceId)) <= 1) {
      throw new MemberChangeError("The team needs at least one owner.", 409);
    }
    (await database
      .prepare("UPDATE workspace_membership SET role = ? WHERE workspace_id = ? AND user_id = ?")
      .run(role, input.workspaceId, input.userId));
    const current = (await database.prepare("SELECT job_role AS jobRole FROM user_profile WHERE user_id = ?").get(input.userId)) as { jobRole: string | null } | undefined;
    const job = "jobRole" in input ? (input.jobRole === "owner" ? null : input.jobRole) : jobRoleForAccessChange(role, current?.jobRole ?? null);
    if (job && job !== current?.jobRole) {
      (await database
        .prepare(
          `INSERT INTO user_profile (user_id, job_role, onboarded_at) VALUES (?, ?, ?)
           ON CONFLICT (user_id) DO UPDATE SET job_role = excluded.job_role`,
        )
        .run(input.userId, job, new Date().toISOString()));
    }
    // Someone added as an owner by email is re-made owner on each visit; stop that once demoted.
    if (role !== "owner") (await removeSuperadmin(member.email));
    // Any role decision answers a pending designer request.
    (await database.prepare("UPDATE user_profile SET requested_role = NULL WHERE user_id = ?").run(input.userId));
  })();
}

export async function declineDesignerRequest(input: { workspaceId: string; actorId: string; userId: string }) {
  (await editableMember(input.workspaceId, input.actorId, input.userId));
  (await getDatabase().prepare("UPDATE user_profile SET requested_role = NULL WHERE user_id = ?").run(input.userId));
}

/**
 * Removes someone from the team. Their handoff shares are revoked (so notifications stop too), they
 * stop leading projects, and their pins and open mentions are cleared. Signing in again shows
 * "You don't have access yet" until they're invited back.
 */
export async function removeMember(input: { workspaceId: string; actorId: string; userId: string }) {
  const database = getDatabase();
  const now = new Date().toISOString();
  await database.transaction(async () => {
    await lockWorkspace(input.workspaceId);
    const member = (await editableMember(input.workspaceId, input.actorId, input.userId));
    if (member.role === "owner" && (await ownerCount(input.workspaceId)) <= 1) throw new MemberChangeError("The team needs at least one owner.", 409);
    (await database.prepare("DELETE FROM workspace_membership WHERE workspace_id = ? AND user_id = ?").run(input.workspaceId, input.userId));
    (await removeSuperadmin(member.email));
    (await database
      .prepare("UPDATE handoff_invite SET revoked_at = ? WHERE workspace_id = ? AND lower(email) = lower(?) AND revoked_at IS NULL")
      .run(now, input.workspaceId, member.email));
    (await database.prepare("UPDATE project SET pd_in_charge_user_id = NULL WHERE workspace_id = ? AND pd_in_charge_user_id = ?").run(input.workspaceId, input.userId));
    (await database.prepare("DELETE FROM viewer_pin WHERE user_id = ?").run(input.userId));
    (await database.prepare("UPDATE comment_mention SET done_at = ? WHERE user_id = ? AND workspace_id = ? AND done_at IS NULL").run(now, input.userId, input.workspaceId));
    (await database.prepare("UPDATE user_profile SET requested_role = NULL WHERE user_id = ?").run(input.userId));
  })();
}

/** Whether this person asked for designer access and is waiting for an owner. */
export async function hasPendingDesignerRequest(userId: string) {
  const row = (await getDatabase().prepare("SELECT requested_role AS requestedRole FROM user_profile WHERE user_id = ?").get(userId)) as { requestedRole: string | null } | undefined;
  return row?.requestedRole === "designer";
}
