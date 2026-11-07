import { z } from "zod";
import { createProject, listProjects } from "@/src/server/repositories/projects";
import {
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
    await requireWorkspaceRole(request, workspaceId, [...workspaceRoles]);
    return Response.json({ projects: listProjects(workspaceId) });
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
    const access = await requireWorkspaceRole(request, workspaceId, [...workspaceRoles]);
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
