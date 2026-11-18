import { getDatabase } from "@/src/server/db";
import { requireHandoffAccess, WorkspaceAccessError } from "@/src/server/workspace-access";

type LatestVersionRoute = { params: Promise<{ workspaceId: string; projectId: string; handoffId: string }> };

/** The handoff's newest version, so an open review can offer it as soon as a capture lands. */
export async function GET(request: Request, context: LatestVersionRoute) {
  const { workspaceId, projectId, handoffId } = await context.params;
  try {
    await requireHandoffAccess(request, { workspaceId, handoffId });
    const latest = (await getDatabase()
      .prepare(
        `SELECT handoff_version.id, handoff_version.version_label AS versionLabel, handoff_version.created_at AS createdAt
         FROM handoff_version
         JOIN handoff ON handoff.id = handoff_version.handoff_id AND handoff.workspace_id = handoff_version.workspace_id
         WHERE handoff_version.workspace_id = ? AND handoff_version.handoff_id = ? AND handoff.project_id = ?
         ORDER BY handoff_version.created_at DESC, handoff_version.id DESC
         LIMIT 1`,
      )
      .get(workspaceId, handoffId, projectId)) as { id: string; versionLabel: string; createdAt: string } | undefined;
    return Response.json({ latest: latest ?? null }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
