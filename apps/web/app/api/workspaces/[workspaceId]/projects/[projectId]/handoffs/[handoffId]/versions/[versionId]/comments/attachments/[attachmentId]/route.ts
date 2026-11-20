import { attachmentResponse, getCommentAttachment } from "@/src/server/services/comment-attachments";
import { requireHandoffAccess, WorkspaceAccessError } from "@/src/server/workspace-access";

type AttachmentRoute = {
  params: Promise<{ workspaceId: string; projectId: string; handoffId: string; versionId: string; attachmentId: string }>;
};

export async function GET(request: Request, context: AttachmentRoute) {
  const { workspaceId, handoffId, versionId, attachmentId } = await context.params;
  try {
    await requireHandoffAccess(request, { workspaceId, handoffId });
    const row = await getCommentAttachment(workspaceId, versionId, attachmentId);
    if (!row) return Response.json({ error: "Image not found." }, { status: 404 });
    return attachmentResponse(row);
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
