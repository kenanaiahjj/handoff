import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { hashHandoffInviteToken, normalizeInviteEmail, type HandoffSharingMode } from "./handoff-sharing.ts";

type HandoffSharingDatabase = Pick<Database.Database, "prepare" | "transaction">;

export function updateHandoffSharingModeInDatabase(
  database: HandoffSharingDatabase,
  input: { workspaceId: string; projectId: string; handoffId: string; mode: HandoffSharingMode },
) {
  const result = database
    .prepare(
      `UPDATE handoff SET sharing_mode = ?
       WHERE id = ? AND workspace_id = ? AND project_id = ?`,
    )
    .run(input.mode, input.handoffId, input.workspaceId, input.projectId);
  return result.changes === 1;
}

export function createHandoffInviteInDatabase(
  database: HandoffSharingDatabase,
  input: {
    id?: string;
    workspaceId: string;
    projectId: string;
    handoffId: string;
    email: string;
    token: string;
    expiresAt: string | null;
    invitedByUserId: string;
    createdAt?: string;
  },
) {
  const now = input.createdAt ?? new Date().toISOString();
  const id = input.id ?? randomUUID();
  const email = normalizeInviteEmail(input.email);
  const insert = database.transaction(() => {
    const handoff = database
      .prepare(
        `SELECT review_share_id AS reviewShareId
         FROM handoff
         WHERE id = ? AND workspace_id = ? AND project_id = ?
           AND sharing_mode = 'invited'
           AND review_share_id IS NOT NULL AND published_version_id IS NOT NULL`,
      )
      .get(input.handoffId, input.workspaceId, input.projectId) as { reviewShareId: string } | undefined;
    if (!handoff) return null;

    database
      .prepare(
        `UPDATE handoff_invite SET revoked_at = ?
         WHERE workspace_id = ? AND handoff_id = ? AND email = ? AND revoked_at IS NULL`,
      )
      .run(now, input.workspaceId, input.handoffId, email);

    database
      .prepare(
        `INSERT INTO handoff_invite
          (id, workspace_id, handoff_id, email, token_hash, expires_at,
           invited_by_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.workspaceId,
        input.handoffId,
        email,
        hashHandoffInviteToken(input.token),
        input.expiresAt,
        input.invitedByUserId,
        now,
      );

    return {
      id,
      email,
      reviewShareId: handoff.reviewShareId,
      expiresAt: input.expiresAt,
      createdAt: now,
    };
  });

  return insert.immediate();
}

export function listHandoffInvitesInDatabase(
  database: HandoffSharingDatabase,
  input: { workspaceId: string; handoffId: string; now?: string },
) {
  return database
    .prepare(
      `SELECT id, email, expires_at AS expiresAt, created_at AS createdAt
       FROM handoff_invite
       WHERE workspace_id = ? AND handoff_id = ? AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > ?)
       ORDER BY created_at DESC, id DESC`,
    )
    .all(input.workspaceId, input.handoffId, input.now ?? new Date().toISOString()) as Array<{
      id: string;
      email: string;
      expiresAt: string | null;
      createdAt: string;
    }>;
}

export function revokeHandoffInviteInDatabase(
  database: HandoffSharingDatabase,
  input: { workspaceId: string; projectId: string; handoffId: string; inviteId: string; revokedAt?: string },
) {
  const result = database
    .prepare(
      `UPDATE handoff_invite SET revoked_at = ?
       WHERE id = ? AND workspace_id = ? AND handoff_id = ? AND revoked_at IS NULL
         AND EXISTS (
           SELECT 1 FROM handoff
           WHERE handoff.id = handoff_invite.handoff_id
             AND handoff.workspace_id = handoff_invite.workspace_id
             AND handoff.project_id = ?
         )`,
    )
    .run(input.revokedAt ?? new Date().toISOString(), input.inviteId, input.workspaceId, input.handoffId, input.projectId);
  return result.changes === 1;
}

export function getHandoffInviteByTokenInDatabase(
  database: HandoffSharingDatabase,
  shareId: string,
  token: string,
  now = new Date().toISOString(),
) {
  return database
    .prepare(
      `SELECT handoff_invite.id, handoff_invite.workspace_id AS workspaceId,
              handoff_invite.handoff_id AS handoffId, handoff_invite.email,
              handoff_invite.token_hash AS tokenHash,
              handoff_invite.expires_at AS expiresAt,
              handoff_invite.revoked_at AS revokedAt
       FROM handoff_invite
       JOIN handoff ON handoff.id = handoff_invite.handoff_id
         AND handoff.workspace_id = handoff_invite.workspace_id
       WHERE handoff.review_share_id = ? AND handoff_invite.token_hash = ?
         AND handoff.sharing_mode = 'invited'
         AND handoff.published_version_id IS NOT NULL
         AND handoff_invite.revoked_at IS NULL
         AND (handoff_invite.expires_at IS NULL OR handoff_invite.expires_at > ?)`,
    )
    .get(shareId, hashHandoffInviteToken(token), now) as {
      id: string;
      workspaceId: string;
      handoffId: string;
      email: string;
      tokenHash: string;
      expiresAt: string | null;
      revokedAt: string | null;
    } | undefined ?? null;
}
