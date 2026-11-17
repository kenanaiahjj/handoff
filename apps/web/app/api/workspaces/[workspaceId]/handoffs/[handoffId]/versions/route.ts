import { getDatabase } from "@/src/server/db";
import { requireProjectMember, WorkspaceAccessError } from "@/src/server/workspace-access";

type VersionRoute = RouteContext<"/api/workspaces/[workspaceId]/handoffs/[handoffId]/versions">;

export async function POST(request: Request, context: VersionRoute) {
  const { workspaceId, handoffId } = await context.params;

  try {
    const handoff = (await getDatabase()
      .prepare(
        `SELECT project_id AS projectId
         FROM handoff WHERE id = ? AND workspace_id = ?`,
      )
      .get(handoffId, workspaceId)) as { projectId: string } | undefined;
    if (!handoff) return Response.json({ error: "Handoff not found." }, { status: 404 });
    await requireProjectMember(request, workspaceId, handoff.projectId, { manage: true });
    return Response.json(
      { error: "Package uploads now use /api/uploads/packages and its finalize route." },
      { status: 410 },
    );
  } catch (error) {
    if (error instanceof WorkspaceAccessError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
