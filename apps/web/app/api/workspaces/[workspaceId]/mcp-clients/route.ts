import { z } from "zod";
import { listMcpClientConnections, revokeMcpClientConnection } from "@/src/server/repositories/mcp-clients";
import { requireWorkspaceRole, WorkspaceAccessError, workspaceRoles } from "@/src/server/workspace-access";
import { canSeeWholeWorkspace } from "@/src/server/services/review-visibility";

type McpClientsRoute = { params: Promise<{ workspaceId: string }> };

/** AI clients people signed in to the MCP server with. Owners and designers see everyone's. */
export async function GET(request: Request, context: McpClientsRoute) {
  const { workspaceId } = await context.params;
  try {
    const access = await requireWorkspaceRole(request, workspaceId, [...workspaceRoles]);
    const clients = await listMcpClientConnections({ workspaceId, userId: access.userId, includeAll: canSeeWholeWorkspace(access.role) });
    return Response.json({ clients, viewerId: access.userId });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

export async function DELETE(request: Request, context: McpClientsRoute) {
  const { workspaceId } = await context.params;
  try {
    const actor = await requireWorkspaceRole(request, workspaceId, [...workspaceRoles]);
    const parsed = z.object({ userId: z.string().min(1).max(200), clientId: z.string().min(1).max(500) }).safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "Choose a connected client." }, { status: 400 });
    const revoked = await revokeMcpClientConnection({ workspaceId, ...parsed.data, actorId: actor.userId, canManageAll: canSeeWholeWorkspace(actor.role) });
    if (!revoked) return Response.json({ error: "That client isn't connected to this workspace." }, { status: 404 });
    return Response.json({ revoked: true });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
