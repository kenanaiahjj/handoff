import { randomUUID } from "node:crypto";
import { getDatabase } from "../db";
import { addSuperadmin } from "./superadmins";

/**
 * The app serves one company, so there is a single workspace under the hood. People only ever see
 * projects; the workspace keeps members, invite links and integrations together.
 */
export function getCompanyWorkspace() {
  return getDatabase()
    .prepare("SELECT id, name FROM workspace ORDER BY created_at ASC, id ASC LIMIT 1")
    .get() as { id: string; name: string } | undefined;
}

/**
 * On a brand-new install the first person to sign in sets up the company workspace and becomes its
 * owner and an admin. Everyone after them joins through onboarding or an invite.
 */
export function ensureCompanyWorkspace(user: { id: string; email: string }) {
  const existing = getCompanyWorkspace();
  if (existing) return existing;
  const database = getDatabase();
  const workspace = { id: randomUUID(), name: process.env.ASBIR_COMPANY_NAME?.trim() || "Asbir Tech" };
  const now = new Date().toISOString();
  database.transaction(() => {
    database.prepare("INSERT INTO workspace (id, name, created_by_user_id, created_at) VALUES (?, ?, ?, ?)").run(workspace.id, workspace.name, user.id, now);
    database.prepare("INSERT INTO workspace_membership (workspace_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)").run(workspace.id, user.id, now);
    addSuperadmin(user.email, user.id);
  })();
  return workspace;
}
