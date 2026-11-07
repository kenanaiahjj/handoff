import { randomUUID } from "node:crypto";
import { getDatabase } from "../db";
import type { EvidenceRef, GeneratedChangelog } from "../ai/schema";

export type StoredChangelogDraft = GeneratedChangelog & {
  id: string;
  handoffId: string;
  fromVersionId: string;
  toVersionId: string;
  evidence: EvidenceRef[];
  model: string;
  status: "draft" | "approved";
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

function parseRow(row: Record<string, unknown>): StoredChangelogDraft {
  return {
    id: row.id as string,
    handoffId: row.handoffId as string,
    fromVersionId: row.fromVersionId as string,
    toVersionId: row.toVersionId as string,
    title: row.title as string,
    summary: row.summary as string,
    statements: JSON.parse(row.statementsJson as string) as GeneratedChangelog["statements"],
    evidence: JSON.parse(row.evidenceJson as string) as EvidenceRef[],
    model: row.modelId as string,
    status: row.status as "draft" | "approved",
    createdBy: row.createdBy as string,
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
  };
}

const selectDraftColumns = `id, handoff_id AS handoffId, from_version_id AS fromVersionId,
  to_version_id AS toVersionId, title, summary, statements_json AS statementsJson,
  evidence_json AS evidenceJson, model_id AS modelId, status,
  created_by_user_id AS createdBy, created_at AS createdAt, updated_at AS updatedAt`;

export function listChangelogDrafts(input: { workspaceId: string; handoffId: string }) {
  const rows = getDatabase()
    .prepare(`SELECT ${selectDraftColumns} FROM changelog_draft WHERE workspace_id = ? AND handoff_id = ? ORDER BY updated_at DESC LIMIT 20`)
    .all(input.workspaceId, input.handoffId) as Array<Record<string, unknown>>;
  return rows.map(parseRow);
}

export function createChangelogDraft(input: {
  workspaceId: string;
  handoffId: string;
  fromVersionId: string;
  toVersionId: string;
  title: string;
  summary: string;
  statements: GeneratedChangelog["statements"];
  evidence: EvidenceRef[];
  model: string;
  createdBy: string;
}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `INSERT INTO changelog_draft
        (id, workspace_id, handoff_id, from_version_id, to_version_id, title,
         summary, statements_json, evidence_json, model_id, created_by_user_id,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.workspaceId,
      input.handoffId,
      input.fromVersionId,
      input.toVersionId,
      input.title,
      input.summary,
      JSON.stringify(input.statements),
      JSON.stringify(input.evidence),
      input.model,
      input.createdBy,
      now,
      now,
    );
  return { ...input, id, status: "draft" as const, createdAt: now, updatedAt: now };
}

export function getChangelogDraft(input: { workspaceId: string; handoffId: string; draftId: string }) {
  const row = getDatabase()
    .prepare(`SELECT ${selectDraftColumns} FROM changelog_draft WHERE id = ? AND workspace_id = ? AND handoff_id = ?`)
    .get(input.draftId, input.workspaceId, input.handoffId) as Record<string, unknown> | undefined;
  return row ? parseRow(row) : null;
}

export function updateChangelogDraft(input: {
  workspaceId: string;
  handoffId: string;
  draftId: string;
  title: string;
  summary: string;
  statements: GeneratedChangelog["statements"];
  status: "draft" | "approved";
}) {
  const now = new Date().toISOString();
  const result = getDatabase()
    .prepare(
      `UPDATE changelog_draft SET title = ?, summary = ?, statements_json = ?, status = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ? AND handoff_id = ?`,
    )
    .run(input.title, input.summary, JSON.stringify(input.statements), input.status, now, input.draftId, input.workspaceId, input.handoffId);
  return result.changes === 1;
}
