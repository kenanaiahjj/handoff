import { getAssetByObjectKey } from "@/src/server/repositories/versions";
import { createAssetResponse } from "@/src/server/services/asset-response";
import { getVisiblePublishedReviewVersionRecord, resolvePublishedReviewAccess } from "@/src/server/services/handoff-review-access";

type ReviewAssetRoute = { params: Promise<{ shareId: string; assetKey: string }> };

export async function GET(request: Request, context: ReviewAssetRoute) {
  const { shareId, assetKey } = await context.params;
  const access = await resolvePublishedReviewAccess(shareId, request.headers);
  if (!access) return Response.json({ error: "Published handoff not found." }, { status: 404 });
  if (!access.decision.allowed) {
    return Response.json({ error: "This handoff is not available to you." }, { status: access.session ? 404 : 401 });
  }

  const asset = await getAssetByObjectKey(assetKey, { handoffId: access.handoff.id });
  if (!asset || asset.workspaceId !== access.handoff.workspaceId) {
    return Response.json({ error: "Asset not found." }, { status: 404 });
  }
  const version = await getVisiblePublishedReviewVersionRecord(access.handoff, asset.versionId);
  if (!version || !version.assets.some((candidate) => candidate.objectKey === asset.objectKey)) {
    return Response.json({ error: "Asset not found." }, { status: 404 });
  }

  return createAssetResponse(request, asset);
}
