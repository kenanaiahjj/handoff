import { randomUUID } from "node:crypto";
import { getDatabase } from "../db";

export type LinkedExternalTaskInput = {
  workspaceId: string;
  handoffId: string;
  versionId: string;
  sourceSystem: string;
  externalTaskId: string | null;
  externalUrl: string | null;
  title: string;
  description: string;
  evidence: Record<string, unknown>;
  createdBy: string;
};

export function createLinkedExternalTask(input: LinkedExternalTaskInput) {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  getDatabase()
    .prepare(
      `INSERT INTO linked_external_task
        (id, workspace_id, handoff_id, version_id, source_system,
         external_task_id, external_url, title, description, evidence_json,
         created_by_user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.workspaceId,
      input.handoffId,
      input.versionId,
      input.sourceSystem,
      input.externalTaskId,
      input.externalUrl,
      input.title,
      input.description,
      JSON.stringify(input.evidence),
      input.createdBy,
      createdAt,
    );
  return {
    id,
    versionId: input.versionId,
    sourceSystem: input.sourceSystem,
    externalTaskId: input.externalTaskId,
    externalUrl: input.externalUrl,
    agentRunUrl: null,
    pullRequestUrl: null,
    title: input.title,
    description: input.description,
    evidence: input.evidence,
    createdAt,
  };
}

export function listLinkedExternalTasks(input: { workspaceId: string; handoffId: string }) {
  return getDatabase()
    .prepare(
      `SELECT id, version_id AS versionId, source_system AS sourceSystem,
              external_task_id AS externalTaskId, external_url AS externalUrl,
              agent_run_url AS agentRunUrl, pull_request_url AS pullRequestUrl,
              title, description, evidence_json AS evidenceJson, created_at AS createdAt
       FROM linked_external_task
       WHERE workspace_id = ? AND handoff_id = ?
       ORDER BY created_at DESC LIMIT 100`,
    )
    .all(input.workspaceId, input.handoffId)
    .map((row) => {
      const record = row as Record<string, unknown>;
      return {
        ...record,
        evidence: JSON.parse(record.evidenceJson as string) as Record<string, unknown>,
        evidenceJson: undefined,
      };
    });
}

export function listLinkedExternalTasksPage(input: { workspaceId: string; handoffId: string; offset: number; limit: number }) {
  const database = getDatabase();
  const total = (database
    .prepare("SELECT COUNT(*) AS total FROM linked_external_task WHERE workspace_id = ? AND handoff_id = ?")
    .get(input.workspaceId, input.handoffId) as { total: number }).total;
  const rows = database
    .prepare(
      `SELECT id, version_id AS versionId, source_system AS sourceSystem,
              external_task_id AS externalTaskId, external_url AS externalUrl,
              agent_run_url AS agentRunUrl, pull_request_url AS pullRequestUrl,
              title, description, evidence_json AS evidenceJson, created_at AS createdAt
       FROM linked_external_task
       WHERE workspace_id = ? AND handoff_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(input.workspaceId, input.handoffId, input.limit, input.offset);
  const items = rows.map((row) => {
    const record = row as Record<string, unknown>;
    return {
      ...record,
      evidence: JSON.parse(record.evidenceJson as string) as Record<string, unknown>,
      evidenceJson: undefined,
    };
  });

  return { items, total };
}

export function updateLinkedExternalTaskWorkLinks(input: {
  workspaceId: string;
  handoffId: string;
  taskId: string;
  agentRunUrl: string | null;
  pullRequestUrl: string | null;
}) {
  const result = getDatabase()
    .prepare(
      `UPDATE linked_external_task
       SET agent_run_url = ?, pull_request_url = ?
       WHERE id = ? AND workspace_id = ? AND handoff_id = ?`,
    )
    .run(input.agentRunUrl, input.pullRequestUrl, input.taskId, input.workspaceId, input.handoffId);
  return result.changes === 1;
}
