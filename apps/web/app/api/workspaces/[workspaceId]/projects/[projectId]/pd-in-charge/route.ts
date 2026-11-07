import { z } from "zod";
import { assignProjectPdInCharge, getProject, listProjectPdCandidates } from "@/src/server/repositories/projects";
import { requireWorkspaceRole, WorkspaceAccessError, workspaceRoles } from "@/src/server/workspace-access";

type ProjectPdInChargeRoute = RouteContext<"/api/workspaces/[workspaceId]/projects/[projectId]/pd-in-charge">;

const assignmentSchema = z.object({ pdInChargeUserId: z.string().uuid().nullable() });

export async function PATCH(request: Request, context: ProjectPdInChargeRoute) {
  const { workspaceId, projectId } = await context.params;
  try {
    await requireWorkspaceRole(request, workspaceId, [...workspaceRoles]);
    if (!getProject({ workspaceId, projectId })) {
      return Response.json({ error: "Project not found." }, { status: 404 });
    }
    const parsed = assignmentSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "Choose a workspace Owner or Designer." }, { status: 400 });
    if (parsed.data.pdInChargeUserId && !listProjectPdCandidates(workspaceId).some((member) => member.id === parsed.data.pdInChargeUserId)) {
      return Response.json({ error: "The PD in charge must be a workspace Owner or Designer." }, { status: 400 });
    }
    if (!assignProjectPdInCharge({ workspaceId, projectId, pdInChargeUserId: parsed.data.pdInChargeUserId })) {
      return Response.json({ error: "Project not found." }, { status: 404 });
    }
    return Response.json({ pdInChargeUserId: parsed.data.pdInChargeUserId });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
