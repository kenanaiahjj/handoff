import { deleteHandoff } from "@/src/server/repositories/handoffs";
import { objectStore } from "@/src/server/storage/local-object-store";
import { requireWorkspaceRoleStrict, WorkspaceAccessError } from "@/src/server/workspace-access";

type HandoffRoute = { params: Promise<{ workspaceId: string; projectId: string; handoffId: string }> };

export async function DELETE(request: Request, context: HandoffRoute) {
  const { workspaceId, projectId, handoffId } = await context.params;

  try {
    await requireWorkspaceRoleStrict(request, workspaceId, ["owner", "designer"]);
    const deleted = deleteHandoff({ workspaceId, projectId, handoffId });
    if (!deleted) return Response.json({ error: "Handoff not found." }, { status: 404 });

    const cleanup = await Promise.allSettled(deleted.unreferencedObjectKeys.map((key) => objectStore.delete(key)));
    const cleanupPending = cleanup.filter((result) => result.status === "rejected").length;
    return Response.json({ deleted: true, cleanupPending }, { status: 200 });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
