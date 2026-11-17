import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getDatabase } from "../db";

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createCaptureSession(input: {
  workspaceId: string;
  projectId: string;
  handoffId: string | null;
  handoffName: string | null;
  versionLabel: string;
  releaseNote: string | null;
  createdBy: string;
}) {
  const id = randomUUID();
  const token = `asbir_capture_${randomBytes(32).toString("base64url")}`;
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + 60 * 60 * 1000).toISOString();
  (await getDatabase()
    .prepare(
      `INSERT INTO capture_session
        (id, workspace_id, project_id, handoff_id, handoff_name, version_label,
         release_note, created_by_user_id, token_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, input.workspaceId, input.projectId, input.handoffId, input.handoffName, input.versionLabel.trim(), input.releaseNote?.trim() || null, input.createdBy, hashToken(token), expiresAt, createdAt.toISOString()));
  return { id, token, expiresAt };
}

export async function getCaptureSession(token: string) {
  const row = (await getDatabase()
    .prepare(
      `SELECT id, workspace_id AS workspaceId, project_id AS projectId,
              handoff_id AS handoffId, handoff_name AS handoffName,
              version_label AS versionLabel, release_note AS releaseNote,
              created_by_user_id AS createdBy, expires_at AS expiresAt, used_at AS usedAt
       FROM capture_session WHERE token_hash = ?`,
    )
    .get(hashToken(token))) as {
      id: string;
      workspaceId: string;
      projectId: string;
      handoffId: string | null;
      handoffName: string | null;
      versionLabel: string;
      releaseNote: string | null;
      createdBy: string;
      expiresAt: string;
      usedAt: string | null;
    } | undefined;
  if (!row || row.usedAt || Date.parse(row.expiresAt) <= Date.now()) return null;
  const memberProject = (await getDatabase()
    .prepare(
      `SELECT 1
       FROM workspace_membership
       JOIN project ON project.workspace_id = workspace_membership.workspace_id
       WHERE workspace_membership.workspace_id = ?
         AND workspace_membership.user_id = ?
         AND workspace_membership.role IN ('owner', 'designer')
         AND project.id = ?`,
    )
    .get(row.workspaceId, row.createdBy, row.projectId));
  if (!memberProject) return null;
  return row;
}

/** Extend a started upload only while the creator still has manager access. */
export async function renewCaptureSession(token: string) {
  const database = getDatabase();
  return database.transaction(async () => {
    const row = (await database
      .prepare(
        `SELECT id, workspace_id AS workspaceId, project_id AS projectId,
                created_by_user_id AS createdBy, created_at AS createdAt,
                expires_at AS expiresAt, used_at AS usedAt
         FROM capture_session WHERE token_hash = ? FOR UPDATE`,
      )
      .get(hashToken(token))) as {
        id: string;
        workspaceId: string;
        projectId: string;
        createdBy: string;
        createdAt: string;
        expiresAt: string;
        usedAt: string | null;
      } | undefined;
    if (!row || row.usedAt) return null;

    const started = (await database
      .prepare(
        `SELECT 1 FROM capture_upload
         WHERE capture_session_id = ? AND is_current AND created_at <= ?
         LIMIT 1`,
      )
      .get(row.id, row.expiresAt));
    if (!started) return null;

    const manager = (await database
      .prepare(
        `SELECT 1 FROM workspace_membership
         JOIN project ON project.workspace_id = workspace_membership.workspace_id
         WHERE workspace_membership.workspace_id = ?
           AND workspace_membership.user_id = ?
           AND workspace_membership.role IN ('owner', 'designer')
           AND project.id = ?`,
      )
      .get(row.workspaceId, row.createdBy, row.projectId));
    if (!manager) return null;

    const now = Date.now();
    const hardDeadline = Date.parse(row.createdAt) + 24 * 60 * 60 * 1000;
    if (now >= hardDeadline) return null;
    const expiresAt = new Date(Math.min(now + 60 * 60 * 1000, hardDeadline)).toISOString();
    (await database
      .prepare("UPDATE capture_session SET expires_at = ? WHERE id = ? AND used_at IS NULL")
      .run(expiresAt, row.id));
    return { expiresAt };
  })();
}

export async function isCaptureSessionExpired(token: string) {
  const row = (await getDatabase()
    .prepare("SELECT id, expires_at AS expiresAt, used_at AS usedAt FROM capture_session WHERE token_hash = ?")
    .get(hashToken(token))) as { id: string; expiresAt: string; usedAt: string | null } | undefined;
  if (!row || row.usedAt || Date.parse(row.expiresAt) > Date.now()) return false;
  return Boolean(await getDatabase()
    .prepare("SELECT 1 FROM capture_upload WHERE capture_session_id = ? AND is_current AND created_at <= ? LIMIT 1")
    .get(row.id, row.expiresAt));
}

/** Return the already-committed version when a client retries after losing the final response. */
export async function getFinalizedCaptureSession(token: string) {
  const row = (await getDatabase()
    .prepare(
      `SELECT capture_session.workspace_id AS workspaceId,
              capture_session.project_id AS projectId,
              capture_session.created_by_user_id AS createdBy,
              handoff_version.id AS versionId,
              handoff_version.handoff_id AS handoffId,
              capture_upload.object_key AS snapshotObjectKey
       FROM capture_session
       JOIN capture_upload ON capture_upload.capture_session_id = capture_session.id
         AND capture_upload.upload_kind = 'snapshot' AND capture_upload.is_current
       JOIN handoff_version ON handoff_version.id = capture_upload.version_id
       WHERE capture_session.token_hash = ? AND capture_session.used_at IS NOT NULL
         AND capture_upload.finalized_at IS NOT NULL`,
    )
    .get(hashToken(token))) as {
      workspaceId: string;
      projectId: string;
      createdBy: string;
      versionId: string;
      handoffId: string;
      snapshotObjectKey: string;
    } | undefined;
  if (!row) return null;

  const manager = (await getDatabase()
    .prepare(
      `SELECT 1 FROM workspace_membership
       JOIN project ON project.workspace_id = workspace_membership.workspace_id
       WHERE workspace_membership.workspace_id = ? AND workspace_membership.user_id = ?
         AND workspace_membership.role IN ('owner', 'designer') AND project.id = ?`,
    )
    .get(row.workspaceId, row.createdBy, row.projectId));
  return manager ? row : null;
}
