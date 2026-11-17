import { getDatabase } from "../db";
import { projectIconUrl, projectIconVersions } from "./project-icons";

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
export async function visibleHandoffIds(workspaceId: string, viewer: Viewer): Promise<Set<string> | null> {
  if (canSeeWholeWorkspace(viewer.role)) return null;
  const rows = (await getDatabase()
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
    .all(workspaceId, viewer.id, viewer.email, new Date().toISOString())) as Array<{ id: string }>;
  return new Set(rows.map((row) => row.id));
}

/** Filters project cards to the ones holding a visible handoff, and recounts handoffs and versions. */
export async function filterProjectsForViewer<T extends { id: string; handoffCount: number; versionCount: number }>(
  workspaceId: string,
  viewer: Viewer,
  projects: T[],
): Promise<T[]> {
  const visible = (await visibleHandoffIds(workspaceId, viewer));
  if (!visible) return projects;
  if (!visible.size) return [];
  const counts = (await getDatabase()
    .prepare(
      `SELECT handoff.project_id AS projectId, handoff.id AS handoffId, COUNT(handoff_version.id) AS versions
       FROM handoff
       LEFT JOIN handoff_version ON handoff_version.handoff_id = handoff.id
       WHERE handoff.workspace_id = ?
       GROUP BY handoff.id`,
    )
    .all(workspaceId)) as Array<{ projectId: string; handoffId: string; versions: number }>;
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
export async function handoffNewness(userId: string, handoffIds: string[]): Promise<Map<string, HandoffNewness>> {
  const result = new Map<string, HandoffNewness>();
  if (!handoffIds.length) return result;
  const placeholders = handoffIds.map(() => "?").join(", ");
  const rows = (await getDatabase()
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
    .all(userId, ...handoffIds)) as Array<{ handoffId: string; latestVersionId: string | null; latestCreatedBy: string | null; seenVersionId: string | null }>;
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
export async function markHandoffSeen(input: { userId: string; workspaceId: string; handoffId: string; latestVersionId: string }) {
  (await getDatabase()
    .prepare(
      `INSERT INTO handoff_view (user_id, workspace_id, handoff_id, last_seen_version_id, seen_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id, handoff_id)
       DO UPDATE SET last_seen_version_id = excluded.last_seen_version_id, seen_at = excluded.seen_at`,
    )
    .run(input.userId, input.workspaceId, input.handoffId, input.latestVersionId, new Date().toISOString()));
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
export async function listViewerUpdates(workspaceId: string, viewer: Viewer): Promise<ViewerUpdate[]> {
  const visible = (await visibleHandoffIds(workspaceId, viewer));
  const rows = (await getDatabase()
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
    .all(viewer.id, workspaceId)) as Array<ViewerUpdate & { versionId: string; createdBy: string; seenVersionId: string | null }>;
  return rows
    .filter((row) => row.versionId !== row.seenVersionId && row.createdBy !== viewer.id && (!visible || visible.has(row.handoffId)))
    .map(({ versionId: _versionId, createdBy: _createdBy, seenVersionId: _seenVersionId, ...update }) => update);
}

export function countUpdatesByProject(updates: ViewerUpdate[]) {
  const counts: Record<string, number> = {};
  for (const update of updates) counts[update.projectId] = (counts[update.projectId] ?? 0) + 1;
  return counts;
}

export type ScreenChanges = { changed: number; added: number; removed: number };

export type ViewerHandoff = {
  handoffId: string;
  handoffName: string;
  versionLabel: string | null;
  updatedAt: string;
  isNew: boolean;
  previewUrl: string | null;
  /** The newest version, and the one this person last opened (null if never). */
  latestVersionId: string | null;
  seenVersionId: string | null;
  /** For a new version this person has seen an earlier one of: what changed since. */
  changesSinceSeen: ScreenChanges | null;
  /** Who published the newest version. */
  publishedBy: { name: string; image: string | null } | null;
};

// Versions never change, so a comparison between two of them can be kept for the server's lifetime.
const screenChangesCache = new Map<string, ScreenChanges>();

/**
 * Each screen's Figma frame id (stable across renames) and its fingerprint: the design hash (layer
 * data without names) when the capture has design data, otherwise the render image's stored key.
 * Read from PostgreSQL's JSON operators so the large snapshot never has to be parsed in JavaScript.
 */
async function screenFingerprints(versionId: string) {
  const rows = (await getDatabase()
    .prepare(
      `SELECT COALESCE(frame.value ->> 'sourceFrameId', frame.value ->> 'name') AS name,
              COALESCE(frame.value ->> 'designHash', handoff_asset.object_key) AS objectKey
       FROM handoff_version
       LEFT JOIN handoff_version_snapshot ON handoff_version_snapshot.version_id = handoff_version.id
       CROSS JOIN LATERAL jsonb_array_elements(COALESCE(NULLIF(handoff_version_snapshot.frame_index, '[]')::jsonb, handoff_version.snapshot_json::jsonb -> 'frames')) AS frame(value)
       LEFT JOIN handoff_asset ON handoff_asset.handoff_version_id = handoff_version.id
         AND handoff_asset.asset_key = frame.value ->> 'renderAssetKey'
       WHERE handoff_version.id = ?`,
    )
    .all(versionId)) as Array<{ name: string; objectKey: string | null }>;
  return new Map(rows.map((row) => [row.name, row.objectKey ?? ""] as const));
}

/** Frame ids that are new or look different in the later version. */
export async function changedFrameIdsBetween(fromVersionId: string, toVersionId: string) {
  const before = (await screenFingerprints(fromVersionId));
  const after = (await screenFingerprints(toVersionId));
  return [...after].filter(([id, fingerprint]) => before.get(id) !== fingerprint).map(([id]) => id);
}

/** How many screens changed, were added, or were removed between two versions of a handoff. */
export async function screenChangesBetween(fromVersionId: string, toVersionId: string): Promise<ScreenChanges> {
  const key = `${fromVersionId}:${toVersionId}`;
  const cached = screenChangesCache.get(key);
  if (cached) return cached;
  const before = (await screenFingerprints(fromVersionId));
  const after = (await screenFingerprints(toVersionId));
  const result: ScreenChanges = { changed: 0, added: 0, removed: 0 };
  for (const [name, fingerprint] of after) {
    if (!before.has(name)) result.added += 1;
    else if (before.get(name) !== fingerprint) result.changed += 1;
  }
  for (const name of before.keys()) if (!after.has(name)) result.removed += 1;
  screenChangesCache.set(key, result);
  return result;
}

export type ViewerProject = {
  workspaceId: string;
  workspaceName: string;
  projectId: string;
  projectName: string;
  /** The project's uploaded icon, if any. */
  iconUrl: string | null;
  handoffs: ViewerHandoff[];
  newCount: number;
  updatedAt: string;
};

/**
 * Everything a reviewer can open, grouped by project: each handoff's newest version, whether it is
 * news to them, and a preview (the first regular screen in that version).
 * Projects with news come first, then the most recently updated.
 */
export async function listViewerHome(workspaceId: string, viewer: Viewer): Promise<ViewerProject[]> {
  const visible = (await visibleHandoffIds(workspaceId, viewer));
  const rows = (await getDatabase()
    .prepare(
      `SELECT workspace.name AS workspaceName, project.id AS projectId, project.name AS projectName,
              handoff.id AS handoffId, handoff.name AS handoffName, handoff.created_at AS handoffCreatedAt,
              latest.id AS versionId, latest.version_label AS versionLabel, latest.created_at AS versionCreatedAt,
              latest.created_by_user_id AS createdBy,
              publisher.name AS publisherName, publisher.image AS publisherImage,
              handoff_view.last_seen_version_id AS seenVersionId,
              (SELECT object_key FROM handoff_asset
                 WHERE handoff_asset.handoff_version_id = latest.id AND handoff_asset.content_type LIKE 'image/%'
                 ORDER BY
                   -- Screen renders ("…frame-NNN-…") first, then the canvas overview as a fallback.
                   strpos(handoff_asset.asset_key, 'frame-') = 0,
                   -- Skip very long scrolling screens; they make poor thumbnails.
                   COALESCE(handoff_asset.height, 0) > COALESCE(handoff_asset.width, 1) * 2.4,
                   -- The earliest screen in the file.
                   COALESCE(substring(handoff_asset.asset_key FROM 'frame-([0-9]{1,9})')::INTEGER, 2147483647),
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
       LEFT JOIN "user" AS publisher ON publisher.id = latest.created_by_user_id
       LEFT JOIN handoff_view ON handoff_view.handoff_id = handoff.id AND handoff_view.user_id = ?
       WHERE handoff.workspace_id = ?`,
    )
    .all(viewer.id, workspaceId)) as Array<{
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
      publisherName: string | null;
      publisherImage: string | null;
      seenVersionId: string | null;
      previewKey: string | null;
    }>;

  const iconVersions = (await projectIconVersions(workspaceId));
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
      latestVersionId: row.versionId,
      seenVersionId: row.seenVersionId,
      changesSinceSeen: null,
      publishedBy: row.publisherName ? { name: row.publisherName, image: row.publisherImage } : null,
    };
    if (handoff.isNew && row.seenVersionId && row.versionId) {
      try {
        handoff.changesSinceSeen = (await screenChangesBetween(row.seenVersionId, row.versionId));
      } catch {
        // A comparison that can't be read just leaves the tile without a count.
      }
    }
    const project = projects.get(row.projectId) ?? { workspaceId, workspaceName: row.workspaceName, projectId: row.projectId, projectName: row.projectName, iconUrl: projectIconUrl(workspaceId, row.projectId, iconVersions[row.projectId]), handoffs: [], newCount: 0, updatedAt: handoff.updatedAt };
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
export async function listViewerHomeAcrossWorkspaces(viewer: { id: string; email: string }, memberships: Array<{ id: string; role: string }>) {
  const homes = await Promise.all(memberships.map((membership) => listViewerHome(membership.id, { ...viewer, role: membership.role })));
  return homes
    .flatMap((home) => home)
    .sort((a, b) => Math.min(b.newCount, 1) - Math.min(a.newCount, 1) || b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * Marks handoffs as opened at their newest version for this person, skipping any they can't see.
 * Returns how many were marked.
 */
export async function markHandoffsSeenForViewer(viewer: { id: string; email: string }, handoffIds: string[]) {
  const database = getDatabase();
  const rows = (await database
    .prepare(
      `SELECT handoff.id, handoff.workspace_id AS workspaceId, workspace_membership.role,
              (SELECT id FROM handoff_version WHERE handoff_version.handoff_id = handoff.id
                 ORDER BY created_at DESC, id DESC LIMIT 1) AS latestVersionId
       FROM handoff
       JOIN workspace_membership ON workspace_membership.workspace_id = handoff.workspace_id AND workspace_membership.user_id = ?
       WHERE handoff.id IN (${handoffIds.map(() => "?").join(", ") || "NULL"})`,
    )
    .all(viewer.id, ...handoffIds)) as Array<{ id: string; workspaceId: string; role: string; latestVersionId: string | null }>;
  const visibleByWorkspace = new Map<string, Set<string> | null>();
  let marked = 0;
  for (const row of rows) {
    if (!row.latestVersionId) continue;
    if (!visibleByWorkspace.has(row.workspaceId)) {
      visibleByWorkspace.set(row.workspaceId, (await visibleHandoffIds(row.workspaceId, { ...viewer, role: row.role })));
    }
    const visible = visibleByWorkspace.get(row.workspaceId);
    if (visible && !visible.has(row.id)) continue;
    (await markHandoffSeen({ userId: viewer.id, workspaceId: row.workspaceId, handoffId: row.id, latestVersionId: row.latestVersionId }));
    marked += 1;
  }
  return marked;
}
