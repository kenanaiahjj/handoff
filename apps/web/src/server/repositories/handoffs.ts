import { randomUUID } from "node:crypto";
import { getDatabase } from "../db";
import { deleteHandoffInDatabase } from "../services/handoff-lifecycle";
import type { HandoffInviteRole } from "../services/handoff-sharing";
import {
  createHandoffInviteInDatabase,
  getHandoffInviteByTokenInDatabase,
  listHandoffInvitesInDatabase,
  revokeHandoffInviteInDatabase,
  updateHandoffSharingModeInDatabase,
} from "../services/handoff-sharing-data";

export async function listHandoffs(input: { workspaceId: string; projectId: string }) {
  return (await getDatabase()
    .prepare(
      `SELECT handoff.id, handoff.name, handoff.created_at AS createdAt,
              handoff.published_version_id AS publishedVersionId,
              handoff.sharing_mode AS sharingMode,
              COUNT(handoff_version.id) AS versionCount,
              MAX(handoff_version.created_at) AS latestVersionAt
       FROM handoff
       LEFT JOIN handoff_version ON handoff_version.handoff_id = handoff.id
       WHERE handoff.workspace_id = ? AND handoff.project_id = ?
       GROUP BY handoff.id
       ORDER BY COALESCE(MAX(handoff_version.created_at), handoff.created_at) DESC`,
    )
    .all(input.workspaceId, input.projectId));
}

export async function listHandoffsPage(input: { workspaceId: string; projectId: string; offset: number; limit: number }) {
  const database = getDatabase();
  const total = ((await database
    .prepare("SELECT COUNT(*) AS total FROM handoff WHERE workspace_id = ? AND project_id = ?")
    .get(input.workspaceId, input.projectId)) as { total: number }).total;
  const items = (await database
    .prepare(
      `SELECT handoff.id, handoff.name, handoff.created_at AS createdAt,
              handoff.published_version_id AS publishedVersionId,
              handoff.sharing_mode AS sharingMode,
              COUNT(handoff_version.id) AS versionCount,
              MAX(handoff_version.created_at) AS latestVersionAt
       FROM handoff
       LEFT JOIN handoff_version ON handoff_version.handoff_id = handoff.id
       WHERE handoff.workspace_id = ? AND handoff.project_id = ?
       GROUP BY handoff.id
       ORDER BY COALESCE(MAX(handoff_version.created_at), handoff.created_at) DESC, handoff.id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(input.workspaceId, input.projectId, input.limit, input.offset));

  return { items, total };
}

export async function getHandoff(input: {
  workspaceId: string;
  projectId: string;
  handoffId: string;
}) {
  return (await getDatabase()
    .prepare(
      `SELECT id, workspace_id AS workspaceId, project_id AS projectId, name,
              created_at AS createdAt, review_share_id AS reviewShareId,
              published_version_id AS publishedVersionId, published_at AS publishedAt,
              published_by_user_id AS publishedByUserId,
              sharing_mode AS sharingMode
       FROM handoff
       WHERE id = ? AND workspace_id = ? AND project_id = ?`,
    )
    .get(input.handoffId, input.workspaceId, input.projectId)) as
    | {
        id: string;
        workspaceId: string;
        projectId: string;
        name: string;
        createdAt: string;
        reviewShareId: string | null;
        publishedVersionId: string | null;
        publishedAt: string | null;
        publishedByUserId: string | null;
        sharingMode: "workspace" | "invited" | "anyone";
      }
    | undefined;
}

export function deleteHandoff(input: {
  workspaceId: string;
  projectId: string;
  handoffId: string;
}) {
  return deleteHandoffInDatabase(getDatabase(), input);
}

export async function renameHandoff(input: {
  workspaceId: string;
  projectId: string;
  handoffId: string;
  name: string;
}) {
  const result = (await getDatabase()
    .prepare("UPDATE handoff SET name = ? WHERE id = ? AND workspace_id = ? AND project_id = ?")
    .run(input.name.trim(), input.handoffId, input.workspaceId, input.projectId));
  return result.changes > 0;
}

export async function getLatestPublishedReviewShare(input: { workspaceId: string; projectId: string }) {
  return (await getDatabase()
    .prepare(
      `SELECT review_share_id AS shareId
       FROM handoff
       WHERE workspace_id = ? AND project_id = ?
         AND review_share_id IS NOT NULL AND published_version_id IS NOT NULL
       ORDER BY published_at DESC NULLS LAST, created_at DESC
       LIMIT 1`,
    )
    .get(input.workspaceId, input.projectId)) as { shareId: string } | undefined;
}

export async function getPublishedHandoffByShareId(shareId: string) {
  return (await getDatabase()
    .prepare(
      `SELECT id, workspace_id AS workspaceId, project_id AS projectId, name,
              review_share_id AS reviewShareId, published_version_id AS publishedVersionId,
              published_at AS publishedAt, sharing_mode AS sharingMode
       FROM handoff
       WHERE review_share_id = ? AND published_version_id IS NOT NULL`,
    )
    .get(shareId)) as {
      id: string;
      workspaceId: string;
      projectId: string;
      name: string;
      reviewShareId: string;
      publishedVersionId: string;
      publishedAt: string;
      sharingMode: "workspace" | "invited" | "anyone";
    } | undefined;
}

export async function setHandoffSharingMode(input: {
  workspaceId: string;
  projectId: string;
  handoffId: string;
  mode: "workspace" | "invited" | "anyone";
  revokePublicLink?: boolean;
}) {
  return (await updateHandoffSharingModeInDatabase(getDatabase(), input));
}

export function createHandoffInvite(input: {
  id?: string;
  workspaceId: string;
  projectId: string;
  handoffId: string;
  email: string;
  role?: HandoffInviteRole;
  token: string;
  expiresAt: string | null;
  invitedByUserId: string;
  createdAt?: string;
}) {
  return createHandoffInviteInDatabase(getDatabase(), input);
}

export async function listHandoffInvites(input: { workspaceId: string; handoffId: string; now?: string }) {
  return (await listHandoffInvitesInDatabase(getDatabase(), input));
}

export async function revokeHandoffInvite(input: {
  workspaceId: string;
  projectId: string;
  handoffId: string;
  inviteId: string;
  revokedAt?: string;
}) {
  return (await revokeHandoffInviteInDatabase(getDatabase(), input));
}

export async function getHandoffInviteByToken(shareId: string, token: string, now?: string) {
  return (await getHandoffInviteByTokenInDatabase(getDatabase(), shareId, token, now));
}

export function publishHandoffVersion(input: {
  workspaceId: string;
  projectId: string;
  handoffId: string;
  versionId: string;
  publishedByUserId: string;
}) {
  const database = getDatabase();
  const publish = database.transaction(async () => {
    const version = (await database
      .prepare(
        `SELECT handoff_version.id
         FROM handoff_version
         JOIN handoff ON handoff.id = handoff_version.handoff_id
           AND handoff.workspace_id = handoff_version.workspace_id
         WHERE handoff_version.id = ? AND handoff_version.workspace_id = ?
           AND handoff.project_id = ? AND handoff_version.handoff_id = ?`,
      )
      .get(input.versionId, input.workspaceId, input.projectId, input.handoffId)) as { id: string } | undefined;
    if (!version) return null;

    const latest = (await database
      .prepare(
        `SELECT handoff_version.id
         FROM handoff_version
         JOIN handoff ON handoff.id = handoff_version.handoff_id
           AND handoff.workspace_id = handoff_version.workspace_id
         WHERE handoff_version.workspace_id = ? AND handoff.project_id = ?
           AND handoff_version.handoff_id = ?
         ORDER BY handoff_version.created_at DESC, handoff_version.id DESC LIMIT 1`,
      )
      .get(input.workspaceId, input.projectId, input.handoffId)) as { id: string } | undefined;
    if (latest?.id !== version.id) {
      throw new Error("Publish the latest handoff version to update its review canvas.");
    }

    const existing = (await database
      .prepare("SELECT review_share_id AS reviewShareId FROM handoff WHERE id = ? AND workspace_id = ? AND project_id = ?")
      .get(input.handoffId, input.workspaceId, input.projectId)) as { reviewShareId: string | null } | undefined;
    if (!existing) return null;

    const reviewShareId = existing.reviewShareId ?? randomUUID();
    const publishedAt = new Date().toISOString();
    (await database
      .prepare(
        `UPDATE handoff
         SET review_share_id = ?, published_version_id = ?, published_at = ?, published_by_user_id = ?
         WHERE id = ? AND workspace_id = ? AND project_id = ?`,
      )
      .run(reviewShareId, version.id, publishedAt, input.publishedByUserId, input.handoffId, input.workspaceId, input.projectId));

    return { reviewShareId, versionId: version.id, publishedAt };
  });

  return publish();
}

export async function listHandoffVersions(input: { workspaceId: string; handoffId: string }) {
  return (await getDatabase()
    .prepare(
      `SELECT id, version_label AS versionLabel, release_note AS releaseNote,
              source, source_revision_id AS sourceRevisionId, captured_at AS capturedAt,
              content_hash AS contentHash, CAST(visual_only AS integer) AS visualOnly,
              created_at AS createdAt, created_by_user_id AS createdBy
       FROM handoff_version
       WHERE workspace_id = ? AND handoff_id = ?
       ORDER BY created_at DESC, id DESC`,
    )
    .all(input.workspaceId, input.handoffId));
}

export async function listHandoffVersionsPage(input: { workspaceId: string; handoffId: string; offset: number; limit: number }) {
  const database = getDatabase();
  const total = ((await database
    .prepare("SELECT COUNT(*) AS total FROM handoff_version WHERE workspace_id = ? AND handoff_id = ?")
    .get(input.workspaceId, input.handoffId)) as { total: number }).total;
  const items = (await database
    .prepare(
      `SELECT id, version_label AS versionLabel, release_note AS releaseNote,
              source, source_revision_id AS sourceRevisionId, captured_at AS capturedAt,
              content_hash AS contentHash, CAST(visual_only AS integer) AS visualOnly,
              created_at AS createdAt, created_by_user_id AS createdBy
       FROM handoff_version
       WHERE workspace_id = ? AND handoff_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(input.workspaceId, input.handoffId, input.limit, input.offset));

  return { items, total };
}

/**
 * Card thumbnails for a project's handoffs: the first ordinary screen of each handoff's published
 * (else latest) version, as an asset object key. Handoffs without screens are left out.
 */
export async function listHandoffPreviewKeys(input: { workspaceId: string; projectId: string }) {
  const rows = (await getDatabase()
    .prepare(
      `SELECT handoff.id AS handoffId,
              (SELECT object_key FROM handoff_asset
                 WHERE handoff_asset.handoff_version_id = COALESCE(handoff.published_version_id, (
                     SELECT latest.id FROM handoff_version latest
                     WHERE latest.handoff_id = handoff.id
                     ORDER BY latest.created_at DESC LIMIT 1))
                   AND handoff_asset.content_type LIKE 'image/%'
                 ORDER BY
                   -- Screen renders first, then the canvas overview; skip very long scrolling screens.
                   strpos(handoff_asset.asset_key, 'frame-') = 0,
                   COALESCE(handoff_asset.height, 0) > COALESCE(handoff_asset.width, 1) * 2.4,
                   COALESCE(substring(handoff_asset.asset_key FROM 'frame-([0-9]{1,9})')::INTEGER, 2147483647),
                   COALESCE(handoff_asset.width, 0) * COALESCE(handoff_asset.height, 0) DESC
                 LIMIT 1) AS previewKey
       FROM handoff
       WHERE handoff.workspace_id = ? AND handoff.project_id = ?`,
    )
    .all(input.workspaceId, input.projectId)) as Array<{ handoffId: string; previewKey: string | null }>;
  return new Map(rows.filter((row) => row.previewKey).map((row) => [row.handoffId, row.previewKey as string]));
}

/**
 * Up to `perProject` preview images per project, from its most recently updated handoffs, for the
 * project cards on the workspace dashboard. Same image choice as listHandoffPreviewKeys.
 */
export async function listProjectPreviewKeys(workspaceId: string, perProject = 3) {
  const rows = (await getDatabase()
    .prepare(
      `SELECT handoff.project_id AS projectId,
              (SELECT MAX(version.created_at) FROM handoff_version version WHERE version.handoff_id = handoff.id) AS updatedAt,
              (SELECT object_key FROM handoff_asset
                 WHERE handoff_asset.handoff_version_id = COALESCE(handoff.published_version_id, (
                     SELECT latest.id FROM handoff_version latest
                     WHERE latest.handoff_id = handoff.id
                     ORDER BY latest.created_at DESC LIMIT 1))
                   AND handoff_asset.content_type LIKE 'image/%'
                 ORDER BY
                   strpos(handoff_asset.asset_key, 'frame-') = 0,
                   COALESCE(handoff_asset.height, 0) > COALESCE(handoff_asset.width, 1) * 2.4,
                   COALESCE(substring(handoff_asset.asset_key FROM 'frame-([0-9]{1,9})')::INTEGER, 2147483647),
                   COALESCE(handoff_asset.width, 0) * COALESCE(handoff_asset.height, 0) DESC
                 LIMIT 1) AS previewKey
       FROM handoff
       WHERE handoff.workspace_id = ?`,
    )
    .all(workspaceId)) as Array<{ projectId: string; updatedAt: string | null; previewKey: string | null }>;
  const byProject = new Map<string, string[]>();
  for (const row of rows.filter((row) => row.previewKey).sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")))) {
    const keys = byProject.get(row.projectId) ?? [];
    if (keys.length < perProject) keys.push(row.previewKey as string);
    byProject.set(row.projectId, keys);
  }
  return byProject;
}
