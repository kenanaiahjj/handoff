import { randomUUID } from "node:crypto";
import { getDatabase } from "../db";

export type ProgressStatus = "todo" | "in_progress" | "done" | "skipped";

export type ImplementationProgress = {
  taskId: string;
  frameId: string;
  nodeId: string | null;
  status: ProgressStatus;
  codePath: string | null;
  note: string | null;
  updatedByUserId: string | null;
  updatedAt: string;
};

const columns = `task_id AS "taskId", frame_id AS "frameId", node_id AS "nodeId", status, code_path AS "codePath",
  note, updated_by_user_id AS "updatedByUserId", updated_at AS "updatedAt"`;

/** Progress recorded against one handoff version's tasks. */
export async function listImplementationProgress(workspaceId: string, versionId: string) {
  return (await getDatabase()
    .prepare(`SELECT ${columns} FROM implementation_progress WHERE workspace_id = ? AND version_id = ? ORDER BY updated_at DESC LIMIT 5000`)
    .all(workspaceId, versionId)) as ImplementationProgress[];
}

export async function upsertImplementationProgress(input: {
  workspaceId: string;
  handoffId: string;
  versionId: string;
  taskId: string;
  frameId: string;
  nodeId: string | null;
  status: ProgressStatus;
  codePath: string | null;
  note: string | null;
  userId: string;
}) {
  const now = new Date().toISOString();
  await getDatabase()
    .prepare(
      `INSERT INTO implementation_progress
         (id, workspace_id, handoff_id, version_id, task_id, frame_id, node_id, status, code_path, note, updated_by_user_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (workspace_id, version_id, task_id) DO UPDATE SET
         status = excluded.status, code_path = COALESCE(excluded.code_path, implementation_progress.code_path),
         note = COALESCE(excluded.note, implementation_progress.note),
         updated_by_user_id = excluded.updated_by_user_id, updated_at = excluded.updated_at`,
    )
    .run(randomUUID(), input.workspaceId, input.handoffId, input.versionId, input.taskId, input.frameId, input.nodeId, input.status, input.codePath, input.note, input.userId, now);
  return (await getDatabase()
    .prepare(`SELECT ${columns} FROM implementation_progress WHERE workspace_id = ? AND version_id = ? AND task_id = ?`)
    .get(input.workspaceId, input.versionId, input.taskId)) as ImplementationProgress;
}
