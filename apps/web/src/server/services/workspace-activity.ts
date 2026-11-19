import { getDatabase } from "../db";
import { plainCommentText } from "./mentions";

export type ActivityEvent = {
  id: string;
  kind: "version" | "comment";
  at: string;
  actorName: string | null;
  actorImage: string | null;
  handoffId: string;
  handoffName: string;
  projectId: string;
  projectName: string;
  /** Version label, or the comment's first line. */
  detail: string;
};

/** What happened lately across the workspace: new versions and comments, newest first. */
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
       ) AS events
       ORDER BY at DESC
       LIMIT ?`,
    )
    .all(workspaceId, workspaceId, visible ? limit * 3 : limit)) as ActivityEvent[];
  return (visible ? rows.filter((row) => visible.has(row.handoffId)) : rows)
    .slice(0, limit)
    .map((row) => (row.kind === "comment" ? { ...row, detail: plainCommentText(row.detail) } : row));
}

export type RecentHandoff = {
  handoffId: string;
  handoffName: string;
  projectId: string;
  projectName: string;
  versionLabel: string;
  versionCount: number;
  updatedAt: string;
};

/** Handoffs with the newest versions first, for the dashboard. */
export async function listRecentHandoffs(workspaceId: string, visible: Set<string> | null, limit = 6): Promise<RecentHandoff[]> {
  const rows = (await getDatabase()
    .prepare(
      `SELECT handoff.id AS handoffId, handoff.name AS handoffName, project.id AS projectId, project.name AS projectName,
              latest.version_label AS versionLabel, counts.versionCount, latest.created_at AS updatedAt
       FROM handoff
       JOIN project ON project.id = handoff.project_id AND project.workspace_id = handoff.workspace_id
       JOIN LATERAL (
         SELECT version_label, created_at FROM handoff_version
         WHERE handoff_version.handoff_id = handoff.id
         ORDER BY created_at DESC, id DESC LIMIT 1
       ) AS latest ON true
       JOIN LATERAL (
         SELECT COUNT(*)::int AS versionCount FROM handoff_version WHERE handoff_version.handoff_id = handoff.id
       ) AS counts ON true
       WHERE handoff.workspace_id = ?
       ORDER BY latest.created_at DESC
       LIMIT ?`,
    )
    .all(workspaceId, visible ? limit * 5 : limit)) as RecentHandoff[];
  return (visible ? rows.filter((row) => visible.has(row.handoffId)) : rows).slice(0, limit);
}
