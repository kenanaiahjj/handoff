import { CommentAttachmentError, commentAttachmentMaxBytes, createCommentAttachment, dimensionFromHeader } from "@/src/server/services/comment-attachments";
import { getVisiblePublishedReviewVersionRecord, resolvePublishedReviewAccess } from "@/src/server/services/handoff-review-access";

type ReviewAttachmentsRoute = { params: Promise<{ shareId: string; versionId: string }> };

/** Upload one image for a comment on a shared review link. */
export async function POST(request: Request, context: ReviewAttachmentsRoute) {
  const { shareId, versionId } = await context.params;
  const access = await resolvePublishedReviewAccess(shareId, request.headers);
  if (!access?.decision.allowed) return Response.json({ error: "This handoff is not available to you." }, { status: access?.session ? 404 : 401 });
  if (!access.decision.canComment) return Response.json({ error: "This invitation does not allow comments." }, { status: 403 });
  const version = await getVisiblePublishedReviewVersionRecord(access.handoff, versionId);
  if (!version) return Response.json({ error: "Handoff version not found." }, { status: 404 });
  if (Number(request.headers.get("content-length") ?? 0) > commentAttachmentMaxBytes) {
    return Response.json({ error: "Images can be up to 3 MB." }, { status: 413 });
  }
  try {
    const attachment = await createCommentAttachment({
      workspaceId: access.handoff.workspaceId,
      versionId,
      bytes: new Uint8Array(await request.arrayBuffer()),
      width: dimensionFromHeader(request.headers.get("x-image-width")),
      height: dimensionFromHeader(request.headers.get("x-image-height")),
      createdBy: access.session?.user.id ?? null,
    });
    return Response.json(attachment, { status: 201 });
  } catch (error) {
    if (error instanceof CommentAttachmentError) return Response.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
