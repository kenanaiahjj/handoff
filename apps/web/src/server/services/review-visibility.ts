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
              (SELECT created_by_user_id FROM handoff_version
                 WHERE handoff_version.handoff_id = handoff.id
                 ORDER BY created_at DESC, id DESC LIMIT 1) AS latestCreatedBy,
              handoff_view.last_seen_version_id AS seenVersionId
       FROM handoff
       LEFT JOIN handoff_view ON handoff_view.handoff_id = handoff.id AND handoff_view.user_id = ?
       WHERE handoff.id IN (${placeholders})`,
    )
    .all(userId, ...handoffIds) as Array<{ handoffId: string; latestVersionId: string | null; latestCreatedBy: string | null; seenVersionId: string | null }>;
  for (const row of rows) {
    result.set(row.handoffId, {
      latestVersionId: row.latestVersionId,
      // A version you uploaded yourself isn't news to you.
      isNew: Boolean(row.latestVersionId) && row.latestVersionId !== row.seenVersionId && row.latestCreatedBy !== userId,
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
              latest.created_by_user_id AS createdBy,
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
    .all(viewer.id, workspaceId) as Array<ViewerUpdate & { versionId: string; createdBy: string; seenVersionId: string | null }>;
  return rows
    .filter((row) => row.versionId !== row.seenVersionId && row.createdBy !== viewer.id && (!visible || visible.has(row.handoffId)))
    .map(({ versionId: _versionId, createdBy: _createdBy, seenVersionId: _seenVersionId, ...update }) => update);
}

export function countUpdatesByProject(updates: ViewerUpdate[]) {
  const counts: Record<string, number> = {};
  for (const update of updates) counts[update.projectId] = (counts[update.projectId] ?? 0) + 1;
  return counts;
}

export type ViewerHandoff = {
  handoffId: string;
  handoffName: string;
  versionLabel: string | null;
  updatedAt: string;
  isNew: boolean;
  previewUrl: string | null;
};

export type ViewerProject = {
  workspaceId: string;
  workspaceName: string;
  projectId: string;
  projectName: string;
  handoffs: ViewerHandoff[];
  newCount: number;
  updatedAt: string;
};

/**
 * Everything a reviewer can open, grouped by project: each handoff's newest version, whether it is
 * news to them, and a preview (the first regular screen in that version).
 * Projects with news come first, then the most recently updated.
 */
export function listViewerHome(workspaceId: string, viewer: Viewer): ViewerProject[] {
  const visible = visibleHandoffIds(workspaceId, viewer);
  const rows = getDatabase()
    .prepare(
      `SELECT workspace.name AS workspaceName, project.id AS projectId, project.name AS projectName,
              handoff.id AS handoffId, handoff.name AS handoffName, handoff.created_at AS handoffCreatedAt,
              latest.id AS versionId, latest.version_label AS versionLabel, latest.created_at AS versionCreatedAt,
              latest.created_by_user_id AS createdBy,
              handoff_view.last_seen_version_id AS seenVersionId,
              (SELECT object_key FROM handoff_asset
                 WHERE handoff_asset.handoff_version_id = latest.id AND handoff_asset.content_type LIKE 'image/%'
                 ORDER BY
                   -- Screen renders ("…frame-NNN-…") first, then the canvas overview as a fallback.
                   instr(handoff_asset.asset_key, 'frame-') = 0,
                   -- Skip very long scrolling screens; they make poor thumbnails.
                   COALESCE(handoff_asset.height, 0) > COALESCE(handoff_asset.width, 1) * 2.4,
                   -- The earliest screen in the file.
                   CAST(substr(handoff_asset.asset_key, instr(handoff_asset.asset_key, 'frame-') + 6, 4) AS INTEGER),
                   COALESCE(handoff_asset.width, 0) * COALESCE(handoff_asset.height, 0) DESC
                 LIMIT 1) AS previewKey
       FROM handoff
       JOIN project ON project.id = handoff.project_id AND project.workspace_id = handoff.workspace_id
       JOIN workspace ON workspace.id = handoff.workspace_id
       LEFT JOIN handoff_version AS latest ON latest.id = (
         SELECT id FROM handoff_version
         WHERE handoff_version.handoff_id = handoff.id
         ORDER BY created_at DESC, id DESC LIMIT 1
       )
       LEFT JOIN handoff_view ON handoff_view.handoff_id = handoff.id AND handoff_view.user_id = ?
       WHERE handoff.workspace_id = ?`,
    )
    .all(viewer.id, workspaceId) as Array<{
      workspaceName: string;
      projectId: string;
      projectName: string;
      handoffId: string;
      handoffName: string;
      handoffCreatedAt: string;
      versionId: string | null;
      versionLabel: string | null;
      versionCreatedAt: string | null;
      createdBy: string | null;
      seenVersionId: string | null;
      previewKey: string | null;
    }>;

  const projects = new Map<string, ViewerProject>();
  for (const row of rows) {
    if (visible && !visible.has(row.handoffId)) continue;
    const handoff: ViewerHandoff = {
      handoffId: row.handoffId,
      handoffName: row.handoffName,
      versionLabel: row.versionLabel,
      updatedAt: row.versionCreatedAt ?? row.handoffCreatedAt,
      isNew: Boolean(row.versionId) && row.versionId !== row.seenVersionId && row.createdBy !== viewer.id,
      previewUrl: row.previewKey ? `/api/assets/${encodeURIComponent(row.previewKey)}` : null,
    };
    const project = projects.get(row.projectId) ?? { workspaceId, workspaceName: row.workspaceName, projectId: row.projectId, projectName: row.projectName, handoffs: [], newCount: 0, updatedAt: handoff.updatedAt };
    project.handoffs.push(handoff);
    if (handoff.isNew) project.newCount += 1;
    if (handoff.updatedAt > project.updatedAt) project.updatedAt = handoff.updatedAt;
    projects.set(row.projectId, project);
  }

  const byNewsThenRecent = <T extends { updatedAt: string }>(news: (item: T) => number) => (a: T, b: T) =>
    news(b) - news(a) || b.updatedAt.localeCompare(a.updatedAt);
  return [...projects.values()]
    .map((project) => ({ ...project, handoffs: project.handoffs.sort(byNewsThenRecent((handoff) => Number(handoff.isNew))) }))
    .sort(byNewsThenRecent((project) => Math.min(project.newCount, 1)));
}

/** One combined home across every workspace this person belongs to, projects with news first. */
export function listViewerHomeAcrossWorkspaces(viewer: { id: string; email: string }, memberships: Array<{ id: string; role: string }>) {
  return memberships
    .flatMap((membership) => listViewerHome(membership.id, { ...viewer, role: membership.role }))
    .sort((a, b) => Math.min(b.newCount, 1) - Math.min(a.newCount, 1) || b.updatedAt.localeCompare(a.updatedAt));
}
