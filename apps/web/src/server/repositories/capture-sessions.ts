import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getDatabase } from "../db";

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function createCaptureSession(input: {
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
  getDatabase()
    .prepare(
      `INSERT INTO capture_session
        (id, workspace_id, project_id, handoff_id, handoff_name, version_label,
         release_note, created_by_user_id, token_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, input.workspaceId, input.projectId, input.handoffId, input.handoffName, input.versionLabel.trim(), input.releaseNote?.trim() || null, input.createdBy, hashToken(token), expiresAt, createdAt.toISOString());
  return { id, token, expiresAt };
}

export function getCaptureSession(token: string) {
  const row = getDatabase()
    .prepare(
      `SELECT id, workspace_id AS workspaceId, project_id AS projectId,
              handoff_id AS handoffId, handoff_name AS handoffName,
              version_label AS versionLabel, release_note AS releaseNote,
              created_by_user_id AS createdBy, expires_at AS expiresAt, used_at AS usedAt
       FROM capture_session WHERE token_hash = ?`,
    )
    .get(hashToken(token)) as {
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
  const memberProject = getDatabase()
    .prepare(
      `SELECT 1
       FROM workspace_membership
       JOIN project ON project.workspace_id = workspace_membership.workspace_id
       WHERE workspace_membership.workspace_id = ?
         AND workspace_membership.user_id = ?
         AND project.id = ?`,
    )
    .get(row.workspaceId, row.createdBy, row.projectId);
  if (!memberProject) return null;
  return row;
}
