import assert from "node:assert/strict";
import Database from "better-sqlite3";
import test, { after } from "node:test";

const priorDatabase = globalThis.__asbirDatabase;
const priorDomains = process.env.ASBIR_ALLOWED_EMAIL_DOMAINS;
const database = new Database(":memory:");
globalThis.__asbirDatabase = database;
process.env.ASBIR_ALLOWED_EMAIL_DOMAINS = "lmf.ventures, @plxrmedia.com";

database.exec(`
  CREATE TABLE workspace (id TEXT PRIMARY KEY, name TEXT, created_at TEXT);
  CREATE TABLE workspace_membership (workspace_id TEXT, user_id TEXT, role TEXT, created_at TEXT, PRIMARY KEY (workspace_id, user_id));
  CREATE TABLE user_profile (user_id TEXT PRIMARY KEY, job_role TEXT NOT NULL, onboarded_at TEXT NOT NULL);
`);
database.prepare("INSERT INTO workspace VALUES ('ws-1', 'LMF', '2026-01-01')").run();
database.prepare("INSERT INTO workspace_membership VALUES ('ws-1', 'owner', 'owner', '2026-01-01')").run();

const { isAllowedEmail, joinableWorkspaces, needsOnboarding, completeOnboarding, getJobRole } = await import("./onboarding.ts");

after(() => {
  globalThis.__asbirDatabase = priorDatabase;
  if (priorDomains === undefined) delete process.env.ASBIR_ALLOWED_EMAIL_DOMAINS;
  else process.env.ASBIR_ALLOWED_EMAIL_DOMAINS = priorDomains;
  database.close();
});

test("only company email domains may sign up", () => {
  assert.equal(isAllowedEmail("ana@lmf.ventures"), true);
  assert.equal(isAllowedEmail("Ben@PLXRMEDIA.com"), true);
  assert.equal(isAllowedEmail("someone@gmail.com"), false);
  assert.equal(isAllowedEmail("x@evil-lmf.ventures"), false);
});

test("unverified or outside emails join nothing", () => {
  assert.deepEqual(joinableWorkspaces({ id: "u1", email: "ana@lmf.ventures", emailVerified: false }), []);
  assert.deepEqual(joinableWorkspaces({ id: "u1", email: "ana@gmail.com", emailVerified: true }), []);
});

test("owners skip onboarding; new teammates pick a role and join as a non-manager", () => {
  assert.equal(needsOnboarding("owner"), false);
  const user = { id: "pm-1", email: "ana@lmf.ventures", emailVerified: true };
  assert.equal(needsOnboarding(user.id), true);

  const joined = completeOnboarding(user, "exec");
  assert.deepEqual(joined.map((workspace) => workspace.id), ["ws-1"]);
  assert.equal(getJobRole(user.id), "exec");
  assert.equal(needsOnboarding(user.id), false);
  const membership = database.prepare("SELECT role FROM workspace_membership WHERE user_id = ?").get(user.id);
  assert.equal(membership.role, "reviewer");

  const dev = { id: "dev-1", email: "dev@plxrmedia.com", emailVerified: 1 };
  completeOnboarding(dev, "dev");
  assert.equal(database.prepare("SELECT role FROM workspace_membership WHERE user_id = ?").get(dev.id).role, "developer");

  const designer = { id: "designer-1", email: "pd@lmf.ventures", emailVerified: true };
  completeOnboarding(designer, "designer");
  assert.equal(database.prepare("SELECT role FROM workspace_membership WHERE user_id = ?").get(designer.id).role, "designer");
  const marketer = { id: "mkt-1", email: "mkt@lmf.ventures", emailVerified: true };
  completeOnboarding(marketer, "marketing");
  assert.equal(database.prepare("SELECT role FROM workspace_membership WHERE user_id = ?").get(marketer.id).role, "reviewer");
});
