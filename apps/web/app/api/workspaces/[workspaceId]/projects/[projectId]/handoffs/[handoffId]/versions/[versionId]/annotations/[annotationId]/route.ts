import { z } from "zod";
import { deleteHandoffAnnotation, updateHandoffAnnotation } from "@/src/server/repositories/annotations";
import { getVersion } from "@/src/server/repositories/versions";
import { requireProjectMember, WorkspaceAccessError } from "@/src/server/workspace-access";

type AnnotationRoute = RouteContext<"/api/workspaces/[workspaceId]/projects/[projectId]/handoffs/[handoffId]/versions/[versionId]/annotations/[annotationId]">;

const updateSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(2000),
});

export async function PATCH(request: Request, context: AnnotationRoute) {
  const { workspaceId, projectId, handoffId, versionId, annotationId } = await context.params;
  try {
    await requireProjectMember(request, workspaceId, projectId);
    const version = getVersion({ workspaceId, versionId });
    if (!version || version.handoffId !== handoffId) return Response.json({ error: "Handoff version not found." }, { status: 404 });
    const parsed = updateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "Enter a title and note." }, { status: 400 });
    if (!updateHandoffAnnotation({ workspaceId, versionId, annotationId, ...parsed.data })) {
      return Response.json({ error: "Canvas note not found." }, { status: 404 });
    }
    return Response.json({ updated: true });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

export async function DELETE(request: Request, context: AnnotationRoute) {
  const { workspaceId, projectId, handoffId, versionId, annotationId } = await context.params;
  try {
    await requireProjectMember(request, workspaceId, projectId);
    const version = getVersion({ workspaceId, versionId });
    if (!version || version.handoffId !== handoffId) return Response.json({ error: "Handoff version not found." }, { status: 404 });
    if (!deleteHandoffAnnotation({ workspaceId, versionId, annotationId })) {
      return Response.json({ error: "Canvas note not found." }, { status: 404 });
    }
    return Response.json({ deleted: true });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
