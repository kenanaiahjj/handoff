import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getDatabase } from "../db";
import { allowedEmailDomains } from "./onboarding";

/** Every throwaway account id starts with this, so they can be listed and cleaned up together. */
export const devTestAccountPrefix = "dev-test-";

const firstNames = ["Alex", "Bea", "Carlo", "Dana", "Eli", "Faye", "Gio", "Hana", "Ivan", "Jules", "Kai", "Lia", "Migs", "Nina", "Oli", "Pia"];

export function isDevTestAccount(userId: string) {
  return userId.startsWith(devTestAccountPrefix);
}

/**
 * Creates a brand-new verified company account with no role and no workspace, exactly like someone
 * signing in with Google for the first time. Development only (the caller checks).
 */
export function createDevTestAccount(input: { name?: string } = {}) {
  const database = getDatabase();
  const suffix = randomBytes(3).toString("hex");
  const count = (database.prepare('SELECT COUNT(*) AS total FROM "user" WHERE id LIKE ?').get(`${devTestAccountPrefix}%`) as { total: number }).total;
  const firstName = firstNames[count % firstNames.length];
  const name = input.name?.trim() || `${firstName} Tester`;
  const domain = allowedEmailDomains()[0] ?? "example.com";
  const user = {
    id: `${devTestAccountPrefix}${suffix}`,
    name,
    email: `${firstName.toLowerCase()}.test.${suffix}@${domain}`,
  };
  const now = new Date().toISOString();
  database.transaction(() => {
    database
      .prepare('INSERT INTO "user" (id, name, email, emailVerified, image, createdAt, updatedAt) VALUES (?, ?, ?, 1, NULL, ?, ?)')
      .run(user.id, user.name, user.email, now, now);
    shareSampleHandoffs(user, now);
  })();
  return user;
}

/**
 * Shares the sample handoffs with a new test account so the reviewer home has something to show
 * after onboarding: the same set the seeded dev reviewer sees (or every handoff if there is none).
 * About half start as already opened, so some show "New version" and some don't.
 */
function shareSampleHandoffs(user: { id: string; email: string }, now: string) {
  const database = getDatabase();
  const reviewerShared = database
    .prepare(
      `SELECT DISTINCT handoff_id AS handoffId FROM handoff_invite
       WHERE email = ? AND revoked_at IS NULL`,
    )
    .all("reviewer@asbir.invalid") as Array<{ handoffId: string }>;
  const handoffs = database
    .prepare(
      `SELECT handoff.id, handoff.workspace_id AS workspaceId, handoff.created_by_user_id AS createdBy,
              (SELECT id FROM handoff_version WHERE handoff_version.handoff_id = handoff.id
                 ORDER BY created_at DESC, id DESC LIMIT 1) AS latestVersionId
       FROM handoff ORDER BY handoff.created_at ASC`,
    )
    .all() as Array<{ id: string; workspaceId: string; createdBy: string; latestVersionId: string | null }>;
  const shared = new Set(reviewerShared.map((row) => row.handoffId));
  const picked = handoffs.filter((handoff) => handoff.latestVersionId && (!shared.size || shared.has(handoff.id)));

  const invite = database.prepare(
    `INSERT OR IGNORE INTO handoff_invite (id, workspace_id, handoff_id, email, token_hash, expires_at, revoked_at, invited_by_user_id, created_at, role)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, 'exec')`,
  );
  const seen = database.prepare(
    `INSERT OR IGNORE INTO handoff_view (user_id, workspace_id, handoff_id, last_seen_version_id, seen_at) VALUES (?, ?, ?, ?, ?)`,
  );
  picked.forEach((handoff, index) => {
    const tokenHash = createHash("sha256").update(randomBytes(32)).digest("hex");
    invite.run(randomUUID(), handoff.workspaceId, handoff.id, user.email.toLowerCase(), tokenHash, handoff.createdBy, now);
    if (index % 2 === 1) seen.run(user.id, handoff.workspaceId, handoff.id, handoff.latestVersionId, now);
  });
}

/**
 * Deletes every throwaway account. One that left comments or uploads can't be deleted without losing
 * that history, so it only loses its workspaces and role instead.
 */
export function deleteDevTestAccounts() {
  const database = getDatabase();
  const ids = (database.prepare('SELECT id FROM "user" WHERE id LIKE ?').all(`${devTestAccountPrefix}%`) as Array<{ id: string }>).map((row) => row.id);
  let deleted = 0;
  let kept = 0;
  // Their sample shares go too (invites are kept by email, not by account).
  database
    .prepare(`DELETE FROM handoff_invite WHERE email IN (SELECT lower(email) FROM "user" WHERE id LIKE ?)`)
    .run(`${devTestAccountPrefix}%`);
  for (const id of ids) {
    try {
      database.prepare('DELETE FROM "user" WHERE id = ?').run(id);
      deleted += 1;
    } catch {
      database.prepare("DELETE FROM workspace_membership WHERE user_id = ?").run(id);
      database.prepare("DELETE FROM user_profile WHERE user_id = ?").run(id);
      kept += 1;
    }
  }
  return { deleted, kept };
}
