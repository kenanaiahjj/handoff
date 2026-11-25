import { readFileSync } from "node:fs";
import { getDatabase } from "../db";

export class HandbookError extends Error {}

/** Big enough for the built-in guide (~43 KB) several times over. */
export const handbookMaxLength = 200_000;

let bundledDefault: string | null = null;

/**
 * The built-in guide, docs/figma-naming.md. next.config inlines it at build time so it ships with
 * the server; outside Next (tests, scripts) it is read from the repository.
 */
export function defaultHandbook() {
  if (process.env.ASBIR_DEFAULT_HANDBOOK) return process.env.ASBIR_DEFAULT_HANDBOOK;
  if (bundledDefault === null) {
    try {
      bundledDefault = readFileSync(new URL("../../../../../docs/figma-naming.md", import.meta.url), "utf8");
    } catch {
      bundledDefault = "";
    }
  }
  return bundledDefault;
}

export type Handbook = {
  markdown: string;
  /** True while the workspace still uses the built-in guide. */
  isDefault: boolean;
  updatedAt: string | null;
  updatedByName: string | null;
};

export async function getHandbook(workspaceId: string): Promise<Handbook> {
  const row = (await getDatabase()
    .prepare(
      `SELECT workspace_handbook.markdown, workspace_handbook.updated_at AS updatedAt, "user".name AS updatedByName
       FROM workspace_handbook LEFT JOIN "user" ON "user".id = workspace_handbook.updated_by_user_id
       WHERE workspace_handbook.workspace_id = ?`,
    )
    .get(workspaceId)) as { markdown: string; updatedAt: string; updatedByName: string | null } | undefined;
  if (!row) return { markdown: defaultHandbook(), isDefault: true, updatedAt: null, updatedByName: null };
  return { markdown: row.markdown, isDefault: false, updatedAt: row.updatedAt, updatedByName: row.updatedByName };
}

export async function saveHandbook(workspaceId: string, userId: string, markdown: string) {
  const text = markdown.replace(/\r\n?/g, "\n");
  if (!text.trim()) throw new HandbookError("The handbook can't be empty. Use Reset to go back to the built-in guide.");
  if (text.length > handbookMaxLength) throw new HandbookError("The handbook is too long.");
  await getDatabase()
    .prepare(
      `INSERT INTO workspace_handbook (workspace_id, markdown, updated_by_user_id, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (workspace_id) DO UPDATE SET
         markdown = excluded.markdown, updated_by_user_id = excluded.updated_by_user_id, updated_at = excluded.updated_at`,
    )
    .run(workspaceId, text, userId, new Date().toISOString());
  return getHandbook(workspaceId);
}

/** Drops the workspace's copy so the built-in guide applies again. */
export async function resetHandbook(workspaceId: string) {
  await getDatabase().prepare("DELETE FROM workspace_handbook WHERE workspace_id = ?").run(workspaceId);
  return getHandbook(workspaceId);
}
