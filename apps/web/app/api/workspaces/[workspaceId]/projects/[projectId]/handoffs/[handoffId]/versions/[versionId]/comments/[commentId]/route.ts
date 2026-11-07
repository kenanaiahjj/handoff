import { z } from "zod";
import { getHandoff } from "@/src/server/repositories/handoffs";
import { setCommentResolved } from "@/src/server/repositories/comments";
import { getVersion } from "@/src/server/repositories/versions";
import {
  requireWorkspaceRole,
  WorkspaceAccessError,
  workspaceRoles,
} from "@/src/server/workspace-access";

type CommentRoute = {
  params: Promise<{ workspaceId: string; projectId: string; handoffId: string; versionId: string; commentId: string }>;
};

const resolutionSchema = z.object({ resolved: z.boolean() });

export async function PATCH(request: Request, context: CommentRoute) {
  const { workspaceId, projectId, handoffId, versionId, commentId } = await context.params;
  try {
    const access = await requireWorkspaceRole(request, workspaceId, [...workspaceRoles]);
    const handoff = getHandoff({ workspaceId, projectId, handoffId });
    const version = getVersion({ workspaceId, versionId });
    if (!handoff || !version || version.handoffId !== handoffId) {
      return Response.json({ error: "Handoff version not found." }, { status: 404 });
    }
    let body: unknown;
    try { body = await request.json(); } catch { return Response.json({ error: "Choose an open or resolved status." }, { status: 400 }); }
    const parsed = resolutionSchema.safeParse(body);
    if (!parsed.success) return Response.json({ error: "Choose an open or resolved status." }, { status: 400 });

    const updated = setCommentResolved({
      workspaceId,
      versionId,
      commentId,
      resolved: parsed.data.resolved,
      updatedBy: access.userId,
    });
    if (!updated) return Response.json({ error: "Comment thread not found." }, { status: 404 });
    return Response.json({ resolved: parsed.data.resolved });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
