import { getVisiblePublishedReviewVersion, listVisiblePublishedReviewVersions, resolvePublishedReviewAccess } from "@/src/server/services/handoff-review-access";

type LatestReviewRoute = RouteContext<"/api/review/[shareId]/latest">;

export async function GET(request: Request, context: LatestReviewRoute) {
  const { shareId } = await context.params;
  const access = await resolvePublishedReviewAccess(shareId, request.headers);
  if (!access) return Response.json({ error: "Published handoff not found." }, { status: 404 });
  if (!access.decision.allowed) return Response.json({ error: "This handoff is not available to you." }, { status: access.session ? 404 : 401 });
  const version = getVisiblePublishedReviewVersion(access.handoff, access.handoff.publishedVersionId);
  if (!version) return Response.json({ error: "Published version not found." }, { status: 404 });
  const visibleVersions = listVisiblePublishedReviewVersions(access.handoff);
  return Response.json({
    versionId: version.id,
    versionLabel: version.versionLabel,
    publishedAt: access.handoff.publishedAt,
    publishedVersions: visibleVersions.map(({ id, versionLabel }) => ({ id, versionLabel })),
  }, { headers: { "Cache-Control": "no-store" } });
}
