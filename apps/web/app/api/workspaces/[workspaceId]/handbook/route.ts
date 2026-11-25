import { z } from "zod";
import { managerRoles, requireWorkspaceRole, workspaceRoles, WorkspaceAccessError } from "@/src/server/workspace-access";
import { getHandbook, handbookMaxLength, HandbookError, resetHandbook, saveHandbook } from "@/src/server/services/handbook";

type HandbookRoute = { params: Promise<{ workspaceId: string }> };

const handbookSchema = z.object({ markdown: z.string().max(handbookMaxLength) });

function errorResponse(error: unknown) {
  if (error instanceof WorkspaceAccessError) return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof HandbookError) return Response.json({ error: error.message }, { status: 400 });
  throw error;
}

/** Everyone in the workspace can read the naming handbook. */
export async function GET(request: Request, context: HandbookRoute) {
  const { workspaceId } = await context.params;
  try {
    await requireWorkspaceRole(request, workspaceId, workspaceRoles);
    return Response.json(await getHandbook(workspaceId));
  } catch (error) {
    return errorResponse(error);
  }
}

/** Owners and designers save the workspace's own copy. */
export async function PUT(request: Request, context: HandbookRoute) {
  const { workspaceId } = await context.params;
  try {
    const access = await requireWorkspaceRole(request, workspaceId, managerRoles);
    const parsed = handbookSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "Check the handbook and try again." }, { status: 400 });
    return Response.json(await saveHandbook(workspaceId, access.userId, parsed.data.markdown));
  } catch (error) {
    return errorResponse(error);
  }
}

/** Owners and designers go back to the built-in guide. */
export async function DELETE(request: Request, context: HandbookRoute) {
  const { workspaceId } = await context.params;
  try {
    await requireWorkspaceRole(request, workspaceId, managerRoles);
    return Response.json(await resetHandbook(workspaceId));
  } catch (error) {
    return errorResponse(error);
  }
}
