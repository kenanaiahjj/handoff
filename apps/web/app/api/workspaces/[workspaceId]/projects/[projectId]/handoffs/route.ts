import { visibleHandoffIds } from "@/src/server/services/review-visibility";
import { getDatabase } from "@/src/server/db";
import { listHandoffs } from "@/src/server/repositories/handoffs";
import { requireProjectMember, WorkspaceAccessError } from "@/src/server/workspace-access";

type HandoffRoute = RouteContext<"/api/workspaces/[workspaceId]/projects/[projectId]/handoffs">;

export async function GET(request: Request, context: HandoffRoute) {
  const { workspaceId, projectId } = await context.params;
  try {
    const access = await requireProjectMember(request, workspaceId, projectId);
    const visible = (await visibleHandoffIds(workspaceId, { id: access.userId, email: access.email, role: access.role }));
    const handoffs = (await listHandoffs({ workspaceId, projectId })) as Array<{ id: string }>;
    return Response.json({ handoffs: visible ? handoffs.filter((handoff) => visible.has(handoff.id)) : handoffs });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

export async function POST(request: Request, context: HandoffRoute) {
  const { workspaceId, projectId } = await context.params;

  try {
    await requireProjectMember(request, workspaceId, projectId, { manage: true });
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
