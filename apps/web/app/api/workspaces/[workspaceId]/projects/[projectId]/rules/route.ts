import { projectRulesSchema } from "@/src/server/services/layout-rules";
import { getProject, setProjectRules } from "@/src/server/repositories/projects";
import {
  requireProjectMember,
  WorkspaceAccessError,
} from "@/src/server/workspace-access";

type ProjectRulesRoute = {
  params: Promise<{ workspaceId: string; projectId: string }>;
};

export async function PATCH(request: Request, context: ProjectRulesRoute) {
  const { workspaceId, projectId } = await context.params;
  try {
    await requireProjectMember(request, workspaceId, projectId);
    if (!getProject({ workspaceId, projectId })) {
      return Response.json({ error: "Project not found." }, { status: 404 });
    }
    const parsed = projectRulesSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json({ error: "Check the spacing values and frame limits." }, { status: 400 });
    }
    setProjectRules({ workspaceId, projectId, rulesJson: JSON.stringify(parsed.data) });
    return Response.json({ rules: parsed.data });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
