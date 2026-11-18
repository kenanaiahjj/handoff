import { z } from "zod";
import { deleteHandoff, handoffReviewStatuses, renameHandoff, setHandoffReviewStatus } from "@/src/server/repositories/handoffs";
import { objectStore } from "@/src/server/storage/supabase-object-store";
import { isUniqueConstraintViolation } from "@/src/server/db";
import { requireWorkspaceRoleStrict, WorkspaceAccessError } from "@/src/server/workspace-access";

type HandoffRoute = { params: Promise<{ workspaceId: string; projectId: string; handoffId: string }> };

const renameSchema = z.object({ name: z.string().trim().min(1).max(100) });
const statusSchema = z.object({ status: z.enum(handoffReviewStatuses) });

export async function PATCH(request: Request, context: HandoffRoute) {
  const { workspaceId, projectId, handoffId } = await context.params;

  try {
    const access = await requireWorkspaceRoleStrict(request, workspaceId, ["owner", "designer"]);
    const body = await request.json().catch(() => null);
    if (body && typeof body === "object" && "status" in body) {
      const status = statusSchema.safeParse(body);
      if (!status.success) return Response.json({ error: "Choose draft, in review or approved." }, { status: 400 });
      const updated = await setHandoffReviewStatus({ workspaceId, projectId, handoffId, status: status.data.status, userId: access.userId });
      if (!updated) return Response.json({ error: "Handoff not found." }, { status: 404 });
      return Response.json({ status: status.data.status }, { status: 200 });
    }
    const parsed = renameSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: "Enter a handoff name between 1 and 100 characters." }, { status: 400 });
    }

    const renamed = (await renameHandoff({ workspaceId, projectId, handoffId, name: parsed.data.name }));
    if (!renamed) return Response.json({ error: "Handoff not found." }, { status: 404 });
    return Response.json({ renamed: true, name: parsed.data.name }, { status: 200 });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    if (isUniqueConstraintViolation(error)) {
      return Response.json({ error: "A handoff with that name already exists in this project." }, { status: 409 });
    }
    throw error;
  }
}

export async function DELETE(request: Request, context: HandoffRoute) {
  const { workspaceId, projectId, handoffId } = await context.params;

  try {
    await requireWorkspaceRoleStrict(request, workspaceId, ["owner", "designer"]);
    const deleted = await deleteHandoff({ workspaceId, projectId, handoffId });
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
