import assert from "node:assert/strict";
import Database from "better-sqlite3";
import test, { after } from "node:test";

const priorDatabase = globalThis.__asbirDatabase;
const priorDomains = process.env.ASBIR_ALLOWED_EMAIL_DOMAINS;
const database = new Database(":memory:");
database.pragma("foreign_keys = ON");
globalThis.__asbirDatabase = database;
process.env.ASBIR_ALLOWED_EMAIL_DOMAINS = "lmf.ventures";

database.exec(`
  CREATE TABLE "user" (id TEXT PRIMARY KEY, name TEXT, email TEXT, emailVerified INTEGER, image TEXT, createdAt TEXT, updatedAt TEXT);
  CREATE TABLE workspace_membership (workspace_id TEXT, user_id TEXT REFERENCES "user" (id) ON DELETE CASCADE, role TEXT);
  CREATE TABLE user_profile (user_id TEXT PRIMARY KEY REFERENCES "user" (id) ON DELETE CASCADE, job_role TEXT);
  CREATE TABLE handoff_comment (id TEXT, created_by_user_id TEXT REFERENCES "user" (id) ON DELETE RESTRICT);
`);
database.prepare(`INSERT INTO "user" (id, name, email, emailVerified) VALUES ('owner', 'Owner', 'owner@gmail.com', 1)`).run();

const { createDevTestAccount, deleteDevTestAccounts, isDevTestAccount } = await import("./dev-test-accounts.ts");
const { viewAsModeFor } = await import("../auth-session.ts");

after(() => {
  globalThis.__asbirDatabase = priorDatabase;
  if (priorDomains === undefined) delete process.env.ASBIR_ALLOWED_EMAIL_DOMAINS;
  else process.env.ASBIR_ALLOWED_EMAIL_DOMAINS = priorDomains;
  database.close();
});

test("fresh accounts are verified company accounts with no workspace or role", () => {
  const user = createDevTestAccount();
  assert.ok(isDevTestAccount(user.id));
  assert.match(user.email, /@lmf\.ventures$/);
  assert.equal(viewAsModeFor(user), "test");
  const row = database.prepare('SELECT emailVerified FROM "user" WHERE id = ?').get(user.id);
  assert.equal(row.emailVerified, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM workspace_membership WHERE user_id = ?").get(user.id).n, 0);
});

test("cleanup removes test accounts, keeps ones with history but strips their access, never touches real users", () => {
  const withHistory = createDevTestAccount({ name: "Has Comments" });
  database.prepare("INSERT INTO workspace_membership VALUES ('ws', ?, 'developer')").run(withHistory.id);
  database.prepare("INSERT INTO handoff_comment VALUES ('c1', ?)").run(withHistory.id);

  const result = deleteDevTestAccounts();
  assert.deepEqual(result, { deleted: 1, kept: 1 });
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM workspace_membership WHERE user_id = ?").get(withHistory.id).n, 0);
  assert.ok(database.prepare(`SELECT 1 FROM "user" WHERE id = 'owner'`).get());
});
