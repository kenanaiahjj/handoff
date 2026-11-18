import { frameNodeDetailsHeaders } from "@/src/server/services/frame-node-details";
import { readScreenNodes } from "@/src/server/services/frame-store";
import { getVisiblePublishedReviewVersionRecord, resolvePublishedReviewAccess } from "@/src/server/services/handoff-review-access";

type ReviewFrameNodesRoute = { params: Promise<{ shareId: string; versionId: string; frameId: string }> };

export async function GET(request: Request, context: ReviewFrameNodesRoute) {
  const { shareId, versionId, frameId } = await context.params;
  const access = await resolvePublishedReviewAccess(shareId, request.headers);
  if (!access?.decision.allowed) {
    return Response.json({ error: "This handoff is not available to you." }, { status: access?.session ? 404 : 401 });
  }
  const version = (await getVisiblePublishedReviewVersionRecord(access.handoff, versionId));
  if (!version) return Response.json({ error: "Handoff version not found." }, { status: 404 });
  const nodes = await readScreenNodes(version, frameId);
  if (!nodes) return Response.json({ error: "Screen not found in this version." }, { status: 404 });
  return Response.json({ nodes }, { headers: frameNodeDetailsHeaders });
}
