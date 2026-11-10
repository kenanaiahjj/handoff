import { listApprovedChangelogsForVersion } from "@/src/server/repositories/changelogs";
import { listVisiblePublishedReviewVersions, resolvePublishedReviewAccess } from "@/src/server/services/handoff-review-access";

type PublishedChangelogRoute = { params: Promise<{ shareId: string }> };

export async function GET(request: Request, context: PublishedChangelogRoute) {
  const { shareId } = await context.params;
  const access = await resolvePublishedReviewAccess(shareId, request.headers);
  if (!access) return Response.json({ error: "Published handoff not found." }, { status: 404 });
  if (!access.decision.allowed) return Response.json({ error: "This handoff is not available to you." }, { status: access.session ? 404 : 401 });
  const versionId = new URL(request.url).searchParams.get("versionId");
  if (!versionId) return Response.json({ error: "A version ID is required." }, { status: 400 });
  if (!listVisiblePublishedReviewVersions(access.handoff).some((version) => version.id === versionId)) {
    return Response.json({ error: "Version is not included in this published handoff." }, { status: 404 });
  }

  const drafts = listApprovedChangelogsForVersion({ workspaceId: access.handoff.workspaceId, handoffId: access.handoff.id, versionId })
    .map(({ id, fromVersionId, toVersionId, title, summary, statements, evidence, createdAt }) => ({
      id,
      fromVersionId,
      toVersionId,
      title,
      summary,
      statements,
      evidence,
      createdAt,
    }));
  return Response.json({ drafts }, { headers: { "Cache-Control": "no-store" } });
}
