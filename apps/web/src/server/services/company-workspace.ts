import { randomUUID } from "node:crypto";
import { getDatabase } from "../db";
import { addSuperadmin } from "./superadmins";

/**
 * The app serves one company, so there is a single workspace under the hood. People only ever see
 * projects; the workspace keeps members, invite links and integrations together.
 */
export async function getCompanyWorkspace() {
  return (await getDatabase()
    .prepare("SELECT id, name FROM workspace ORDER BY created_at ASC, id ASC LIMIT 1")
    .get()) as { id: string; name: string } | undefined;
}

/**
 * On a brand-new install the first person to sign in sets up the company workspace and becomes its
 * owner and an admin. Everyone after them joins through onboarding or an invite.
 */
export async function ensureCompanyWorkspace(user: { id: string; email: string }) {
  const existing = (await getCompanyWorkspace());
  if (existing) return existing;
  const database = getDatabase();
  return database.transaction(async () => {
    // Next renders the layout and page of the first sign-in in parallel, so two requests can both find
    // no workspace. The lock makes the second wait for the first and then reuse what it created,
    // instead of making a second company workspace.
    (await database.prepare("SELECT pg_advisory_xact_lock(?)").get(companyWorkspaceLockKey));
    const created = (await getCompanyWorkspace());
    if (created) return created;
    const workspace = { id: randomUUID(), name: process.env.ASBIR_COMPANY_NAME?.trim() || "Asbir Tech" };
    const now = new Date().toISOString();
    (await database.prepare("INSERT INTO workspace (id, name, created_by_user_id, created_at) VALUES (?, ?, ?, ?)").run(workspace.id, workspace.name, user.id, now));
    (await database.prepare("INSERT INTO workspace_membership (workspace_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)").run(workspace.id, user.id, now));
    (await addSuperadmin(user.email, user.id));
    return workspace;
  })();
}

/** Any fixed number works; it only has to be the same for every request. */
const companyWorkspaceLockKey = 7_301_402_911;
