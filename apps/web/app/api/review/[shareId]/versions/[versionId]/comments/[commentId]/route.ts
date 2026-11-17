import { z } from "zod";
import { setCommentResolved } from "@/src/server/repositories/comments";
import { getVisiblePublishedReviewVersionRecord, resolvePublishedReviewAccess } from "@/src/server/services/handoff-review-access";

type ReviewCommentRoute = { params: Promise<{ shareId: string; versionId: string; commentId: string }> };

export async function PATCH(request: Request, context: ReviewCommentRoute) {
  const { shareId, versionId, commentId } = await context.params;
  const access = await resolvePublishedReviewAccess(shareId, request.headers);
  if (!access?.decision.allowed) return Response.json({ error: "This handoff is not available to you." }, { status: access?.session ? 404 : 401 });
  // Anyone who can comment can resolve or reopen, including link-based invitees without an account.
  if (!access.decision.canWrite) return Response.json({ error: "You cannot update comments in this handoff." }, { status: 403 });
  if (!(await getVisiblePublishedReviewVersionRecord(access.handoff, versionId))) return Response.json({ error: "Handoff version not found." }, { status: 404 });
  const parsed = z.object({ resolved: z.boolean() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Choose an open or resolved status." }, { status: 400 });
  const updated = (await setCommentResolved({
    workspaceId: access.handoff.workspaceId,
    versionId,
    commentId,
    resolved: parsed.data.resolved,
    updatedBy: access.session?.user.id ?? null,
  }));
  if (!updated) return Response.json({ error: "Comment thread not found." }, { status: 404 });
  return Response.json({ resolved: parsed.data.resolved });
}
