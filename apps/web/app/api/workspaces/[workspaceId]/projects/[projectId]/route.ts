import { z } from "zod";
import { deleteProject, renameProject } from "@/src/server/repositories/projects";
import { objectStore } from "@/src/server/storage/supabase-object-store";
import { isUniqueConstraintViolation } from "@/src/server/db";
import { managerRoles, requireWorkspaceRole, WorkspaceAccessError } from "@/src/server/workspace-access";

type ProjectRoute = { params: Promise<{ workspaceId: string; projectId: string }> };

const renameSchema = z.object({ name: z.string().trim().min(1).max(80) });

function accessError(error: unknown) {
  if (error instanceof WorkspaceAccessError) return Response.json({ error: error.message }, { status: error.status });
  throw error;
}

/** Owners and designers rename a project. */
export async function PATCH(request: Request, context: ProjectRoute) {
  const { workspaceId, projectId } = await context.params;
  try {
    await requireWorkspaceRole(request, workspaceId, managerRoles);
    const parsed = renameSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "Enter a project name between 1 and 80 characters." }, { status: 400 });
    if (!(await renameProject({ workspaceId, projectId, name: parsed.data.name }))) {
      return Response.json({ error: "Project not found." }, { status: 404 });
    }
    return Response.json({ renamed: true, name: parsed.data.name });
  } catch (error) {
    if (isUniqueConstraintViolation(error)) return Response.json({ error: "A project with that name already exists." }, { status: 409 });
    return accessError(error);
  }
}

/** Owners and designers delete a project and every handoff in it (as they can each handoff). */
export async function DELETE(request: Request, context: ProjectRoute) {
  const { workspaceId, projectId } = await context.params;
  try {
    await requireWorkspaceRole(request, workspaceId, managerRoles);
    const deleted = await deleteProject({ workspaceId, projectId });
    if (!deleted) return Response.json({ error: "Project not found." }, { status: 404 });
    const cleanup = await Promise.allSettled([...new Set(deleted.unreferencedObjectKeys)].map((key) => objectStore.delete(key)));
    return Response.json({ deleted: true, handoffCount: deleted.handoffCount, cleanupPending: cleanup.filter((result) => result.status === "rejected").length });
  } catch (error) {
    return accessError(error);
  }
}
