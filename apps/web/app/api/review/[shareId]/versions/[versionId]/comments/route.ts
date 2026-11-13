import { z } from "zod";
import { getDatabase } from "@/src/server/db";
import { createHandoffComment, listHandoffComments } from "@/src/server/repositories/comments";
import { getVisiblePublishedReviewVersion, resolvePublishedReviewAccess } from "@/src/server/services/handoff-review-access";
import { isStructuredSnapshot } from "@/src/server/services/diff";
import type { SnapshotFrame } from "@asbir/snapshot-contract";
import type { StoredSnapshot } from "@/src/server/repositories/versions";

type ReviewCommentsRoute = { params: Promise<{ shareId: string; versionId: string }> };

const createCommentSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  frameId: z.string().trim().min(1).optional(),
  sourceNodeId: z.string().trim().min(1).nullable().optional(),
  x: z.number().finite().nullable().optional(),
  y: z.number().finite().nullable().optional(),
  parentCommentId: z.string().uuid().nullable().optional(),
});

type CommentAnchor = { frameId: string; sourceNodeId: string | null; x: number | null; y: number | null };

function isStructuredFrame(frame: StoredSnapshot["frames"][number]): frame is SnapshotFrame {
  return "bounds" in frame && "nodes" in frame;
}

function snapshotAnchor(snapshot: StoredSnapshot, input: {
  frameId?: string;
  sourceNodeId?: string | null;
  x?: number | null;
  y?: number | null;
}): CommentAnchor | null {
  if (!input.frameId || input.x === null || input.x === undefined || input.y === null || input.y === undefined) return null;
  if (input.frameId === "__overview__") {
    const overview = snapshot.assets.find((asset) => asset.key === snapshot.overviewAssetKey);
    if (!overview) return null;
    const structured = isStructuredSnapshot(snapshot);
    const nodeExists = structured && input.sourceNodeId
      ? snapshot.frames.some((frame) => frame.nodes.some((node) => node.sourceNodeId === input.sourceNodeId))
      : !input.sourceNodeId;
    if (!nodeExists) return null;
    const width = structured ? snapshot.canvasBounds?.width.value ?? overview.width ?? null : overview.width ?? null;
    const height = structured ? snapshot.canvasBounds?.height.value ?? overview.height ?? null : overview.height ?? null;
    if (width === null || height === null || input.x < 0 || input.y < 0 || input.x > width || input.y > height) return null;
    return { frameId: input.frameId, sourceNodeId: input.sourceNodeId ?? null, x: input.x, y: input.y };
  }

  const frame = snapshot.frames.find((candidate) => candidate.sourceFrameId === input.frameId);
  if (!frame) return null;
  const structuredFrame = isStructuredFrame(frame) ? frame : null;
  const node = structuredFrame && input.sourceNodeId
    ? structuredFrame.nodes.find((candidate) => candidate.sourceNodeId === input.sourceNodeId)
    : null;
  if (input.sourceNodeId && !node) return null;
  const asset = snapshot.assets.find((candidate) => candidate.key === frame.renderAssetKey);
  const width = structuredFrame?.bounds.width.value ?? asset?.width ?? null;
  const height = structuredFrame?.bounds.height.value ?? asset?.height ?? null;
  if (width === null || height === null || input.x < 0 || input.y < 0 || input.x > width || input.y > height) return null;
  return { frameId: input.frameId, sourceNodeId: input.sourceNodeId ?? null, x: input.x, y: input.y };
}

function accessError(access: Awaited<ReturnType<typeof resolvePublishedReviewAccess>>) {
  if (!access) return Response.json({ error: "Published handoff not found." }, { status: 404 });
  return Response.json({ error: "This handoff is not available to you." }, { status: access.session ? 404 : 401 });
}

export async function GET(request: Request, context: ReviewCommentsRoute) {
  const { shareId, versionId } = await context.params;
  const access = await resolvePublishedReviewAccess(shareId, request.headers);
  if (!access?.decision.allowed) return accessError(access);
  const version = getVisiblePublishedReviewVersion(access.handoff, versionId);
  if (!version) return Response.json({ error: "Handoff version not found." }, { status: 404 });
  return Response.json({ comments: listHandoffComments({ workspaceId: access.handoff.workspaceId, versionId }) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, context: ReviewCommentsRoute) {
  const { shareId, versionId } = await context.params;
  const access = await resolvePublishedReviewAccess(shareId, request.headers);
  if (!access?.decision.allowed) return accessError(access);
  if (!access.decision.canComment) return Response.json({ error: "This invitation does not allow comments." }, { status: 403 });
  const version = getVisiblePublishedReviewVersion(access.handoff, versionId);
  if (!version) return Response.json({ error: "Handoff version not found." }, { status: 404 });
  const parsed = createCommentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Enter a comment with at most 4,000 characters." }, { status: 400 });

  let anchor: CommentAnchor | null;
  let parentCommentId = parsed.data.parentCommentId ?? null;
  if (parentCommentId) {
    const root = getDatabase()
      .prepare(
        `SELECT frame_id AS frameId, source_node_id AS sourceNodeId, x, y
         FROM handoff_comment
         WHERE id = ? AND workspace_id = ? AND handoff_version_id = ? AND parent_comment_id IS NULL`,
      )
      .get(parentCommentId, access.handoff.workspaceId, versionId) as CommentAnchor | undefined;
    if (!root) return Response.json({ error: "The comment thread was not found." }, { status: 404 });
    anchor = root;
  } else {
    anchor = snapshotAnchor(version.snapshot, parsed.data);
    if (!anchor) return Response.json({ error: "Choose a valid point on a frame before posting the comment." }, { status: 400 });
  }

  const author = access.invite
    ? {
        createdByInviteId: access.invite.id,
        authorLabel: access.invite.email,
        authorRole: access.invite.role,
      }
    : access.session
      ? { createdBy: access.session.user.id, authorRole: null }
      : null;
  if (!author) return Response.json({ error: "Open this handoff with a valid invite link to comment." }, { status: 403 });

  const created = createHandoffComment({
    workspaceId: access.handoff.workspaceId,
    versionId,
    ...anchor,
    parentCommentId,
    body: parsed.data.body,
    ...author,
  });
  return Response.json(created, { status: 201 });
}
