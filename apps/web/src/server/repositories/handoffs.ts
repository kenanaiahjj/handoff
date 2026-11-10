import { randomUUID } from "node:crypto";
import { getDatabase } from "../db";
import { deleteHandoffInDatabase } from "../services/handoff-lifecycle";
import {
  createHandoffInviteInDatabase,
  getHandoffInviteByTokenInDatabase,
  listHandoffInvitesInDatabase,
  revokeHandoffInviteInDatabase,
  updateHandoffSharingModeInDatabase,
} from "../services/handoff-sharing-data";

export function listHandoffs(input: { workspaceId: string; projectId: string }) {
  return getDatabase()
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
    .all(input.workspaceId, input.projectId);
}

export function getHandoff(input: {
  workspaceId: string;
  projectId: string;
  handoffId: string;
}) {
  return getDatabase()
    .prepare(
      `SELECT id, workspace_id AS workspaceId, project_id AS projectId, name,
              created_at AS createdAt, review_share_id AS reviewShareId,
              published_version_id AS publishedVersionId, published_at AS publishedAt,
              published_by_user_id AS publishedByUserId,
              sharing_mode AS sharingMode
       FROM handoff
       WHERE id = ? AND workspace_id = ? AND project_id = ?`,
    )
    .get(input.handoffId, input.workspaceId, input.projectId) as
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

export function getLatestPublishedReviewShare(input: { workspaceId: string; projectId: string }) {
  return getDatabase()
    .prepare(
      `SELECT review_share_id AS shareId
       FROM handoff
       WHERE workspace_id = ? AND project_id = ?
         AND review_share_id IS NOT NULL AND published_version_id IS NOT NULL
       ORDER BY published_at DESC, created_at DESC
       LIMIT 1`,
    )
    .get(input.workspaceId, input.projectId) as { shareId: string } | undefined;
}

export function getPublishedHandoffByShareId(shareId: string) {
  return getDatabase()
    .prepare(
      `SELECT id, workspace_id AS workspaceId, project_id AS projectId, name,
              review_share_id AS reviewShareId, published_version_id AS publishedVersionId,
              published_at AS publishedAt, sharing_mode AS sharingMode
       FROM handoff
       WHERE review_share_id = ? AND published_version_id IS NOT NULL`,
    )
    .get(shareId) as {
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

export function setHandoffSharingMode(input: {
  workspaceId: string;
  projectId: string;
  handoffId: string;
  mode: "workspace" | "invited" | "anyone";
}) {
  return updateHandoffSharingModeInDatabase(getDatabase(), input);
}

export function createHandoffInvite(input: {
  id?: string;
  workspaceId: string;
  projectId: string;
  handoffId: string;
  email: string;
  token: string;
  expiresAt: string | null;
  invitedByUserId: string;
  createdAt?: string;
}) {
  return createHandoffInviteInDatabase(getDatabase(), input);
}

export function listHandoffInvites(input: { workspaceId: string; handoffId: string; now?: string }) {
  return listHandoffInvitesInDatabase(getDatabase(), input);
}

export function revokeHandoffInvite(input: {
  workspaceId: string;
  projectId: string;
  handoffId: string;
  inviteId: string;
  revokedAt?: string;
}) {
  return revokeHandoffInviteInDatabase(getDatabase(), input);
}

export function getHandoffInviteByToken(shareId: string, token: string, now?: string) {
  return getHandoffInviteByTokenInDatabase(getDatabase(), shareId, token, now);
}

export function publishHandoffVersion(input: {
  workspaceId: string;
  projectId: string;
  handoffId: string;
  versionId: string;
  publishedByUserId: string;
}) {
  const database = getDatabase();
  const publish = database.transaction(() => {
    const version = database
      .prepare(
        `SELECT handoff_version.id
         FROM handoff_version
         JOIN handoff ON handoff.id = handoff_version.handoff_id
           AND handoff.workspace_id = handoff_version.workspace_id
         WHERE handoff_version.id = ? AND handoff_version.workspace_id = ?
           AND handoff.project_id = ? AND handoff_version.handoff_id = ?`,
      )
      .get(input.versionId, input.workspaceId, input.projectId, input.handoffId) as { id: string } | undefined;
    if (!version) return null;

    const latest = database
      .prepare(
        `SELECT handoff_version.id
         FROM handoff_version
         JOIN handoff ON handoff.id = handoff_version.handoff_id
           AND handoff.workspace_id = handoff_version.workspace_id
         WHERE handoff_version.workspace_id = ? AND handoff.project_id = ?
           AND handoff_version.handoff_id = ?
         ORDER BY handoff_version.created_at DESC, handoff_version.id DESC LIMIT 1`,
      )
      .get(input.workspaceId, input.projectId, input.handoffId) as { id: string } | undefined;
    if (latest?.id !== version.id) {
      throw new Error("Publish the latest handoff version to update its review canvas.");
    }

    const existing = database
      .prepare("SELECT review_share_id AS reviewShareId FROM handoff WHERE id = ? AND workspace_id = ? AND project_id = ?")
      .get(input.handoffId, input.workspaceId, input.projectId) as { reviewShareId: string | null } | undefined;
    if (!existing) return null;

    const reviewShareId = existing.reviewShareId ?? randomUUID();
    const publishedAt = new Date().toISOString();
    database
      .prepare(
        `UPDATE handoff
         SET review_share_id = ?, published_version_id = ?, published_at = ?, published_by_user_id = ?
         WHERE id = ? AND workspace_id = ? AND project_id = ?`,
      )
      .run(reviewShareId, version.id, publishedAt, input.publishedByUserId, input.handoffId, input.workspaceId, input.projectId);

    return { reviewShareId, versionId: version.id, publishedAt };
  });

  return publish.immediate();
}

export function listHandoffVersions(input: { workspaceId: string; handoffId: string }) {
  return getDatabase()
    .prepare(
      `SELECT id, version_label AS versionLabel, release_note AS releaseNote,
              source, source_revision_id AS sourceRevisionId, captured_at AS capturedAt,
              content_hash AS contentHash, visual_only AS visualOnly,
              created_at AS createdAt, created_by_user_id AS createdBy
       FROM handoff_version
       WHERE workspace_id = ? AND handoff_id = ?
       ORDER BY created_at DESC, id DESC`,
    )
    .all(input.workspaceId, input.handoffId);
}
