import { z } from "zod";
import { getDatabase } from "@/src/server/db";
import { getHandoff } from "@/src/server/repositories/handoffs";
import { createHandoffComment, listHandoffComments } from "@/src/server/repositories/comments";
import { getVersion, type StoredSnapshot } from "@/src/server/repositories/versions";
import { isStructuredSnapshot } from "@/src/server/services/diff";
import type { SnapshotFrame } from "@asbir/snapshot-contract";
import {
  requireWorkspaceRole,
  WorkspaceAccessError,
  workspaceRoles,
} from "@/src/server/workspace-access";

type CommentsRoute = {
  params: Promise<{ workspaceId: string; projectId: string; handoffId: string; versionId: string }>;
};

const createCommentSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  frameId: z.string().trim().min(1).optional(),
  sourceNodeId: z.string().trim().min(1).nullable().optional(),
  x: z.number().finite().nullable().optional(),
  y: z.number().finite().nullable().optional(),
  parentCommentId: z.string().uuid().nullable().optional(),
});

type CommentAnchor = {
  frameId: string;
  sourceNodeId: string | null;
  x: number | null;
  y: number | null;
};

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

  let width: number | null = null;
  let height: number | null = null;
  const asset = snapshot.assets.find((candidate) => candidate.key === frame.renderAssetKey);
  width = structuredFrame?.bounds.width.value ?? asset?.width ?? null;
  height = structuredFrame?.bounds.height.value ?? asset?.height ?? null;
  if (width === null || height === null || input.x < 0 || input.y < 0 || input.x > width || input.y > height) return null;

  return {
    frameId: input.frameId,
    sourceNodeId: input.sourceNodeId ?? null,
    x: input.x,
    y: input.y,
  };
}

export async function GET(request: Request, context: CommentsRoute) {
  const { workspaceId, projectId, handoffId, versionId } = await context.params;
  try {
    await requireWorkspaceRole(request, workspaceId, [...workspaceRoles]);
    const handoff = getHandoff({ workspaceId, projectId, handoffId });
    const version = getVersion({ workspaceId, versionId });
    if (!handoff || !version || version.handoffId !== handoffId) {
      return Response.json({ error: "Handoff version not found." }, { status: 404 });
    }
    return Response.json({ comments: listHandoffComments({ workspaceId, versionId }) });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

export async function POST(request: Request, context: CommentsRoute) {
  const { workspaceId, projectId, handoffId, versionId } = await context.params;
  try {
    const access = await requireWorkspaceRole(request, workspaceId, [...workspaceRoles]);
    const handoff = getHandoff({ workspaceId, projectId, handoffId });
    const version = getVersion({ workspaceId, versionId });
    if (!handoff || !version || version.handoffId !== handoffId) {
      return Response.json({ error: "Handoff version not found." }, { status: 404 });
    }

    let body: unknown;
    try { body = await request.json(); } catch { return Response.json({ error: "Enter a comment." }, { status: 400 }); }
    const parsed = createCommentSchema.safeParse(body);
    if (!parsed.success) return Response.json({ error: "Enter a comment with at most 4,000 characters." }, { status: 400 });

    let anchor: CommentAnchor | null;
    let parentCommentId: string | null = parsed.data.parentCommentId ?? null;
    if (parentCommentId) {
      const root = getDatabase()
        .prepare(
          `SELECT frame_id AS frameId, source_node_id AS sourceNodeId, x, y
           FROM handoff_comment
           WHERE id = ? AND workspace_id = ? AND handoff_version_id = ? AND parent_comment_id IS NULL`,
        )
        .get(parentCommentId, workspaceId, versionId) as CommentAnchor | undefined;
      if (!root) return Response.json({ error: "The comment thread was not found." }, { status: 404 });
      anchor = root;
    } else {
      anchor = snapshotAnchor(version.snapshot, parsed.data);
      if (!anchor) return Response.json({ error: "Choose a valid point on a frame before posting the comment." }, { status: 400 });
    }

    const created = createHandoffComment({
      workspaceId,
      versionId,
      ...anchor,
      parentCommentId,
      body: parsed.data.body,
      createdBy: access.userId,
    });
    return Response.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
