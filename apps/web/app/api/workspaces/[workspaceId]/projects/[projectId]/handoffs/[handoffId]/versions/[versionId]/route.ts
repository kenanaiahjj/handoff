import { deleteHandoffVersion } from "@/src/server/repositories/versions";
import { objectStore } from "@/src/server/storage/local-object-store";
import { requireWorkspaceRoleStrict, WorkspaceAccessError } from "@/src/server/workspace-access";

type VersionRoute = { params: Promise<{ workspaceId: string; projectId: string; handoffId: string; versionId: string }> };

export async function DELETE(request: Request, context: VersionRoute) {
  const { workspaceId, projectId, handoffId, versionId } = await context.params;

  try {
    await requireWorkspaceRoleStrict(request, workspaceId, ["owner", "designer"]);
    const deleted = deleteHandoffVersion({ workspaceId, projectId, handoffId, versionId });
    if (!deleted) return Response.json({ error: "Handoff version not found." }, { status: 404 });

    const cleanup = await Promise.allSettled(deleted.unreferencedObjectKeys.map((key) => objectStore.delete(key)));
    const cleanupPending = cleanup.filter((result) => result.status === "rejected").length;
    return Response.json({ ...deleted, cleanupPending }, { status: 200 });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
