import { z } from "zod";
import { getHandoff } from "@/src/server/repositories/handoffs";
import { listLinkedExternalTasks, updateLinkedExternalTaskWorkLinks } from "@/src/server/repositories/linked-external-tasks";
import { getProject as getProjectWithRules } from "@/src/server/repositories/projects";
import { getVersion } from "@/src/server/repositories/versions";
import { linkExternalTaskToHandoff } from "@/src/server/services/link-external-task";
import { TaskDesignContextError, taskLinkRequestSchema } from "@/src/server/services/task-context";
import { requireWorkspaceRole, WorkspaceAccessError, workspaceRoles } from "@/src/server/workspace-access";

type TasksRoute = { params: Promise<{ workspaceId: string; projectId: string; handoffId: string }> };

const optionalUrlSchema = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? null : value,
  z.string().trim().max(2000).nullable(),
);
const updateAgentLinksSchema = z.object({
  taskId: z.string().uuid(),
  agentRunUrl: optionalUrlSchema,
  pullRequestUrl: optionalUrlSchema,
}).superRefine((value, context) => {
  for (const field of ["agentRunUrl", "pullRequestUrl"] as const) {
    const raw = value[field];
    if (!raw) continue;
    let url: URL;
    try { url = new URL(raw); } catch {
      context.addIssue({ code: "custom", message: "Enter a valid HTTPS URL.", path: [field] });
      continue;
    }
    const localHttp = process.env.NODE_ENV !== "production" && url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "https:" && !localHttp) || url.username || url.password) {
      context.addIssue({ code: "custom", message: "Use an HTTPS URL without embedded credentials.", path: [field] });
    }
  }
});

export async function GET(request: Request, context: TasksRoute) {
  const { workspaceId, projectId, handoffId } = await context.params;
  try {
    await requireWorkspaceRole(request, workspaceId, [...workspaceRoles]);
    if (!getHandoff({ workspaceId, projectId, handoffId }) || !getProjectWithRules({ workspaceId, projectId })) {
      return Response.json({ error: "Handoff not found." }, { status: 404 });
    }
    return Response.json({ tasks: listLinkedExternalTasks({ workspaceId, handoffId }) });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

export async function POST(request: Request, context: TasksRoute) {
  const { workspaceId, projectId, handoffId } = await context.params;
  try {
    const actor = await requireWorkspaceRole(request, workspaceId, [...workspaceRoles]);
    const handoff = getHandoff({ workspaceId, projectId, handoffId });
    const projectWithRules = getProjectWithRules({ workspaceId, projectId });
    if (!handoff || !projectWithRules) return Response.json({ error: "Handoff not found." }, { status: 404 });
    const parsed = taskLinkRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "Provide an external task ID or URL, a title, and a valid version." }, { status: 400 });
    const version = getVersion({ workspaceId, versionId: parsed.data.versionId });
    if (!version || version.handoffId !== handoffId) return Response.json({ error: "Version not found in this handoff." }, { status: 404 });
    const baseUrl = process.env.BETTER_AUTH_URL || new URL(request.url).origin;
    const canvasPath = handoff.reviewShareId
      ? `/review/${encodeURIComponent(handoff.reviewShareId)}`
      : `/workspace/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/handoffs/${encodeURIComponent(handoffId)}`;
    const handoffUrl = new URL(`${canvasPath}?versionId=${encodeURIComponent(version.id)}`, baseUrl).toString();
    const task = linkExternalTaskToHandoff({
      workspaceId,
      handoffId,
      version,
      handoffUrl,
      task: parsed.data,
      createdBy: actor.userId,
    });
    return Response.json({ task }, { status: 201 });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof TaskDesignContextError) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ error: error instanceof Error ? error.message : "Could not link the task." }, { status: 502 });
  }
}

export async function PATCH(request: Request, context: TasksRoute) {
  const { workspaceId, projectId, handoffId } = await context.params;
  try {
    await requireWorkspaceRole(request, workspaceId, [...workspaceRoles]);
    if (!getHandoff({ workspaceId, projectId, handoffId })) {
      return Response.json({ error: "Handoff not found." }, { status: 404 });
    }
    const parsed = updateAgentLinksSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "Enter valid agent and pull request URLs." }, { status: 400 });
    const updated = updateLinkedExternalTaskWorkLinks({
      workspaceId,
      handoffId,
      taskId: parsed.data.taskId,
      agentRunUrl: parsed.data.agentRunUrl,
      pullRequestUrl: parsed.data.pullRequestUrl,
    });
    if (!updated) return Response.json({ error: "Linked task not found." }, { status: 404 });
    const task = (listLinkedExternalTasks({ workspaceId, handoffId }) as Array<Record<string, unknown>>)
      .find((candidate) => candidate.id === parsed.data.taskId);
    return Response.json({ task });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
