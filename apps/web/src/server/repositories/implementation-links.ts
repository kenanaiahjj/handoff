import { randomUUID } from "node:crypto";
import { getDatabase } from "../db";

export type ImplementationLink = {
  id: string;
  targetKind: "component" | "element";
  targetId: string;
  targetName: string | null;
  codeComponent: string | null;
  codePath: string;
  notes: string | null;
  updatedAt: string;
};

const columns = `id, target_kind AS "targetKind", target_id AS "targetId", target_name AS "targetName",
  code_component AS "codeComponent", code_path AS "codePath", notes, updated_at AS "updatedAt"`;

/** Links for a workspace, optionally only for these component or layer ids. */
export async function listImplementationLinks(workspaceId: string, targetIds?: string[]) {
  if (targetIds && !targetIds.length) return [];
  const rows = (await getDatabase()
    .prepare(`SELECT ${columns} FROM implementation_link WHERE workspace_id = ? ORDER BY target_name NULLS LAST, target_id LIMIT 2000`)
    .all(workspaceId)) as ImplementationLink[];
  if (!targetIds) return rows;
  const wanted = new Set(targetIds);
  return rows.filter((row) => wanted.has(row.targetId));
}

/** Creates or replaces the link for one component or layer. */
export async function upsertImplementationLink(input: {
  workspaceId: string;
  targetKind: "component" | "element";
  targetId: string;
  targetName: string | null;
  codeComponent: string | null;
  codePath: string;
  notes: string | null;
  userId: string;
}) {
  const now = new Date().toISOString();
  await getDatabase()
    .prepare(
      `INSERT INTO implementation_link
         (id, workspace_id, target_kind, target_id, target_name, code_component, code_path, notes, created_by_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (workspace_id, target_kind, target_id) DO UPDATE SET
         target_name = excluded.target_name, code_component = excluded.code_component, code_path = excluded.code_path,
         notes = excluded.notes, updated_at = excluded.updated_at`,
    )
    .run(randomUUID(), input.workspaceId, input.targetKind, input.targetId, input.targetName, input.codeComponent, input.codePath, input.notes, input.userId, now, now);
  return (await getDatabase()
    .prepare(`SELECT ${columns} FROM implementation_link WHERE workspace_id = ? AND target_kind = ? AND target_id = ?`)
    .get(input.workspaceId, input.targetKind, input.targetId)) as ImplementationLink;
}

export async function deleteImplementationLink(workspaceId: string, targetKind: "component" | "element", targetId: string) {
  const result = await getDatabase()
    .prepare("DELETE FROM implementation_link WHERE workspace_id = ? AND target_kind = ? AND target_id = ?")
    .run(workspaceId, targetKind, targetId);
  return result.changes === 1;
}
