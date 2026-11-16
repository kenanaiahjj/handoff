import { randomBytes } from "node:crypto";
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
  database
    .prepare('INSERT INTO "user" (id, name, email, emailVerified, image, createdAt, updatedAt) VALUES (?, ?, ?, 1, NULL, ?, ?)')
    .run(user.id, user.name, user.email, now, now);
  return user;
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
