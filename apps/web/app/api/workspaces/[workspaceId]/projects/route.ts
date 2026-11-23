import { z } from "zod";
import { filterProjectsForViewer } from "@/src/server/services/review-visibility";
import { createProject, listProjects } from "@/src/server/repositories/projects";
import { isUniqueConstraintViolation } from "@/src/server/db";
import { projectSlugs } from "@/src/server/services/route-slugs";
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
    const projects = (await filterProjectsForViewer(
      workspaceId,
      { id: access.userId, email: access.email, role: access.role },
      (await listProjects(workspaceId)) as Array<{ id: string; handoffCount: number; versionCount: number }>,
    ));
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

    const project = (await createProject({
      workspaceId,
      createdBy: access.userId,
      name: parsed.data.name,
    }));
    const slug = (await projectSlugs(workspaceId)).get(project.id) ?? project.id;
    return Response.json({ project, projectHref: `/projects/${encodeURIComponent(slug)}` }, { status: 201 });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    if (isUniqueConstraintViolation(error)) {
      return Response.json({ error: "A project with that name already exists in this workspace." }, { status: 409 });
    }
    throw error;
  }
}
