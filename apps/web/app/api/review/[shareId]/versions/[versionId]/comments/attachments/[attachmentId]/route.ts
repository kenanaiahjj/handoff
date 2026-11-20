import { attachmentResponse, getCommentAttachment } from "@/src/server/services/comment-attachments";
import { getVisiblePublishedReviewVersionRecord, resolvePublishedReviewAccess } from "@/src/server/services/handoff-review-access";

type ReviewAttachmentRoute = { params: Promise<{ shareId: string; versionId: string; attachmentId: string }> };

export async function GET(request: Request, context: ReviewAttachmentRoute) {
  const { shareId, versionId, attachmentId } = await context.params;
  const access = await resolvePublishedReviewAccess(shareId, request.headers);
  if (!access?.decision.allowed) return Response.json({ error: "This handoff is not available to you." }, { status: access?.session ? 404 : 401 });
  const version = await getVisiblePublishedReviewVersionRecord(access.handoff, versionId);
  if (!version) return Response.json({ error: "Handoff version not found." }, { status: 404 });
  const row = await getCommentAttachment(access.handoff.workspaceId, versionId, attachmentId);
  if (!row) return Response.json({ error: "Image not found." }, { status: 404 });
  return attachmentResponse(row);
}
