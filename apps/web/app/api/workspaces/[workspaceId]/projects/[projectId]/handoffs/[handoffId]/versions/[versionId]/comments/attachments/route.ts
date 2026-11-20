import { getHandoff } from "@/src/server/repositories/handoffs";
import { getVersionRecord } from "@/src/server/repositories/versions";
import { CommentAttachmentError, commentAttachmentMaxBytes, createCommentAttachment, dimensionFromHeader } from "@/src/server/services/comment-attachments";
import { requireHandoffAccess, WorkspaceAccessError } from "@/src/server/workspace-access";

type AttachmentsRoute = {
  params: Promise<{ workspaceId: string; projectId: string; handoffId: string; versionId: string }>;
};

/** Upload one image for a comment that is about to be posted: the raw bytes as the body. */
export async function POST(request: Request, context: AttachmentsRoute) {
  const { workspaceId, projectId, handoffId, versionId } = await context.params;
  try {
    const access = await requireHandoffAccess(request, { workspaceId, handoffId });
    const handoff = await getHandoff({ workspaceId, projectId, handoffId });
    const version = await getVersionRecord({ workspaceId, versionId });
    if (!handoff || !version || version.handoffId !== handoffId) {
      return Response.json({ error: "Handoff version not found." }, { status: 404 });
    }
    if (Number(request.headers.get("content-length") ?? 0) > commentAttachmentMaxBytes) {
      return Response.json({ error: "Images can be up to 3 MB." }, { status: 413 });
    }
    const attachment = await createCommentAttachment({
      workspaceId,
      versionId,
      bytes: new Uint8Array(await request.arrayBuffer()),
      width: dimensionFromHeader(request.headers.get("x-image-width")),
      height: dimensionFromHeader(request.headers.get("x-image-height")),
      createdBy: access.userId,
    });
    return Response.json(attachment, { status: 201 });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof CommentAttachmentError) return Response.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
