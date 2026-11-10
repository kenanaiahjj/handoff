import { revokeHandoffInvite } from "@/src/server/repositories/handoffs";
import { requireWorkspaceRoleStrict, WorkspaceAccessError } from "@/src/server/workspace-access";

type InviteRoute = { params: Promise<{ workspaceId: string; projectId: string; handoffId: string; inviteId: string }> };

export async function DELETE(request: Request, context: InviteRoute) {
  const { workspaceId, projectId, handoffId, inviteId } = await context.params;
  try {
    await requireWorkspaceRoleStrict(request, workspaceId, ["owner", "designer"]);
    const revoked = revokeHandoffInvite({ workspaceId, projectId, handoffId, inviteId });
    if (!revoked) return Response.json({ error: "Active invitation not found." }, { status: 404 });
    return Response.json({ revoked: true }, { status: 200 });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
