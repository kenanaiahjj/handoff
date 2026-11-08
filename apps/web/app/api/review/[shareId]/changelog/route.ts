import { getPublishedHandoffByShareId, listHandoffVersions } from "@/src/server/repositories/handoffs";
import { listApprovedChangelogsForVersion } from "@/src/server/repositories/changelogs";
import { versionsVisibleToReview } from "@/src/server/services/published-review";
import { requireWorkspaceRole, WorkspaceAccessError, workspaceRoles } from "@/src/server/workspace-access";

type PublishedChangelogRoute = { params: Promise<{ shareId: string }> };

export async function GET(request: Request, context: PublishedChangelogRoute) {
  const { shareId } = await context.params;
  const handoff = getPublishedHandoffByShareId(shareId);
  if (!handoff) return Response.json({ error: "Published handoff not found." }, { status: 404 });

  try {
    await requireWorkspaceRole(request, handoff.workspaceId, [...workspaceRoles]);
    const versionId = new URL(request.url).searchParams.get("versionId");
    if (!versionId) return Response.json({ error: "A version ID is required." }, { status: 400 });

    const versions = listHandoffVersions({ workspaceId: handoff.workspaceId, handoffId: handoff.id }) as Array<{ id: string }>;
    if (!versionsVisibleToReview(versions, handoff.publishedVersionId).some((version) => version.id === versionId)) {
      return Response.json({ error: "Version is not included in this published handoff." }, { status: 404 });
    }

    const drafts = listApprovedChangelogsForVersion({ workspaceId: handoff.workspaceId, handoffId: handoff.id, versionId })
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
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
