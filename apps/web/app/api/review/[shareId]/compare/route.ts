import { getConfirmedFrameMatchesBetweenVersions, type StoredVersionAsset } from "@/src/server/repositories/versions";
import { diffSnapshots, isStructuredSnapshot } from "@/src/server/services/diff";
import { getVisiblePublishedReviewVersion, resolvePublishedReviewAccess } from "@/src/server/services/handoff-review-access";

type ReviewCompareRoute = { params: Promise<{ shareId: string }> };
type CompareVersion = NonNullable<ReturnType<typeof getVisiblePublishedReviewVersion>>;

function framePreview(version: CompareVersion, frameId: string, shareId: string) {
  const frame = version.snapshot.frames.find((candidate) => candidate.sourceFrameId === frameId);
  if (!frame) return null;
  const asset = version.assets.find((candidate: StoredVersionAsset) => candidate.assetKey === frame.renderAssetKey);
  if (!asset) return null;
  const structuredFrame = isStructuredSnapshot(version.snapshot)
    ? version.snapshot.frames.find((candidate) => candidate.sourceFrameId === frameId)
    : null;
  const sourceWidth = structuredFrame?.bounds.width.value ?? null;
  const sourceHeight = structuredFrame?.bounds.height.value ?? null;
  return {
    name: frame.name,
    imageUrl: `/api/review/${encodeURIComponent(shareId)}/assets/${encodeURIComponent(asset.objectKey)}`,
    width: asset.width,
    height: asset.height,
    sourceWidth: sourceWidth ?? asset.width ?? 1280,
    sourceHeight: sourceHeight ?? asset.height ?? 900,
    dimensionsSource: sourceWidth !== null && sourceHeight !== null ? "design" as const : "image" as const,
  };
}

export async function GET(request: Request, context: ReviewCompareRoute) {
  const { shareId } = await context.params;
  const url = new URL(request.url);
  const fromVersionId = url.searchParams.get("from");
  const toVersionId = url.searchParams.get("to");
  if (!fromVersionId || !toVersionId) return Response.json({ error: "Choose two versions to compare." }, { status: 400 });

  const access = await resolvePublishedReviewAccess(shareId, request.headers);
  if (!access) return Response.json({ error: "Published handoff not found." }, { status: 404 });
  if (!access.decision.allowed) {
    return Response.json({ error: "This handoff is not available to you." }, { status: access.session ? 404 : 401 });
  }

  const from = getVisiblePublishedReviewVersion(access.handoff, fromVersionId);
  const to = getVisiblePublishedReviewVersion(access.handoff, toVersionId);
  if (!from || !to || from.id === to.id) return Response.json({ error: "The selected versions were not found in this handoff." }, { status: 404 });

  const frameMatches = getConfirmedFrameMatchesBetweenVersions({
    workspaceId: access.handoff.workspaceId,
    handoffId: access.handoff.id,
    from,
    to,
  });
  const diff = diffSnapshots(
    { versionId: from.id, snapshot: from.snapshot },
    { versionId: to.id, snapshot: to.snapshot },
    { frameMatches },
  );
  const frames = diff.frames.map((frame) => ({
    ...frame,
    before: frame.beforeFrameId ? framePreview(from, frame.beforeFrameId, shareId) : null,
    after: frame.afterFrameId ? framePreview(to, frame.afterFrameId, shareId) : null,
  }));
  return Response.json({ diff, frames }, { headers: { "Cache-Control": "no-store" } });
}
