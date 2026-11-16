import { getDatabase } from "../db";

export type Superadmin = { email: string; name: string | null; createdAt: string; hasSignedIn: boolean };

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function isSuperadmin(email: string | null | undefined) {
  if (!email) return false;
  return Boolean(getDatabase().prepare("SELECT 1 FROM superadmin WHERE email = ?").get(normalizeEmail(email)));
}

export function listSuperadmins(): Superadmin[] {
  const rows = getDatabase()
    .prepare(
      `SELECT superadmin.email, "user".name, superadmin.created_at AS createdAt, "user".id IS NOT NULL AS hasSignedIn
       FROM superadmin
       LEFT JOIN "user" ON lower("user".email) = superadmin.email
       ORDER BY superadmin.created_at ASC, superadmin.email ASC`,
    )
    .all() as Array<{ email: string; name: string | null; createdAt: string; hasSignedIn: number }>;
  return rows.map((row) => ({ ...row, hasSignedIn: Boolean(row.hasSignedIn) }));
}

/** Makes this person an owner in every workspace. Safe to call on every visit. */
export function syncSuperadminAccess(user: { id: string; email: string }) {
  if (!isSuperadmin(user.email)) return false;
  const database = getDatabase();
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO workspace_membership (workspace_id, user_id, role, created_at)
       SELECT workspace.id, ?, 'owner', ? FROM workspace WHERE true
       ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = 'owner' WHERE workspace_membership.role <> 'owner'`,
    )
    .run(user.id, now);
  return true;
}

/** Adds every super admin who has an account as an owner of a newly created workspace. */
export function addSuperadminsToWorkspace(workspaceId: string) {
  getDatabase()
    .prepare(
      `INSERT OR IGNORE INTO workspace_membership (workspace_id, user_id, role, created_at)
       SELECT ?, "user".id, 'owner', ? FROM superadmin JOIN "user" ON lower("user".email) = superadmin.email`,
    )
    .run(workspaceId, new Date().toISOString());
}

export function addSuperadmin(email: string, invitedByUserId: string) {
  const database = getDatabase();
  const normalized = normalizeEmail(email);
  database
    .prepare("INSERT OR IGNORE INTO superadmin (email, invited_by_user_id, created_at) VALUES (?, ?, ?)")
    .run(normalized, invitedByUserId, new Date().toISOString());
  const existing = database.prepare('SELECT id, email FROM "user" WHERE lower(email) = ?').get(normalized) as
    | { id: string; email: string }
    | undefined;
  if (existing) syncSuperadminAccess(existing);
  return normalized;
}

/**
 * Removes someone from the list. Their workspace memberships stay as they are; change or remove
 * those in each workspace if they should lose access too.
 */
export function removeSuperadmin(email: string) {
  const result = getDatabase().prepare("DELETE FROM superadmin WHERE email = ?").run(normalizeEmail(email));
  return result.changes > 0;
}
