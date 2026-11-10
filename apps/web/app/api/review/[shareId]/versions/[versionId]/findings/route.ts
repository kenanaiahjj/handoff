import { z } from "zod";
import { getDatabase } from "@/src/server/db";
import { createFindingComment, listFindingComments, listFindingStates, saveFindingState } from "@/src/server/repositories/findings";
import { getProject } from "@/src/server/repositories/projects";
import { getVisiblePublishedReviewVersion, resolvePublishedReviewAccess } from "@/src/server/services/handoff-review-access";
import { evaluateLayoutRules } from "@/src/server/services/layout-rules";

type ReviewFindingsRoute = { params: Promise<{ shareId: string; versionId: string }> };

const updateFindingSchema = z.object({
  status: z.enum(["open", "resolved"]),
  assigneeUserId: z.string().nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
});
const createFindingCommentSchema = z.object({ body: z.string().trim().min(1).max(4000) });

async function load(request: Request, context: ReviewFindingsRoute) {
  const { shareId, versionId } = await context.params;
  const access = await resolvePublishedReviewAccess(shareId, request.headers);
  if (!access) return { response: Response.json({ error: "Published handoff not found." }, { status: 404 }) };
  if (!access.decision.allowed) return { response: Response.json({ error: "This handoff is not available to you." }, { status: access.session ? 404 : 401 }) };
  const project = getProject({ workspaceId: access.handoff.workspaceId, projectId: access.handoff.projectId });
  const version = getVisiblePublishedReviewVersion(access.handoff, versionId);
  if (!project || !version) return { response: Response.json({ error: "Handoff version not found." }, { status: 404 }) };
  return { access, project, version, versionId };
}

export async function GET(request: Request, context: ReviewFindingsRoute) {
  const loaded = await load(request, context);
  if ("response" in loaded) return loaded.response;
  const workspaceId = loaded.access.handoff.workspaceId;
  const evaluated = evaluateLayoutRules(loaded.version.snapshot, loaded.project.rules);
  const states = listFindingStates({ workspaceId, versionId: loaded.versionId }) as Array<{
    findingKey: string;
    status: "open" | "resolved";
    assigneeUserId: string | null;
    note: string | null;
    updatedAt: string;
  }>;
  const comments = listFindingComments({ workspaceId, versionId: loaded.versionId });
  const commentsByFindingKey = new Map<string, typeof comments>();
  for (const comment of comments) {
    const findingComments = commentsByFindingKey.get(comment.findingKey) ?? [];
    findingComments.push(comment);
    commentsByFindingKey.set(comment.findingKey, findingComments);
  }
  const stateByKey = new Map(states.map((state) => [state.findingKey, state]));
  const findings = evaluated.findings.map((finding) => {
    const state = stateByKey.get(finding.findingKey);
    return {
      ...finding,
      status: state?.status ?? "open",
      assigneeUserId: loaded.access.membershipRole ? state?.assigneeUserId ?? null : null,
      note: state?.note ?? null,
      comments: commentsByFindingKey.get(finding.findingKey) ?? [],
    };
  });
  const members = loaded.access.membershipRole
    ? getDatabase()
      .prepare(
        `SELECT "user".id, "user".name
         FROM workspace_membership
         JOIN "user" ON "user".id = workspace_membership.user_id
         WHERE workspace_membership.workspace_id = ?
         ORDER BY "user".name`,
      )
      .all(workspaceId)
    : [];
  return Response.json({ findings, unsupportedReason: evaluated.unsupportedReason, members }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, context: ReviewFindingsRoute) {
  const loaded = await load(request, context);
  if ("response" in loaded) return loaded.response;
  if (!loaded.access.decision.canWrite || !loaded.access.session) return Response.json({ error: "You cannot comment on findings in this handoff." }, { status: 403 });
  const findingKey = new URL(request.url).searchParams.get("findingKey");
  if (!findingKey) return Response.json({ error: "Finding key is required." }, { status: 400 });
  const parsed = createFindingCommentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Enter a comment with up to 4,000 characters." }, { status: 400 });
  const knownFinding = evaluateLayoutRules(loaded.version.snapshot, loaded.project.rules).findings
    .some((finding) => finding.findingKey === findingKey);
  if (!knownFinding) return Response.json({ error: "Finding not found for this snapshot." }, { status: 404 });
  const comment = createFindingComment({
    workspaceId: loaded.access.handoff.workspaceId,
    versionId: loaded.versionId,
    findingKey,
    authorUserId: loaded.access.session.user.id,
    body: parsed.data.body,
  });
  return Response.json({ comment }, { status: 201 });
}

export async function PATCH(request: Request, context: ReviewFindingsRoute) {
  const loaded = await load(request, context);
  if ("response" in loaded) return loaded.response;
  if (!loaded.access.decision.canWrite || !loaded.access.membershipRole || !loaded.access.session) {
    return Response.json({ error: "Only workspace members can update finding status and ownership." }, { status: 403 });
  }
  const findingKey = new URL(request.url).searchParams.get("findingKey");
  if (!findingKey) return Response.json({ error: "Finding key is required." }, { status: 400 });
  const parsed = updateFindingSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Check the finding status, assignee, and note." }, { status: 400 });
  const knownFinding = evaluateLayoutRules(loaded.version.snapshot, loaded.project.rules).findings
    .some((finding) => finding.findingKey === findingKey);
  if (!knownFinding) return Response.json({ error: "Finding not found for this snapshot." }, { status: 404 });
  const assigneeUserId = parsed.data.assigneeUserId ?? null;
  if (assigneeUserId) {
    const isMember = getDatabase()
      .prepare("SELECT 1 FROM workspace_membership WHERE workspace_id = ? AND user_id = ?")
      .get(loaded.access.handoff.workspaceId, assigneeUserId);
    if (!isMember) return Response.json({ error: "The assignee must belong to this workspace." }, { status: 400 });
  }
  const state = saveFindingState({
    workspaceId: loaded.access.handoff.workspaceId,
    versionId: loaded.versionId,
    findingKey,
    status: parsed.data.status,
    assigneeUserId,
    note: parsed.data.note?.trim() || null,
    updatedBy: loaded.access.session.user.id,
  });
  return Response.json(state);
}
