import { getDatabase } from "../db";
import { plainCommentText } from "./mentions";
import type { HandoffReviewStatus } from "@/src/lib/handoff-status";

export const staleAfterDays = 7;

export type StaleHandoff = {
  handoffId: string;
  handoffName: string;
  projectId: string;
  projectName: string;
  reviewStatus: HandoffReviewStatus;
  lastActivityAt: string;
};

/**
 * Handoffs that aren't approved and haven't moved in a week: no new version, comment or status
 * change. These are the ones a PD should nudge or close out.
 */
export async function listStaleHandoffs(workspaceId: string, visible: Set<string> | null, now = new Date()): Promise<StaleHandoff[]> {
  const cutoff = new Date(now.getTime() - staleAfterDays * 24 * 60 * 60 * 1000).toISOString();
  const rows = (await getDatabase()
    .prepare(
      `SELECT handoff.id AS handoffId, handoff.name AS handoffName, project.id AS projectId, project.name AS projectName,
              handoff.review_status AS reviewStatus,
              GREATEST(
                MAX(handoff_version.created_at),
                COALESCE(MAX(handoff_comment.created_at), ''),
                COALESCE(handoff.review_status_at, '')
              ) AS lastActivityAt
       FROM handoff
       JOIN project ON project.id = handoff.project_id AND project.workspace_id = handoff.workspace_id
       JOIN handoff_version ON handoff_version.handoff_id = handoff.id
       LEFT JOIN handoff_comment ON handoff_comment.handoff_version_id = handoff_version.id
       WHERE handoff.workspace_id = ? AND handoff.review_status <> 'approved'
       GROUP BY handoff.id, project.id
       HAVING GREATEST(MAX(handoff_version.created_at), COALESCE(MAX(handoff_comment.created_at), ''), COALESCE(handoff.review_status_at, '')) < ?
       ORDER BY lastActivityAt ASC
       LIMIT 20`,
    )
    .all(workspaceId, cutoff)) as StaleHandoff[];
  return visible ? rows.filter((row) => visible.has(row.handoffId)) : rows;
}

export type ActivityEvent = {
  id: string;
  kind: "version" | "comment" | "status";
  at: string;
  actorName: string | null;
  actorImage: string | null;
  handoffId: string;
  handoffName: string;
  projectId: string;
  projectName: string;
  /** Version label, the comment's first line, or the new status. */
  detail: string;
};

/** What happened lately across the workspace: new versions, comments and status changes, newest first. */
export async function listWorkspaceActivity(workspaceId: string, visible: Set<string> | null, limit = 60): Promise<ActivityEvent[]> {
  const rows = (await getDatabase()
    .prepare(
      `SELECT * FROM (
         SELECT 'version:' || handoff_version.id AS id, 'version' AS kind, handoff_version.created_at AS at,
                "user".name AS actorName, "user".image AS actorImage, handoff.id AS handoffId, handoff.name AS handoffName,
                project.id AS projectId, project.name AS projectName, handoff_version.version_label AS detail
         FROM handoff_version
         JOIN handoff ON handoff.id = handoff_version.handoff_id
         JOIN project ON project.id = handoff.project_id
         LEFT JOIN "user" ON "user".id = handoff_version.created_by_user_id
         WHERE handoff_version.workspace_id = ?
         UNION ALL
         SELECT 'comment:' || handoff_comment.id, 'comment', handoff_comment.created_at,
                COALESCE(handoff_comment.author_label, "user".name), CASE WHEN handoff_comment.author_label IS NULL THEN "user".image END,
                handoff.id, handoff.name, project.id, project.name, left(handoff_comment.body, 400)
         FROM handoff_comment
         JOIN handoff_version ON handoff_version.id = handoff_comment.handoff_version_id
         JOIN handoff ON handoff.id = handoff_version.handoff_id
         JOIN project ON project.id = handoff.project_id
         LEFT JOIN "user" ON "user".id = handoff_comment.created_by_user_id
         WHERE handoff_comment.workspace_id = ?
         UNION ALL
         SELECT 'status:' || handoff.id || ':' || handoff.review_status_at, 'status', handoff.review_status_at,
                "user".name, "user".image, handoff.id, handoff.name, project.id, project.name, handoff.review_status
         FROM handoff
         JOIN project ON project.id = handoff.project_id
         LEFT JOIN "user" ON "user".id = handoff.review_status_by_user_id
         WHERE handoff.workspace_id = ? AND handoff.review_status_at IS NOT NULL
       ) AS events
       ORDER BY at DESC
       LIMIT ?`,
    )
    .all(workspaceId, workspaceId, workspaceId, visible ? limit * 3 : limit)) as ActivityEvent[];
  return (visible ? rows.filter((row) => visible.has(row.handoffId)) : rows)
    .slice(0, limit)
    .map((row) => (row.kind === "comment" ? { ...row, detail: plainCommentText(row.detail) } : row));
}
