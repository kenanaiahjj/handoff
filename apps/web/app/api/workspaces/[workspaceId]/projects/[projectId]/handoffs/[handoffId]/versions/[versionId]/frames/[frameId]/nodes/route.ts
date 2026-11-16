import { getHandoff } from "@/src/server/repositories/handoffs";
import { getVersion } from "@/src/server/repositories/versions";
import { frameNodeDetails, frameNodeDetailsHeaders } from "@/src/server/services/frame-node-details";
import { visibleHandoffIds } from "@/src/server/services/review-visibility";
import { getDatabase } from "@/src/server/db";
import { requireWorkspaceRole, WorkspaceAccessError, workspaceRoles } from "@/src/server/workspace-access";

type FrameNodesRoute = {
  params: Promise<{ workspaceId: string; projectId: string; handoffId: string; versionId: string; frameId: string }>;
};

export async function GET(request: Request, context: FrameNodesRoute) {
  const { workspaceId, projectId, handoffId, versionId, frameId } = await context.params;
  try {
    const access = await requireWorkspaceRole(request, workspaceId, [...workspaceRoles]);
    const user = getDatabase().prepare('SELECT email FROM "user" WHERE id = ?').get(access.userId) as { email: string } | undefined;
    const visible = visibleHandoffIds(workspaceId, { id: access.userId, email: user?.email ?? "", role: access.role });
    const handoff = getHandoff({ workspaceId, projectId, handoffId });
    const version = getVersion({ workspaceId, versionId });
    if (!handoff || !version || version.handoffId !== handoffId || (visible && !visible.has(handoffId))) {
      return Response.json({ error: "Handoff version not found." }, { status: 404 });
    }
    const nodes = frameNodeDetails(version, frameId);
    if (!nodes) return Response.json({ error: "Screen not found in this version." }, { status: 404 });
    return Response.json({ nodes }, { headers: frameNodeDetailsHeaders });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
