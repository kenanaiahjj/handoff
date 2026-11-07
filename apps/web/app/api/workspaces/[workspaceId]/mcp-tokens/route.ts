import { z } from "zod";
import {
  createWorkspaceMcpToken,
  listWorkspaceMcpTokens,
  mcpScopes,
  revokeWorkspaceMcpToken,
} from "@/src/server/repositories/mcp-tokens";
import { requireWorkspaceRole, WorkspaceAccessError, workspaceRoles } from "@/src/server/workspace-access";

type McpTokensRoute = { params: Promise<{ workspaceId: string }> };

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z.array(z.enum(mcpScopes)).min(1).max(mcpScopes.length),
  expiresInDays: z.number().int().min(1).max(365),
}).superRefine((value, context) => {
  if (new Set(value.scopes).size !== value.scopes.length) {
    context.addIssue({ code: "custom", message: "Scopes must be unique.", path: ["scopes"] });
  }
});

export async function GET(request: Request, context: McpTokensRoute) {
  const { workspaceId } = await context.params;
  try {
    const access = await requireWorkspaceRole(request, workspaceId, [...workspaceRoles]);
    return Response.json({ tokens: listWorkspaceMcpTokens({ workspaceId, userId: access.userId, includeAll: true }) });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

export async function POST(request: Request, context: McpTokensRoute) {
  const { workspaceId } = await context.params;
  try {
    const actor = await requireWorkspaceRole(request, workspaceId, [...workspaceRoles]);
    const parsed = createSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "Check the token name, scopes, and expiry." }, { status: 400 });
    const created = createWorkspaceMcpToken({ workspaceId, createdBy: actor.userId, ...parsed.data });
    return Response.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

export async function DELETE(request: Request, context: McpTokensRoute) {
  const { workspaceId } = await context.params;
  try {
    const actor = await requireWorkspaceRole(request, workspaceId, [...workspaceRoles]);
    const parsed = z.object({ id: z.string().uuid() }).safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "Choose a valid token." }, { status: 400 });
    if (!revokeWorkspaceMcpToken({ workspaceId, tokenId: parsed.data.id, actorId: actor.userId, canManageAll: true })) {
      return Response.json({ error: "Token not found or already revoked." }, { status: 404 });
    }
    return Response.json({ revoked: true });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
