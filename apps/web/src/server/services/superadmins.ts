import { getDatabase } from "../db";

/**
 * Owners added by email (stored in the `superadmin` table for history). They become owners on
 * sign-in and may use an email outside the company domains. In the app this is just "Owner".
 */
export type Superadmin = { email: string; name: string | null; createdAt: string; hasSignedIn: boolean };

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function isSuperadmin(email: string | null | undefined) {
  if (!email) return false;
  return Boolean((await getDatabase().prepare("SELECT 1 FROM superadmin WHERE email = ?").get(normalizeEmail(email))));
}

export async function listSuperadmins(): Promise<Superadmin[]> {
  const rows = (await getDatabase()
    .prepare(
      `SELECT superadmin.email, "user".name, superadmin.created_at AS createdAt, "user".id IS NOT NULL AS hasSignedIn
       FROM superadmin
       LEFT JOIN "user" ON lower("user".email) = superadmin.email
       ORDER BY superadmin.created_at ASC, superadmin.email COLLATE "C" ASC`,
    )
    .all()) as Array<{ email: string; name: string | null; createdAt: string; hasSignedIn: boolean }>;
  return rows.map((row) => ({ ...row, hasSignedIn: Boolean(row.hasSignedIn) }));
}

/** Makes this person an owner in every workspace. Safe to call on every visit. */
export async function syncSuperadminAccess(user: { id: string; email: string }) {
  if (!(await isSuperadmin(user.email))) return false;
  const database = getDatabase();
  const now = new Date().toISOString();
  (await database
    .prepare(
      `INSERT INTO workspace_membership (workspace_id, user_id, role, created_at)
       SELECT workspace.id, ?, 'owner', ? FROM workspace WHERE true
       ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = 'owner' WHERE workspace_membership.role <> 'owner'`,
    )
    .run(user.id, now));
  return true;
}

/** Adds every super admin who has an account as an owner of a newly created workspace. */
export async function addSuperadminsToWorkspace(workspaceId: string) {
  (await getDatabase()
    .prepare(
      `INSERT INTO workspace_membership (workspace_id, user_id, role, created_at)
       SELECT ?, "user".id, 'owner', ? FROM superadmin JOIN "user" ON lower("user".email) = superadmin.email
       ON CONFLICT DO NOTHING`,
    )
    .run(workspaceId, new Date().toISOString()));
}

export async function addSuperadmin(email: string, invitedByUserId: string) {
  const database = getDatabase();
  const normalized = normalizeEmail(email);
  (await database
    .prepare("INSERT INTO superadmin (email, invited_by_user_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING")
    .run(normalized, invitedByUserId, new Date().toISOString()));
  const existing = (await database.prepare('SELECT id, email FROM "user" WHERE lower(email) = ?').get(normalized)) as
    | { id: string; email: string }
    | undefined;
  if (existing) (await syncSuperadminAccess(existing));
  return normalized;
}

/**
 * Removes someone from the list. Their workspace memberships stay as they are; change or remove
 * those in each workspace if they should lose access too.
 */
export async function removeSuperadmin(email: string) {
  const result = (await getDatabase().prepare("DELETE FROM superadmin WHERE email = ?").run(normalizeEmail(email)));
  return result.changes > 0;
}
