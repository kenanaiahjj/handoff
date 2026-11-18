import { z } from "zod";
import { addProjectMember, listProjectAccess, ProjectAccessError, removeProjectMember } from "@/src/server/services/project-access";
import { managerRoles, requireWorkspaceRole, WorkspaceAccessError } from "@/src/server/workspace-access";

type MembersRoute = { params: Promise<{ workspaceId: string; projectId: string }> };

function errorResponse(error: unknown) {
  if (error instanceof WorkspaceAccessError) return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof ProjectAccessError) return Response.json({ error: error.message }, { status: error.message === "Project not found." ? 404 : 400 });
  throw error;
}

/** Everyone who can see the project: owners and designers, project members, and handoff-only invitees. */
export async function GET(request: Request, context: MembersRoute) {
  const { workspaceId, projectId } = await context.params;
  try {
    await requireWorkspaceRole(request, workspaceId, managerRoles);
    return Response.json(await listProjectAccess(workspaceId, projectId));
  } catch (error) {
    return errorResponse(error);
  }
}

const addSchema = z.object({ email: z.string().trim().min(3).max(254), role: z.enum(["pd", "qa", "dev", "exec"]).default("exec") });

export async function POST(request: Request, context: MembersRoute) {
  const { workspaceId, projectId } = await context.params;
  try {
    const access = await requireWorkspaceRole(request, workspaceId, managerRoles);
    const parsed = addSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "Enter an email address." }, { status: 400 });
    await addProjectMember({ workspaceId, projectId, email: parsed.data.email, role: parsed.data.role, addedBy: access.userId });
    return Response.json(await listProjectAccess(workspaceId, projectId), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: MembersRoute) {
  const { workspaceId, projectId } = await context.params;
  try {
    await requireWorkspaceRole(request, workspaceId, managerRoles);
    const email = new URL(request.url).searchParams.get("email");
    if (!email) return Response.json({ error: "Choose who to remove." }, { status: 400 });
    await removeProjectMember({ workspaceId, projectId, email });
    return Response.json(await listProjectAccess(workspaceId, projectId));
  } catch (error) {
    return errorResponse(error);
  }
}
