import { randomUUID } from "node:crypto";
import { getDatabase } from "../db";

export type HandoffAnnotation = {
  id: string;
  versionId: string;
  frameId: string;
  sourceNodeId: string | null;
  x: number;
  y: number;
  title: string;
  body: string;
  createdBy: string;
  authorName: string;
  createdAt: string;
  updatedAt: string;
};

export function listHandoffAnnotations(input: { workspaceId: string; versionId: string }) {
  return getDatabase()
    .prepare(
      `SELECT handoff_annotation.id, handoff_version_id AS versionId,
              frame_id AS frameId, source_node_id AS sourceNodeId,
              x, y, title, body, created_by_user_id AS createdBy,
              "user".name AS authorName, created_at AS createdAt, updated_at AS updatedAt
       FROM handoff_annotation
       JOIN "user" ON "user".id = handoff_annotation.created_by_user_id
       WHERE handoff_annotation.workspace_id = ? AND handoff_version_id = ?
       ORDER BY handoff_annotation.created_at, handoff_annotation.id`,
    )
    .all(input.workspaceId, input.versionId) as HandoffAnnotation[];
}

export function createHandoffAnnotation(input: {
  workspaceId: string;
  versionId: string;
  frameId: string;
  sourceNodeId: string | null;
  x: number;
  y: number;
  title: string;
  body: string;
  createdBy: string;
}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `INSERT INTO handoff_annotation
        (id, workspace_id, handoff_version_id, frame_id, source_node_id, x, y,
         title, body, created_by_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, input.workspaceId, input.versionId, input.frameId, input.sourceNodeId,
      input.x, input.y, input.title.trim(), input.body.trim(), input.createdBy, now, now);
  return getDatabase()
    .prepare(
      `SELECT handoff_annotation.id, handoff_version_id AS versionId,
              frame_id AS frameId, source_node_id AS sourceNodeId,
              x, y, title, body, created_by_user_id AS createdBy,
              "user".name AS authorName, created_at AS createdAt, updated_at AS updatedAt
       FROM handoff_annotation
       JOIN "user" ON "user".id = handoff_annotation.created_by_user_id
       WHERE handoff_annotation.id = ? AND handoff_annotation.workspace_id = ?`,
    )
    .get(id, input.workspaceId) as HandoffAnnotation;
}

export function updateHandoffAnnotation(input: {
  workspaceId: string;
  versionId: string;
  annotationId: string;
  title: string;
  body: string;
}) {
  const result = getDatabase()
    .prepare(
      `UPDATE handoff_annotation SET title = ?, body = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ? AND handoff_version_id = ?`,
    )
    .run(input.title.trim(), input.body.trim(), new Date().toISOString(), input.annotationId, input.workspaceId, input.versionId);
  return result.changes === 1;
}

export function deleteHandoffAnnotation(input: { workspaceId: string; versionId: string; annotationId: string }) {
  const result = getDatabase()
    .prepare("DELETE FROM handoff_annotation WHERE id = ? AND workspace_id = ? AND handoff_version_id = ?")
    .run(input.annotationId, input.workspaceId, input.versionId);
  return result.changes === 1;
}
