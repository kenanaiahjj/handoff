import { randomUUID } from "node:crypto";
import { getDatabase } from "../db";
import type { HandoffInviteRole } from "../services/handoff-sharing";

export async function listHandoffComments(input: { workspaceId: string; versionId: string }) {
  return (await getDatabase()
    .prepare(
      `SELECT comment.id, comment.workspace_id AS workspaceId,
              comment.handoff_version_id AS versionId, comment.frame_id AS frameId,
              comment.source_node_id AS sourceNodeId, comment.x, comment.y,
              comment.parent_comment_id AS parentCommentId, comment.body,
              comment.resolved_at AS resolvedAt,
              comment.resolved_by_user_id AS resolvedBy,
              comment.created_by_user_id AS createdBy,
              COALESCE(comment.author_label, author.name) AS authorName,
              CASE WHEN comment.author_label IS NULL THEN author.image END AS authorImage,
              comment.author_role AS authorRole, comment.created_at AS createdAt
       FROM handoff_comment AS comment
       LEFT JOIN "user" AS author ON author.id = comment.created_by_user_id
       WHERE comment.workspace_id = ? AND comment.handoff_version_id = ?
       ORDER BY comment.created_at ASC
       LIMIT 2000`,
    )
    .all(input.workspaceId, input.versionId));
}

export async function listHandoffCommentsPage(input: { workspaceId: string; versionId: string; offset: number; limit: number }) {
  const database = getDatabase();
  const total = ((await database
    .prepare("SELECT COUNT(*) AS total FROM handoff_comment WHERE workspace_id = ? AND handoff_version_id = ?")
    .get(input.workspaceId, input.versionId)) as { total: number }).total;
  const items = (await database
    .prepare(
      `SELECT comment.id, comment.workspace_id AS workspaceId,
              comment.handoff_version_id AS versionId, comment.frame_id AS frameId,
              comment.source_node_id AS sourceNodeId, comment.x, comment.y,
              comment.parent_comment_id AS parentCommentId, comment.body,
              comment.resolved_at AS resolvedAt,
              comment.resolved_by_user_id AS resolvedBy,
              comment.created_by_user_id AS createdBy,
              COALESCE(comment.author_label, author.name) AS authorName,
              CASE WHEN comment.author_label IS NULL THEN author.image END AS authorImage,
              comment.author_role AS authorRole, comment.created_at AS createdAt
       FROM handoff_comment AS comment
       LEFT JOIN "user" AS author ON author.id = comment.created_by_user_id
       WHERE comment.workspace_id = ? AND comment.handoff_version_id = ?
       ORDER BY comment.created_at ASC, comment.id ASC
       LIMIT ? OFFSET ?`,
    )
    .all(input.workspaceId, input.versionId, input.limit, input.offset));

  return { items, total };
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
  createdBy?: string | null;
  createdByInviteId?: string | null;
  authorLabel?: string | null;
  authorRole?: HandoffInviteRole | null;
};

export async function createHandoffComment(input: CreateCommentInput) {
  const id = randomUUID();
  const now = new Date().toISOString();
  (await getDatabase()
    .prepare(
      `INSERT INTO handoff_comment
        (id, workspace_id, handoff_version_id, frame_id, source_node_id,
         x, y, parent_comment_id, body, created_by_user_id, created_by_invite_id,
         author_label, author_role, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      input.createdBy ?? null,
      input.createdByInviteId ?? null,
      input.authorLabel ?? null,
      input.authorRole ?? null,
      now,
    ));
  return { id, createdAt: now };
}

export async function setCommentResolved(input: {
  workspaceId: string;
  versionId: string;
  commentId: string;
  resolved: boolean;
  /** Null when a link-based invitee resolves without a signed-in account. */
  updatedBy: string | null;
}) {
  const result = (await getDatabase()
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
    ));
  return result.changes === 1;
}
