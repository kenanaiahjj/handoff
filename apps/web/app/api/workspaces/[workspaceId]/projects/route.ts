import { z } from "zod";
import { filterProjectsForViewer } from "@/src/server/services/review-visibility";
import { createProject, listProjects } from "@/src/server/repositories/projects";
import {
  managerRoles,
  requireWorkspaceRole,
  WorkspaceAccessError,
  workspaceRoles,
} from "@/src/server/workspace-access";

const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

export async function GET(
  request: Request,
  context: RouteContext<"/api/workspaces/[workspaceId]/projects">,
) {
  const { workspaceId } = await context.params;

  try {
    const access = await requireWorkspaceRole(request, workspaceId, [...workspaceRoles]);
    const projects = filterProjectsForViewer(
      workspaceId,
      { id: access.userId, email: access.email, role: access.role },
      listProjects(workspaceId) as Array<{ id: string; handoffCount: number; versionCount: number }>,
    );
    return Response.json({ projects });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

export async function POST(
  request: Request,
  context: RouteContext<"/api/workspaces/[workspaceId]/projects">,
) {
  const { workspaceId } = await context.params;

  try {
    const access = await requireWorkspaceRole(request, workspaceId, managerRoles);
    const parsed = createProjectSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json({ error: "Enter a project name under 80 characters." }, { status: 400 });
    }

    const project = createProject({
      workspaceId,
      createdBy: access.userId,
      name: parsed.data.name,
    });
    return Response.json({ project }, { status: 201 });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
      return Response.json({ error: "A project with that name already exists in this workspace." }, { status: 409 });
    }
    throw error;
  }
}
