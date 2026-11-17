import { getHandoff } from "@/src/server/repositories/handoffs";
import { getVersion } from "@/src/server/repositories/versions";
import { frameNodeDetails, frameNodeDetailsHeaders } from "@/src/server/services/frame-node-details";
import { requireHandoffAccess, WorkspaceAccessError } from "@/src/server/workspace-access";

type FrameNodesRoute = {
  params: Promise<{ workspaceId: string; projectId: string; handoffId: string; versionId: string; frameId: string }>;
};

export async function GET(request: Request, context: FrameNodesRoute) {
  const { workspaceId, projectId, handoffId, versionId, frameId } = await context.params;
  try {
    await requireHandoffAccess(request, { workspaceId, handoffId });
    const handoff = (await getHandoff({ workspaceId, projectId, handoffId }));
    const version = (await getVersion({ workspaceId, versionId }));
    if (!handoff || !version || version.handoffId !== handoffId) {
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
