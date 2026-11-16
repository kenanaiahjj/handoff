import { getDatabase } from "../db";

/** Owners and designers manage the whole workspace; every other role reviews what is shared with them. */
export function canSeeWholeWorkspace(role: string | null | undefined) {
  return role === "owner" || role === "designer";
}

export type Viewer = { id: string; email: string; role: string };

export type HandoffNewness = { latestVersionId: string | null; isNew: boolean };

/**
 * Handoffs a reviewer can open: ones with an active invite to their email, plus every handoff
 * in a project where they are the PD in charge. Owners and designers get `null` (no filter).
 */
export function visibleHandoffIds(workspaceId: string, viewer: Viewer): Set<string> | null {
  if (canSeeWholeWorkspace(viewer.role)) return null;
  const rows = getDatabase()
    .prepare(
      `SELECT handoff.id
       FROM handoff
       JOIN project ON project.id = handoff.project_id AND project.workspace_id = handoff.workspace_id
       WHERE handoff.workspace_id = ?
         AND (
           project.pd_in_charge_user_id = ?
           OR EXISTS (
             SELECT 1 FROM handoff_invite
             WHERE handoff_invite.handoff_id = handoff.id
               AND handoff_invite.workspace_id = handoff.workspace_id
               AND lower(handoff_invite.email) = lower(?)
               AND handoff_invite.revoked_at IS NULL
               AND (handoff_invite.expires_at IS NULL OR handoff_invite.expires_at > ?)
           )
         )`,
    )
    .all(workspaceId, viewer.id, viewer.email, new Date().toISOString()) as Array<{ id: string }>;
  return new Set(rows.map((row) => row.id));
}

/** Filters project cards to the ones holding a visible handoff, and recounts handoffs and versions. */
export function filterProjectsForViewer<T extends { id: string; handoffCount: number; versionCount: number }>(
  workspaceId: string,
  viewer: Viewer,
  projects: T[],
): T[] {
  const visible = visibleHandoffIds(workspaceId, viewer);
  if (!visible) return projects;
  if (!visible.size) return [];
  const counts = getDatabase()
    .prepare(
      `SELECT handoff.project_id AS projectId, handoff.id AS handoffId, COUNT(handoff_version.id) AS versions
       FROM handoff
       LEFT JOIN handoff_version ON handoff_version.handoff_id = handoff.id
       WHERE handoff.workspace_id = ?
       GROUP BY handoff.id`,
    )
    .all(workspaceId) as Array<{ projectId: string; handoffId: string; versions: number }>;
  const perProject = new Map<string, { handoffCount: number; versionCount: number }>();
  for (const row of counts) {
    if (!visible.has(row.handoffId)) continue;
    const entry = perProject.get(row.projectId) ?? { handoffCount: 0, versionCount: 0 };
    entry.handoffCount += 1;
    entry.versionCount += row.versions;
    perProject.set(row.projectId, entry);
  }
  return projects
    .filter((project) => perProject.has(project.id))
    .map((project) => ({ ...project, ...perProject.get(project.id)! }));
}

/** For each handoff, whether its newest version is newer than the one this person last opened. */
export function handoffNewness(userId: string, handoffIds: string[]): Map<string, HandoffNewness> {
  const result = new Map<string, HandoffNewness>();
  if (!handoffIds.length) return result;
  const placeholders = handoffIds.map(() => "?").join(", ");
  const rows = getDatabase()
    .prepare(
      `SELECT handoff.id AS handoffId,
              (SELECT id FROM handoff_version
                 WHERE handoff_version.handoff_id = handoff.id
                 ORDER BY created_at DESC, id DESC LIMIT 1) AS latestVersionId,
              handoff_view.last_seen_version_id AS seenVersionId
       FROM handoff
       LEFT JOIN handoff_view ON handoff_view.handoff_id = handoff.id AND handoff_view.user_id = ?
       WHERE handoff.id IN (${placeholders})`,
    )
    .all(userId, ...handoffIds) as Array<{ handoffId: string; latestVersionId: string | null; seenVersionId: string | null }>;
  for (const row of rows) {
    result.set(row.handoffId, {
      latestVersionId: row.latestVersionId,
      isNew: Boolean(row.latestVersionId) && row.latestVersionId !== row.seenVersionId,
    });
  }
  return result;
}

/** Records that this person has opened the handoff at its newest version. */
export function markHandoffSeen(input: { userId: string; workspaceId: string; handoffId: string; latestVersionId: string }) {
  getDatabase()
    .prepare(
      `INSERT INTO handoff_view (user_id, workspace_id, handoff_id, last_seen_version_id, seen_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id, handoff_id)
       DO UPDATE SET last_seen_version_id = excluded.last_seen_version_id, seen_at = excluded.seen_at`,
    )
    .run(input.userId, input.workspaceId, input.handoffId, input.latestVersionId, new Date().toISOString());
}

export type ViewerUpdate = {
  projectId: string;
  projectName: string;
  handoffId: string;
  handoffName: string;
  versionLabel: string;
  createdAt: string;
};

/** Handoffs this person can see whose newest version they have not opened, newest first. */
export function listViewerUpdates(workspaceId: string, viewer: Viewer): ViewerUpdate[] {
  const visible = visibleHandoffIds(workspaceId, viewer);
  const rows = getDatabase()
    .prepare(
      `SELECT project.id AS projectId, project.name AS projectName,
              handoff.id AS handoffId, handoff.name AS handoffName,
              latest.id AS versionId, latest.version_label AS versionLabel, latest.created_at AS createdAt,
              handoff_view.last_seen_version_id AS seenVersionId
       FROM handoff
       JOIN project ON project.id = handoff.project_id AND project.workspace_id = handoff.workspace_id
       JOIN handoff_version AS latest ON latest.id = (
         SELECT id FROM handoff_version
         WHERE handoff_version.handoff_id = handoff.id
         ORDER BY created_at DESC, id DESC LIMIT 1
       )
       LEFT JOIN handoff_view ON handoff_view.handoff_id = handoff.id AND handoff_view.user_id = ?
       WHERE handoff.workspace_id = ?
       ORDER BY latest.created_at DESC`,
    )
    .all(viewer.id, workspaceId) as Array<ViewerUpdate & { versionId: string; seenVersionId: string | null }>;
  return rows
    .filter((row) => row.versionId !== row.seenVersionId && (!visible || visible.has(row.handoffId)))
    .map(({ versionId: _versionId, seenVersionId: _seenVersionId, ...update }) => update);
}

export function countUpdatesByProject(updates: ViewerUpdate[]) {
  const counts: Record<string, number> = {};
  for (const update of updates) counts[update.projectId] = (counts[update.projectId] ?? 0) + 1;
  return counts;
}
