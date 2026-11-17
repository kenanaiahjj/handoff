import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createPostgresTestFixture } from "../test-support/postgres-test-fixture.mjs";

const fixture = await createPostgresTestFixture();
const { database, pool } = fixture;
const priorDomains = process.env.ASBIR_ALLOWED_EMAIL_DOMAINS;
process.env.ASBIR_ALLOWED_EMAIL_DOMAINS = "lmf.ventures, @plxrmedia.com";

await pool.query(`
  CREATE TABLE workspace (id TEXT PRIMARY KEY, name TEXT, created_at TEXT);
  CREATE TABLE workspace_membership (workspace_id TEXT, user_id TEXT, role TEXT, created_at TEXT, PRIMARY KEY (workspace_id, user_id));
  CREATE TABLE user_profile (user_id TEXT PRIMARY KEY, job_role TEXT NOT NULL, onboarded_at TEXT NOT NULL, requested_role TEXT);
`);
await database.prepare("INSERT INTO workspace VALUES ('ws-1', 'LMF', '2026-01-01')").run();
await database.prepare("INSERT INTO workspace_membership VALUES ('ws-1', 'owner', 'owner', '2026-01-01')").run();

const { isAllowedEmail, joinableWorkspaces, needsOnboarding, completeOnboarding, getJobRole } = await import("./onboarding.ts");

after(async () => {
  if (priorDomains === undefined) delete process.env.ASBIR_ALLOWED_EMAIL_DOMAINS;
  else process.env.ASBIR_ALLOWED_EMAIL_DOMAINS = priorDomains;
  await fixture.close();
});

test("only company email domains may sign up", () => {
  assert.equal(isAllowedEmail("ana@lmf.ventures"), true);
  assert.equal(isAllowedEmail("Ben@PLXRMEDIA.com"), true);
  assert.equal(isAllowedEmail("someone@gmail.com"), false);
  assert.equal(isAllowedEmail("x@evil-lmf.ventures"), false);
});

test("unverified or outside emails join nothing", async () => {
  assert.deepEqual(await joinableWorkspaces({ id: "u1", email: "ana@lmf.ventures", emailVerified: false }), []);
  assert.deepEqual(await joinableWorkspaces({ id: "u1", email: "ana@gmail.com", emailVerified: true }), []);
});

test("owners skip onboarding; new teammates pick a role and join as a non-manager", async () => {
  assert.equal(await needsOnboarding("owner"), false);
  const user = { id: "pm-1", email: "ana@lmf.ventures", emailVerified: true };
  assert.equal(await needsOnboarding(user.id), true);

  const joined = await completeOnboarding(user, "exec");
  assert.deepEqual(joined.map((workspace) => workspace.id), ["ws-1"]);
  assert.equal(await getJobRole(user.id), "exec");
  assert.equal(await needsOnboarding(user.id), false);
  const membership = await database.prepare("SELECT role FROM workspace_membership WHERE user_id = ?").get(user.id);
  assert.equal(membership.role, "reviewer");

  const dev = { id: "dev-1", email: "dev@plxrmedia.com", emailVerified: 1 };
  await completeOnboarding(dev, "dev");
  assert.equal((await database.prepare("SELECT role FROM workspace_membership WHERE user_id = ?").get(dev.id)).role, "developer");

  const designer = { id: "designer-1", email: "pd@lmf.ventures", emailVerified: true };
  await completeOnboarding(designer, "designer");
  assert.equal((await database.prepare("SELECT role FROM workspace_membership WHERE user_id = ?").get(designer.id)).role, "reviewer");
  // Designer access waits for an owner's approval.
  assert.equal((await database.prepare("SELECT requested_role FROM user_profile WHERE user_id = ?").get(designer.id)).requested_role, "designer");
  const marketer = { id: "mkt-1", email: "mkt@lmf.ventures", emailVerified: true };
  await completeOnboarding(marketer, "marketing");
  assert.equal((await database.prepare("SELECT role FROM workspace_membership WHERE user_id = ?").get(marketer.id)).role, "reviewer");
  assert.equal((await database.prepare("SELECT requested_role FROM user_profile WHERE user_id = ?").get(marketer.id)).requested_role, null);
});
