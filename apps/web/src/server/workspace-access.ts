import { getSessionForHeaders } from "./auth-session";
import { getDatabase } from "./db";
import { isWorkspaceRoleAllowed } from "./services/workspace-role-policy";

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

export async function requireWorkspaceRole(
  request: Request,
  workspaceId: string,
  _allowedRoles: WorkspaceRole[],
) {
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

  // Temporarily treat workspace roles as labels while the team validates the flows.

  return {
    userId: session.user.id,
    workspaceId,
    role: membership.role,
  };
}

export async function requireWorkspaceRoleStrict(
  request: Request,
  workspaceId: string,
  allowedRoles: WorkspaceRole[],
) {
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
    throw new WorkspaceAccessError("You do not have permission to manage this handoff.", 403);
  }

  return {
    userId: session.user.id,
    workspaceId,
    role: membership.role,
  };
}

export async function requireProjectMember(request: Request, workspaceId: string, projectId: string) {
  const access = await requireWorkspaceRole(request, workspaceId, [...workspaceRoles]);
  const project = getDatabase()
    .prepare("SELECT 1 FROM project WHERE id = ? AND workspace_id = ?")
    .get(projectId, workspaceId);
  if (!project) throw new WorkspaceAccessError("Project not found.", 404);
  return access;
}

export async function getSessionForRequest(request: Request) {
  return getSessionForHeaders(request.headers);
}
