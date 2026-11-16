import { frameNodeDetails, frameNodeDetailsHeaders } from "@/src/server/services/frame-node-details";
import { getVisiblePublishedReviewVersion, resolvePublishedReviewAccess } from "@/src/server/services/handoff-review-access";

type ReviewFrameNodesRoute = { params: Promise<{ shareId: string; versionId: string; frameId: string }> };

export async function GET(request: Request, context: ReviewFrameNodesRoute) {
  const { shareId, versionId, frameId } = await context.params;
  const access = await resolvePublishedReviewAccess(shareId, request.headers);
  if (!access?.decision.allowed) {
    return Response.json({ error: "This handoff is not available to you." }, { status: access?.session ? 404 : 401 });
  }
  const version = getVisiblePublishedReviewVersion(access.handoff, versionId);
  if (!version) return Response.json({ error: "Handoff version not found." }, { status: 404 });
  const nodes = frameNodeDetails(version, frameId);
  if (!nodes) return Response.json({ error: "Screen not found in this version." }, { status: 404 });
  return Response.json({ nodes }, { headers: frameNodeDetailsHeaders });
}
