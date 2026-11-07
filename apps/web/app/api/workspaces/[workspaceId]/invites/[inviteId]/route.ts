import { requireWorkspaceRole, WorkspaceAccessError } from "@/src/server/workspace-access";
import { getDatabase } from "@/src/server/db";

type InviteRoute = { params: Promise<{ workspaceId: string; inviteId: string }> };

export async function DELETE(
  request: Request,
  context: InviteRoute,
) {
  const { workspaceId, inviteId } = await context.params;

  try {
    const access = await requireWorkspaceRole(request, workspaceId, ["owner"]);
    const revokedAt = new Date().toISOString();
    const result = getDatabase()
      .prepare(
        `UPDATE workspace_invite SET revoked_at = ?
         WHERE id = ? AND workspace_id = ? AND revoked_at IS NULL
           AND (expires_at IS NULL OR expires_at > ?)`,
      )
      .run(revokedAt, inviteId, access.workspaceId, revokedAt);
    if (result.changes !== 1) return Response.json({ error: "Active invitation not found." }, { status: 404 });
    return Response.json({ revokedAt });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
