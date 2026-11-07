import { z } from "zod";
import { getDatabase } from "@/src/server/db";
import { getHandoff } from "@/src/server/repositories/handoffs";
import {
  createFindingComment,
  listFindingComments,
  listFindingStates,
  saveFindingState,
} from "@/src/server/repositories/findings";
import { getProject } from "@/src/server/repositories/projects";
import { getVersion } from "@/src/server/repositories/versions";
import { evaluateLayoutRules } from "@/src/server/services/layout-rules";
import {
  requireWorkspaceRole,
  WorkspaceAccessError,
  workspaceRoles,
} from "@/src/server/workspace-access";

type FindingsRoute = {
  params: Promise<{ workspaceId: string; projectId: string; handoffId: string; versionId: string }>;
};

const updateFindingSchema = z.object({
  status: z.enum(["open", "resolved"]),
  assigneeUserId: z.string().nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
});

const createFindingCommentSchema = z.object({
  body: z.string().trim().min(1).max(4000),
});

async function loadFindingContext(request: Request, context: FindingsRoute) {
  const ids = await context.params;
  const access = await requireWorkspaceRole(request, ids.workspaceId, [...workspaceRoles]);
  const handoff = getHandoff({ workspaceId: ids.workspaceId, projectId: ids.projectId, handoffId: ids.handoffId });
  const project = getProject({ workspaceId: ids.workspaceId, projectId: ids.projectId });
  const version = getVersion({ workspaceId: ids.workspaceId, versionId: ids.versionId });
  if (!handoff || !project || !version || version.handoffId !== ids.handoffId) return null;
  return { ...ids, access, project, version };
}

export async function GET(request: Request, context: FindingsRoute) {
  try {
    const loaded = await loadFindingContext(request, context);
    if (!loaded) return Response.json({ error: "Handoff version not found." }, { status: 404 });

    const evaluated = evaluateLayoutRules(loaded.version.snapshot, loaded.project.rules);
    const states = listFindingStates({ workspaceId: loaded.workspaceId, versionId: loaded.versionId }) as Array<{
      findingKey: string;
      status: "open" | "resolved";
      assigneeUserId: string | null;
      note: string | null;
      updatedAt: string;
    }>;
    const comments = listFindingComments({ workspaceId: loaded.workspaceId, versionId: loaded.versionId });
    const commentsByFindingKey = new Map<string, typeof comments>();
    for (const comment of comments) {
      const findingComments = commentsByFindingKey.get(comment.findingKey) ?? [];
      findingComments.push(comment);
      commentsByFindingKey.set(comment.findingKey, findingComments);
    }
    const stateByKey = new Map(states.map((state) => [state.findingKey, state]));
    const findings = evaluated.findings.map((finding) => ({
      ...finding,
      status: stateByKey.get(finding.findingKey)?.status ?? "open",
      assigneeUserId: stateByKey.get(finding.findingKey)?.assigneeUserId ?? null,
      note: stateByKey.get(finding.findingKey)?.note ?? null,
      comments: commentsByFindingKey.get(finding.findingKey) ?? [],
    }));
    const members = getDatabase()
      .prepare(
        `SELECT "user".id, "user".name
         FROM workspace_membership
         JOIN "user" ON "user".id = workspace_membership.user_id
         WHERE workspace_membership.workspace_id = ?
         ORDER BY "user".name`,
      )
      .all(loaded.workspaceId);
    return Response.json({ findings, unsupportedReason: evaluated.unsupportedReason, members });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

export async function POST(request: Request, context: FindingsRoute) {
  try {
    const loaded = await loadFindingContext(request, context);
    if (!loaded) return Response.json({ error: "Handoff version not found." }, { status: 404 });
    const findingKey = new URL(request.url).searchParams.get("findingKey");
    if (!findingKey) return Response.json({ error: "Finding key is required." }, { status: 400 });
    const parsed = createFindingCommentSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "Enter a comment with up to 4,000 characters." }, { status: 400 });

    const knownFinding = evaluateLayoutRules(loaded.version.snapshot, loaded.project.rules)
      .findings.some((finding) => finding.findingKey === findingKey);
    if (!knownFinding) return Response.json({ error: "Finding not found for this snapshot." }, { status: 404 });

    const comment = createFindingComment({
      workspaceId: loaded.workspaceId,
      versionId: loaded.versionId,
      findingKey,
      authorUserId: loaded.access.userId,
      body: parsed.data.body,
    });
    return Response.json({ comment }, { status: 201 });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

export async function PATCH(request: Request, context: FindingsRoute) {
  try {
    const loaded = await loadFindingContext(request, context);
    if (!loaded) return Response.json({ error: "Handoff version not found." }, { status: 404 });
    const findingKey = new URL(request.url).searchParams.get("findingKey");
    if (!findingKey) return Response.json({ error: "Finding key is required." }, { status: 400 });
    const parsed = updateFindingSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "Check the finding status, assignee, and note." }, { status: 400 });

    const knownFinding = evaluateLayoutRules(loaded.version.snapshot, loaded.project.rules)
      .findings.some((finding) => finding.findingKey === findingKey);
    if (!knownFinding) return Response.json({ error: "Finding not found for this snapshot." }, { status: 404 });
    const assigneeUserId = parsed.data.assigneeUserId ?? null;
    if (assigneeUserId) {
      const isMember = getDatabase()
        .prepare("SELECT 1 FROM workspace_membership WHERE workspace_id = ? AND user_id = ?")
        .get(loaded.workspaceId, assigneeUserId);
      if (!isMember) return Response.json({ error: "The assignee must belong to this workspace." }, { status: 400 });
    }

    const state = saveFindingState({
      workspaceId: loaded.workspaceId,
      versionId: loaded.versionId,
      findingKey,
      status: parsed.data.status,
      assigneeUserId,
      note: parsed.data.note?.trim() || null,
      updatedBy: loaded.access.userId,
    });
    return Response.json(state);
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
