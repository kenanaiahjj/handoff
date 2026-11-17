import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getDatabase } from "../db";
import { allowedEmailDomains } from "./onboarding";

/** Every throwaway account id starts with this, so they can be listed and cleaned up together. */
export const devTestAccountPrefix = "dev-test-";

const firstNames = ["Alex", "Bea", "Carlo", "Dana", "Eli", "Faye", "Gio", "Hana", "Ivan", "Jules", "Kai", "Lia", "Migs", "Nina", "Oli", "Pia"];

export function isDevTestAccount(userId: string) {
  return userId.startsWith(devTestAccountPrefix);
}

async function hasProtectedUserHistory(userId: string) {
  const database = getDatabase();
  const references = await database.query<{ table_name: string; column_name: string }>(
    `SELECT child.relname AS table_name, child_column.attname AS column_name
     FROM pg_constraint AS foreign_key
     JOIN pg_class AS child ON child.oid = foreign_key.conrelid
     JOIN pg_namespace AS child_schema ON child_schema.oid = child.relnamespace
     JOIN LATERAL unnest(foreign_key.conkey) AS child_key(attnum) ON true
     JOIN pg_attribute AS child_column
       ON child_column.attrelid = child.oid AND child_column.attnum = child_key.attnum
     WHERE foreign_key.confrelid = '"user"'::regclass
       AND foreign_key.contype = 'f'
       AND foreign_key.confdeltype IN ('a', 'r')
       AND child_schema.nspname = 'public'`,
  );
  if (!references.rows.length) return false;

  const conditions = references.rows.map(({ table_name, column_name }) => {
    const table = `"${table_name.replaceAll('"', '""')}"`;
    const column = `"${column_name.replaceAll('"', '""')}"`;
    return `EXISTS (SELECT 1 FROM public.${table} WHERE ${column} = $1)`;
  });
  const result = await database.query<{ has_history: boolean }>(
    `SELECT ${conditions.join(" OR ")} AS has_history`,
    [userId],
  );
  return result.rows[0]?.has_history ?? false;
}

/**
 * Creates a brand-new verified company account with no role and no workspace, exactly like someone
 * signing in with Google for the first time. Development only (the caller checks).
 */
export async function createDevTestAccount(input: { name?: string } = {}) {
  const database = getDatabase();
  const suffix = randomBytes(3).toString("hex");
  const count = ((await database.prepare('SELECT COUNT(*) AS total FROM "user" WHERE id LIKE ?').get(`${devTestAccountPrefix}%`)) as { total: number }).total;
  const firstName = firstNames[count % firstNames.length];
  const name = input.name?.trim() || `${firstName} Tester`;
  const domain = allowedEmailDomains()[0] ?? "example.com";
  const user = {
    id: `${devTestAccountPrefix}${suffix}`,
    name,
    email: `${firstName.toLowerCase()}.test.${suffix}@${domain}`,
  };
  const now = new Date().toISOString();
  await database.transaction(async () => {
    (await database
      .prepare('INSERT INTO "user" (id, name, email, emailVerified, image, createdAt, updatedAt) VALUES (?, ?, ?, true, NULL, ?, ?)')
      .run(user.id, user.name, user.email, now, now));
    (await shareSampleHandoffs(user, now));
  })();
  return user;
}

/**
 * The seeded dev reviewer ("Riley Reviewer"): makes sure they are a reviewer on the team and, if
 * nothing is shared with them yet, shares the sample handoffs so the reviewer home has content.
 * Development only (the caller checks).
 */
export async function ensureLocalReviewer(workspaceId: string, reviewer: { id: string; name: string; email: string }) {
  const database = getDatabase();
  const now = new Date().toISOString();
  await database.transaction(async () => {
    (await database
      .prepare('INSERT INTO "user" (id, name, email, emailVerified, image, createdAt, updatedAt) VALUES (?, ?, ?, false, NULL, ?, ?) ON CONFLICT DO NOTHING')
      .run(reviewer.id, reviewer.name, reviewer.email, now, now));
    (await database
      .prepare(
        `INSERT INTO workspace_membership (workspace_id, user_id, role, created_at)
         SELECT ?, ?, 'reviewer', ?
         WHERE NOT EXISTS (SELECT 1 FROM workspace_membership WHERE workspace_id = ? AND user_id = ?)`,
      )
      .run(workspaceId, reviewer.id, now, workspaceId, reviewer.id));
    const shared = (await database
      .prepare("SELECT COUNT(*) AS total FROM handoff_invite WHERE email = ? AND revoked_at IS NULL")
      .get(reviewer.email)) as { total: number };
    if (!shared.total) (await shareSampleHandoffs(reviewer, now));
  })();
}

/**
 * Shares the sample handoffs with a new test account so the reviewer home has something to show
 * after onboarding: the same set the seeded dev reviewer sees (or every handoff if there is none).
 * About half start as already opened, so some show "New version" and some don't.
 */
async function shareSampleHandoffs(user: { id: string; email: string }, now: string) {
  const database = getDatabase();
  const reviewerShared = (await database
    .prepare(
      `SELECT DISTINCT handoff_id AS handoffId FROM handoff_invite
       WHERE email = ? AND revoked_at IS NULL`,
    )
    .all("reviewer@asbir.invalid")) as Array<{ handoffId: string }>;
  const handoffs = (await database
    .prepare(
      `SELECT handoff.id, handoff.workspace_id AS workspaceId, handoff.created_by_user_id AS createdBy,
              (SELECT id FROM handoff_version WHERE handoff_version.handoff_id = handoff.id
                 ORDER BY created_at DESC, id DESC LIMIT 1) AS latestVersionId
       FROM handoff ORDER BY handoff.created_at ASC`,
    )
    .all()) as Array<{ id: string; workspaceId: string; createdBy: string; latestVersionId: string | null }>;
  const shared = new Set(reviewerShared.map((row) => row.handoffId));
  const picked = handoffs.filter((handoff) => handoff.latestVersionId && (!shared.size || shared.has(handoff.id)));

  const invite = database.prepare(
    `INSERT INTO handoff_invite (id, workspace_id, handoff_id, email, token_hash, expires_at, revoked_at, invited_by_user_id, created_at, role)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, 'exec') ON CONFLICT DO NOTHING`,
  );
  const seen = database.prepare(
    `INSERT INTO handoff_view (user_id, workspace_id, handoff_id, last_seen_version_id, seen_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
  );
  for (const [index, handoff] of picked.entries()) {
    const tokenHash = createHash("sha256").update(randomBytes(32)).digest("hex");
    await invite.run(randomUUID(), handoff.workspaceId, handoff.id, user.email.toLowerCase(), tokenHash, handoff.createdBy, now);
    if (index % 2 === 1) await seen.run(user.id, handoff.workspaceId, handoff.id, handoff.latestVersionId, now);
  }
}

/**
 * Deletes every throwaway account. One that left comments or uploads can't be deleted without losing
 * that history, so it only loses its workspaces and role instead.
 */
export async function deleteDevTestAccounts() {
  const database = getDatabase();
  const ids = ((await database.prepare('SELECT id FROM "user" WHERE id LIKE ?').all(`${devTestAccountPrefix}%`)) as Array<{ id: string }>).map((row) => row.id);
  let deleted = 0;
  let kept = 0;
  // Their sample shares go too (invites are kept by email, not by account).
  (await database
    .prepare(`DELETE FROM handoff_invite WHERE email IN (SELECT lower(email) FROM "user" WHERE id LIKE ?)`)
    .run(`${devTestAccountPrefix}%`));
  for (const id of ids) {
    if (await hasProtectedUserHistory(id)) {
      (await database.prepare("DELETE FROM workspace_membership WHERE user_id = ?").run(id));
      (await database.prepare("DELETE FROM user_profile WHERE user_id = ?").run(id));
      kept += 1;
    } else {
      (await database.prepare('DELETE FROM "user" WHERE id = ?').run(id));
      deleted += 1;
    }
  }
  return { deleted, kept };
}
