import { z } from "zod";
import { deleteHandoffAnnotation, updateHandoffAnnotation } from "@/src/server/repositories/annotations";
import { getVisiblePublishedReviewVersion, resolvePublishedReviewAccess } from "@/src/server/services/handoff-review-access";

type ReviewAnnotationRoute = { params: Promise<{ shareId: string; versionId: string; annotationId: string }> };
const updateSchema = z.object({ title: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(2000) });

async function load(request: Request, context: ReviewAnnotationRoute) {
  const params = await context.params;
  const access = await resolvePublishedReviewAccess(params.shareId, request.headers);
  if (!access) return { response: Response.json({ error: "Published handoff not found." }, { status: 404 }) };
  if (!access.decision.allowed) return { response: Response.json({ error: "This handoff is not available to you." }, { status: access.session ? 404 : 401 }) };
  if (!access.decision.canWrite) return { response: Response.json({ error: "You cannot update canvas notes in this handoff." }, { status: 403 }) };
  if (!getVisiblePublishedReviewVersion(access.handoff, params.versionId)) return { response: Response.json({ error: "Handoff version not found." }, { status: 404 }) };
  return { access, params };
}

export async function PATCH(request: Request, context: ReviewAnnotationRoute) {
  const loaded = await load(request, context);
  if ("response" in loaded) return loaded.response;
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Enter a title and note." }, { status: 400 });
  if (!updateHandoffAnnotation({ workspaceId: loaded.access.handoff.workspaceId, versionId: loaded.params.versionId, annotationId: loaded.params.annotationId, ...parsed.data })) {
    return Response.json({ error: "Canvas note not found." }, { status: 404 });
  }
  return Response.json({ updated: true });
}

export async function DELETE(request: Request, context: ReviewAnnotationRoute) {
  const loaded = await load(request, context);
  if ("response" in loaded) return loaded.response;
  if (!deleteHandoffAnnotation({ workspaceId: loaded.access.handoff.workspaceId, versionId: loaded.params.versionId, annotationId: loaded.params.annotationId })) {
    return Response.json({ error: "Canvas note not found." }, { status: 404 });
  }
  return Response.json({ deleted: true });
}
