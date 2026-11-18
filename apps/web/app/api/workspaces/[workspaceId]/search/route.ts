import { getDatabase } from "@/src/server/db";
import { filterProjectsForViewer, visibleHandoffIds } from "@/src/server/services/review-visibility";
import { listProjects } from "@/src/server/repositories/projects";
import { requireWorkspaceRole, WorkspaceAccessError, workspaceRoles } from "@/src/server/workspace-access";

type SearchRoute = { params: Promise<{ workspaceId: string }> };

type Item = { id: string; kind: "project" | "handoff" | "screen"; label: string; detail: string; href: string };

/**
 * Everything ⌘K can jump to that this person may open: projects, handoffs, and the screens in each
 * handoff's newest version. Loaded once when the palette first opens; filtering happens in the browser.
 */
export async function GET(request: Request, context: SearchRoute) {
  const { workspaceId } = await context.params;
  try {
    const access = await requireWorkspaceRole(request, workspaceId, [...workspaceRoles]);
    const viewer = { id: access.userId, email: access.email, role: access.role };
    const database = getDatabase();
    const [projects, visible, handoffs] = await Promise.all([
      listProjects(workspaceId).then((all) => filterProjectsForViewer(workspaceId, viewer, all as Array<{ id: string; name: string; handoffCount: number; versionCount: number }>)),
      visibleHandoffIds(workspaceId, viewer),
      database
        .prepare(
          `SELECT handoff.id, handoff.name, handoff.project_id AS projectId, project.name AS projectName,
                  (SELECT handoff_version.id FROM handoff_version WHERE handoff_version.handoff_id = handoff.id
                   ORDER BY handoff_version.created_at DESC LIMIT 1) AS latestVersionId
           FROM handoff JOIN project ON project.id = handoff.project_id
           WHERE handoff.workspace_id = ?
           ORDER BY handoff.name`,
        )
        .all(workspaceId) as Promise<Array<{ id: string; name: string; projectId: string; projectName: string; latestVersionId: string | null }>>,
    ]);
    const shown = handoffs.filter((handoff) => !visible || visible.has(handoff.id));
    const versionIds = shown.map((handoff) => handoff.latestVersionId).filter((id): id is string => Boolean(id));
    const indexes = versionIds.length
      ? ((await database
          .prepare(`SELECT version_id AS versionId, frame_index AS frameIndex FROM handoff_version_snapshot WHERE version_id IN (${versionIds.map(() => "?").join(", ")})`)
          .all(...versionIds)) as Array<{ versionId: string; frameIndex: string }>)
      : [];
    type IndexedFrame = { sourceFrameId: string; name: string };
    const framesByVersion = new Map<string, IndexedFrame[]>();
    for (const row of indexes) {
      try {
        framesByVersion.set(row.versionId, JSON.parse(row.frameIndex) as IndexedFrame[]);
      } catch {
        framesByVersion.set(row.versionId, []);
      }
    }

    const base = `/workspace/${workspaceId}`;
    const items: Item[] = [
      ...projects.map((project) => ({ id: `p:${project.id}`, kind: "project" as const, label: project.name, detail: `Project · ${project.handoffCount} ${project.handoffCount === 1 ? "handoff" : "handoffs"}`, href: `${base}/projects/${project.id}` })),
      ...shown.map((handoff) => ({ id: `h:${handoff.id}`, kind: "handoff" as const, label: handoff.name, detail: `Handoff · ${handoff.projectName}`, href: `${base}/projects/${handoff.projectId}/handoffs/${handoff.id}` })),
      ...shown.flatMap((handoff) =>
        (handoff.latestVersionId ? framesByVersion.get(handoff.latestVersionId) ?? [] : []).map((frame) => ({
          id: `s:${handoff.id}:${frame.sourceFrameId}`,
          kind: "screen" as const,
          label: frame.name,
          detail: `Screen · ${handoff.name} · ${handoff.projectName}`,
          href: `${base}/projects/${handoff.projectId}/handoffs/${handoff.id}#screen=${encodeURIComponent(frame.sourceFrameId)}`,
        })),
      ),
    ];
    return Response.json({ items }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
