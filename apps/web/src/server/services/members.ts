import { getDatabase } from "../db";
import type { WorkspaceRole } from "../workspace-access";
import { isSuperadmin } from "./superadmins";

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
  isAdmin: boolean;
  joinedAt: string;
};

export function listMembers(workspaceId: string): Member[] {
  const rows = getDatabase()
    .prepare(
      `SELECT "user".id, "user".name, "user".email, workspace_membership.role,
              user_profile.job_role AS jobRole, user_profile.requested_role AS requestedRole,
              workspace_membership.created_at AS joinedAt
       FROM workspace_membership
       JOIN "user" ON "user".id = workspace_membership.user_id
       LEFT JOIN user_profile ON user_profile.user_id = workspace_membership.user_id
       WHERE workspace_membership.workspace_id = ?
       ORDER BY user_profile.requested_role IS NULL, "user".name COLLATE NOCASE`,
    )
    .all(workspaceId) as Array<Omit<Member, "isAdmin">>;
  return rows.map((row) => ({ ...row, isAdmin: isSuperadmin(row.email) }));
}

/** The person being changed: a member, not the actor, not an admin (admins are managed under Admins). */
function editableMember(workspaceId: string, actorId: string, userId: string) {
  if (userId === actorId) throw new MemberChangeError("You can't change your own access. Ask another owner.", 400);
  const member = getDatabase()
    .prepare(
      `SELECT workspace_membership.role, "user".email FROM workspace_membership
       JOIN "user" ON "user".id = workspace_membership.user_id
       WHERE workspace_membership.workspace_id = ? AND workspace_membership.user_id = ?`,
    )
    .get(workspaceId, userId) as { role: WorkspaceRole; email: string } | undefined;
  if (!member) throw new MemberChangeError("That person isn't on the team.", 404);
  if (isSuperadmin(member.email)) throw new MemberChangeError("Admins are always owners. Remove them from Admins first.", 409);
  return member;
}

function ownerCount(workspaceId: string) {
  return (getDatabase().prepare("SELECT COUNT(*) AS total FROM workspace_membership WHERE workspace_id = ? AND role = 'owner'").get(workspaceId) as { total: number }).total;
}

export function changeMemberRole(input: { workspaceId: string; actorId: string; userId: string; role: WorkspaceRole }) {
  const member = editableMember(input.workspaceId, input.actorId, input.userId);
  if (member.role === "owner" && input.role !== "owner" && ownerCount(input.workspaceId) <= 1) {
    throw new MemberChangeError("The team needs at least one owner.", 409);
  }
  const database = getDatabase();
  database.transaction(() => {
    database
      .prepare("UPDATE workspace_membership SET role = ? WHERE workspace_id = ? AND user_id = ?")
      .run(input.role, input.workspaceId, input.userId);
    // Any role decision answers a pending designer request.
    database.prepare("UPDATE user_profile SET requested_role = NULL WHERE user_id = ?").run(input.userId);
  })();
}

export function declineDesignerRequest(input: { workspaceId: string; actorId: string; userId: string }) {
  editableMember(input.workspaceId, input.actorId, input.userId);
  getDatabase().prepare("UPDATE user_profile SET requested_role = NULL WHERE user_id = ?").run(input.userId);
}

/**
 * Removes someone from the team. Their handoff shares are revoked (so notifications stop too), they
 * stop leading projects, and their pins and open mentions are cleared. Signing in again shows
 * "You don't have access yet" until they're invited back.
 */
export function removeMember(input: { workspaceId: string; actorId: string; userId: string }) {
  const member = editableMember(input.workspaceId, input.actorId, input.userId);
  if (member.role === "owner" && ownerCount(input.workspaceId) <= 1) throw new MemberChangeError("The team needs at least one owner.", 409);
  const database = getDatabase();
  const now = new Date().toISOString();
  database.transaction(() => {
    database.prepare("DELETE FROM workspace_membership WHERE workspace_id = ? AND user_id = ?").run(input.workspaceId, input.userId);
    database
      .prepare("UPDATE handoff_invite SET revoked_at = ? WHERE workspace_id = ? AND lower(email) = lower(?) AND revoked_at IS NULL")
      .run(now, input.workspaceId, member.email);
    database.prepare("UPDATE project SET pd_in_charge_user_id = NULL WHERE workspace_id = ? AND pd_in_charge_user_id = ?").run(input.workspaceId, input.userId);
    database.prepare("DELETE FROM viewer_pin WHERE user_id = ?").run(input.userId);
    database.prepare("UPDATE comment_mention SET done_at = ? WHERE user_id = ? AND workspace_id = ? AND done_at IS NULL").run(now, input.userId, input.workspaceId);
    database.prepare("UPDATE user_profile SET requested_role = NULL WHERE user_id = ?").run(input.userId);
  })();
}

/** Whether this person asked for designer access and is waiting for an owner. */
export function hasPendingDesignerRequest(userId: string) {
  const row = getDatabase().prepare("SELECT requested_role AS requestedRole FROM user_profile WHERE user_id = ?").get(userId) as { requestedRole: string | null } | undefined;
  return row?.requestedRole === "designer";
}
