import { getPublishedHandoffByShareId, listHandoffVersions } from "@/src/server/repositories/handoffs";
import { getVersion } from "@/src/server/repositories/versions";
import { versionsVisibleToReview } from "@/src/server/services/published-review";
import { requireWorkspaceRole, WorkspaceAccessError, workspaceRoles } from "@/src/server/workspace-access";

type LatestReviewRoute = RouteContext<"/api/review/[shareId]/latest">;

export async function GET(request: Request, context: LatestReviewRoute) {
  const { shareId } = await context.params;
  const handoff = getPublishedHandoffByShareId(shareId);
  if (!handoff) return Response.json({ error: "Published handoff not found." }, { status: 404 });
  try {
    await requireWorkspaceRole(request, handoff.workspaceId, [...workspaceRoles]);
    const version = getVersion({ workspaceId: handoff.workspaceId, versionId: handoff.publishedVersionId });
    if (!version) return Response.json({ error: "Published version not found." }, { status: 404 });
    const versions = listHandoffVersions({ workspaceId: handoff.workspaceId, handoffId: handoff.id }) as Array<{ id: string; versionLabel: string }>;
    const visibleVersions = versionsVisibleToReview(versions, handoff.publishedVersionId);
    return Response.json({
      versionId: version.id,
      versionLabel: version.versionLabel,
      publishedAt: handoff.publishedAt,
      publishedVersions: visibleVersions.map(({ id, versionLabel }) => ({ id, versionLabel })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
