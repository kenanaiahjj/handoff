import { z } from "zod";
import { createHandoffAnnotation, listHandoffAnnotations } from "@/src/server/repositories/annotations";
import { getVisiblePublishedReviewVersion, resolvePublishedReviewAccess } from "@/src/server/services/handoff-review-access";
import { isStructuredSnapshot } from "@/src/server/services/diff";
import { canvasAnnotationAnchorError } from "@/src/server/services/canvas-annotation-anchor";

type ReviewAnnotationsRoute = { params: Promise<{ shareId: string; versionId: string }> };

const createSchema = z.object({
  frameId: z.string().min(1).max(200),
  sourceNodeId: z.string().min(1).max(200).nullable(),
  x: z.number().finite().min(0),
  y: z.number().finite().min(0),
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(2000),
});

export async function GET(request: Request, context: ReviewAnnotationsRoute) {
  const { shareId, versionId } = await context.params;
  const access = await resolvePublishedReviewAccess(shareId, request.headers);
  if (!access) return Response.json({ error: "Published handoff not found." }, { status: 404 });
  if (!access.decision.allowed) return Response.json({ error: "This handoff is not available to you." }, { status: access.session ? 404 : 401 });
  const version = getVisiblePublishedReviewVersion(access.handoff, versionId);
  if (!version) return Response.json({ error: "Handoff version not found." }, { status: 404 });
  return Response.json({ annotations: listHandoffAnnotations({ workspaceId: access.handoff.workspaceId, versionId }) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, context: ReviewAnnotationsRoute) {
  const { shareId, versionId } = await context.params;
  const access = await resolvePublishedReviewAccess(shareId, request.headers);
  if (!access) return Response.json({ error: "Published handoff not found." }, { status: 404 });
  if (!access.decision.allowed) return Response.json({ error: "This handoff is not available to you." }, { status: access.session ? 404 : 401 });
  if (!access.decision.canWrite || !access.session) return Response.json({ error: "You cannot add canvas notes to this handoff." }, { status: 403 });
  const version = getVisiblePublishedReviewVersion(access.handoff, versionId);
  if (!version) return Response.json({ error: "Handoff version not found." }, { status: 404 });
  if (!isStructuredSnapshot(version.snapshot)) return Response.json({ error: "Canvas annotations need a structured Figma capture." }, { status: 400 });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Enter a title and note, then choose a canvas point." }, { status: 400 });
  const anchorError = canvasAnnotationAnchorError(version.snapshot, parsed.data);
  if (anchorError) return Response.json({ error: anchorError }, { status: 400 });
  const annotation = createHandoffAnnotation({
    workspaceId: access.handoff.workspaceId,
    versionId,
    frameId: parsed.data.frameId,
    sourceNodeId: parsed.data.sourceNodeId,
    x: parsed.data.x,
    y: parsed.data.y,
    title: parsed.data.title,
    body: parsed.data.body,
    createdBy: access.session.user.id,
  });
  return Response.json({ annotation }, { status: 201 });
}
