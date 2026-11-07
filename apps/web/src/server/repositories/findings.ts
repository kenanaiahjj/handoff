import { randomUUID } from "node:crypto";
import { getDatabase } from "../db";

export type FindingComment = {
  id: string;
  findingKey: string;
  authorUserId: string;
  authorName: string;
  body: string;
  createdAt: string;
};

export function listFindingStates(input: { workspaceId: string; versionId: string }) {
  return getDatabase()
    .prepare(
      `SELECT finding_key AS findingKey, status, assignee_user_id AS assigneeUserId,
              note, updated_by_user_id AS updatedBy, updated_at AS updatedAt
       FROM layout_finding_state
       WHERE workspace_id = ? AND handoff_version_id = ?`,
    )
    .all(input.workspaceId, input.versionId);
}

export function listFindingComments(input: { workspaceId: string; versionId: string }) {
  return getDatabase()
    .prepare(
      `SELECT comment.id, comment.finding_key AS findingKey,
              comment.author_user_id AS authorUserId, "user".name AS authorName,
              comment.body, comment.created_at AS createdAt
       FROM layout_finding_comment AS comment
       JOIN "user" ON "user".id = comment.author_user_id
       WHERE comment.workspace_id = ? AND comment.handoff_version_id = ?
       ORDER BY comment.created_at, comment.id`,
    )
    .all(input.workspaceId, input.versionId) as FindingComment[];
}

export function createFindingComment(input: {
  workspaceId: string;
  versionId: string;
  findingKey: string;
  authorUserId: string;
  body: string;
}) {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const database = getDatabase();
  database
    .prepare(
      `INSERT INTO layout_finding_comment
        (id, workspace_id, handoff_version_id, finding_key, author_user_id, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, input.workspaceId, input.versionId, input.findingKey, input.authorUserId, input.body, createdAt);

  return database
    .prepare(
      `SELECT comment.id, comment.finding_key AS findingKey,
              comment.author_user_id AS authorUserId, "user".name AS authorName,
              comment.body, comment.created_at AS createdAt
       FROM layout_finding_comment AS comment
       JOIN "user" ON "user".id = comment.author_user_id
       WHERE comment.id = ?`,
    )
    .get(id) as FindingComment;
}

export function saveFindingState(input: {
  workspaceId: string;
  versionId: string;
  findingKey: string;
  status: "open" | "resolved";
  assigneeUserId: string | null;
  note: string | null;
  updatedBy: string;
}) {
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `INSERT INTO layout_finding_state
        (id, workspace_id, handoff_version_id, finding_key, status,
         assignee_user_id, note, updated_by_user_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (handoff_version_id, finding_key) DO UPDATE SET
         status = excluded.status,
         assignee_user_id = excluded.assignee_user_id,
         note = excluded.note,
         updated_by_user_id = excluded.updated_by_user_id,
         updated_at = excluded.updated_at`,
    )
    .run(
      randomUUID(),
      input.workspaceId,
      input.versionId,
      input.findingKey,
      input.status,
      input.assigneeUserId,
      input.note,
      input.updatedBy,
      now,
    );
  return { updatedAt: now };
}
