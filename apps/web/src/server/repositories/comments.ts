import { randomUUID } from "node:crypto";
import { getDatabase } from "../db";

export function listHandoffComments(input: { workspaceId: string; versionId: string }) {
  return getDatabase()
    .prepare(
      `SELECT comment.id, comment.workspace_id AS workspaceId,
              comment.handoff_version_id AS versionId, comment.frame_id AS frameId,
              comment.source_node_id AS sourceNodeId, comment.x, comment.y,
              comment.parent_comment_id AS parentCommentId, comment.body,
              comment.resolved_at AS resolvedAt,
              comment.resolved_by_user_id AS resolvedBy,
              comment.created_by_user_id AS createdBy,
              author.name AS authorName, comment.created_at AS createdAt
       FROM handoff_comment AS comment
       JOIN "user" AS author ON author.id = comment.created_by_user_id
       WHERE comment.workspace_id = ? AND comment.handoff_version_id = ?
       ORDER BY comment.created_at ASC
       LIMIT 2000`,
    )
    .all(input.workspaceId, input.versionId);
}

export type CreateCommentInput = {
  workspaceId: string;
  versionId: string;
  frameId: string;
  sourceNodeId?: string | null;
  x: number | null;
  y: number | null;
  parentCommentId?: string | null;
  body: string;
  createdBy: string;
};

export function createHandoffComment(input: CreateCommentInput) {
  const id = randomUUID();
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `INSERT INTO handoff_comment
        (id, workspace_id, handoff_version_id, frame_id, source_node_id,
         x, y, parent_comment_id, body, created_by_user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.workspaceId,
      input.versionId,
      input.frameId,
      input.sourceNodeId ?? null,
      input.x,
      input.y,
      input.parentCommentId ?? null,
      input.body.trim(),
      input.createdBy,
      now,
    );
  return { id, createdAt: now };
}

export function setCommentResolved(input: {
  workspaceId: string;
  versionId: string;
  commentId: string;
  resolved: boolean;
  updatedBy: string;
}) {
  const result = getDatabase()
    .prepare(
      `UPDATE handoff_comment
       SET resolved_at = ?, resolved_by_user_id = ?
       WHERE id = ? AND workspace_id = ? AND handoff_version_id = ? AND parent_comment_id IS NULL`,
    )
    .run(
      input.resolved ? new Date().toISOString() : null,
      input.resolved ? input.updatedBy : null,
      input.commentId,
      input.workspaceId,
      input.versionId,
    );
  return result.changes === 1;
}
