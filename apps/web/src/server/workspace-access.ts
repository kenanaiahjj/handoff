import { getSessionForHeaders } from "./auth-session";
import { getDatabase } from "./db";
import { isWorkspaceRoleAllowed } from "./services/workspace-role-policy";
import { visibleHandoffIds } from "./services/review-visibility";

export const workspaceRoles = [
  "owner",
  "designer",
  "reviewer",
  "developer",
  "qa",
] as const;

export type WorkspaceRole = (typeof workspaceRoles)[number];

export class WorkspaceAccessError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403 | 404,
  ) {
    super(message);
    this.name = "WorkspaceAccessError";
  }
}

/** Roles that manage a workspace's projects, handoffs, sharing, and captures. */
export const managerRoles = ["owner", "designer"] as const satisfies readonly WorkspaceRole[];

type WorkspaceAccess = { userId: string; workspaceId: string; role: WorkspaceRole; email: string };

/** Signed-in member of the workspace whose role is in `allowedRoles`; otherwise 401/404/403. */
export async function requireWorkspaceRole(
  request: Request,
  workspaceId: string,
  allowedRoles: readonly WorkspaceRole[],
): Promise<WorkspaceAccess> {
  const session = await getSessionForHeaders(request.headers);

  if (!session) {
    throw new WorkspaceAccessError("Sign in to continue.", 401);
  }

  const membership = getDatabase()
    .prepare(
      "SELECT role FROM workspace_membership WHERE workspace_id = ? AND user_id = ?",
    )
    .get(workspaceId, session.user.id) as { role: WorkspaceRole } | undefined;

  if (!membership) {
    throw new WorkspaceAccessError("Workspace not found.", 404);
  }

  if (!isWorkspaceRoleAllowed(membership.role, allowedRoles)) {
    throw new WorkspaceAccessError("Only owners and designers can do this.", 403);
  }

  return {
    userId: session.user.id,
    workspaceId,
    role: membership.role,
    email: session.user.email,
  };
}

/** @deprecated Same as requireWorkspaceRole, which now enforces roles. */
export const requireWorkspaceRoleStrict = requireWorkspaceRole;

/**
 * Access to one handoff. Owners and designers see every handoff; other roles only the ones shared
 * with them (an invite to their email, or a project they lead as PD). Hidden handoffs answer
 * "not found" so their existence isn't revealed. `manage: true` also requires an owner or designer.
 */
export async function requireHandoffAccess(
  request: Request,
  input: { workspaceId: string; handoffId: string; manage?: boolean },
) {
  const access = await requireWorkspaceRole(request, input.workspaceId, input.manage ? managerRoles : workspaceRoles);
  const visible = visibleHandoffIds(input.workspaceId, { id: access.userId, email: access.email, role: access.role });
  if (visible && !visible.has(input.handoffId)) throw new WorkspaceAccessError("Handoff not found.", 404);
  return access;
}

/** Project access: managers see every project; other roles only projects holding a handoff shared with them. */
export async function requireProjectMember(request: Request, workspaceId: string, projectId: string, options: { manage?: boolean } = {}) {
  const access = await requireWorkspaceRole(request, workspaceId, options.manage ? managerRoles : workspaceRoles);
  const project = getDatabase()
    .prepare("SELECT 1 FROM project WHERE id = ? AND workspace_id = ?")
    .get(projectId, workspaceId);
  if (!project) throw new WorkspaceAccessError("Project not found.", 404);
  const visible = visibleHandoffIds(workspaceId, { id: access.userId, email: access.email, role: access.role });
  if (visible) {
    const handoffIds = getDatabase()
      .prepare("SELECT id FROM handoff WHERE workspace_id = ? AND project_id = ?")
      .all(workspaceId, projectId) as Array<{ id: string }>;
    if (!handoffIds.some((handoff) => visible.has(handoff.id))) throw new WorkspaceAccessError("Project not found.", 404);
  }
  return access;
}

export async function getSessionForRequest(request: Request) {
  return getSessionForHeaders(request.headers);
}
