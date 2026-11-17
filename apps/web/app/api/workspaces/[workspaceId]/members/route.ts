import { listMembers } from "@/src/server/services/members";
import { managerRoles, requireWorkspaceRole, WorkspaceAccessError } from "@/src/server/workspace-access";

/** Team members, for owners and designers. */
export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  try {
    await requireWorkspaceRole(request, workspaceId, managerRoles);
    return Response.json({ members: (await listMembers(workspaceId)) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
