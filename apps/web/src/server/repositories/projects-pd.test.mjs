import assert from "node:assert/strict";
import test, { after } from "node:test";
import { setDatabasePoolForTests } from "../db.ts";
import { createPostgresTestDatabase } from "../test-support/postgres-test-database.mjs";

const fixture = await createPostgresTestDatabase({ seed: true });
const previousPool = globalThis.__asbirDatabase;
setDatabasePoolForTests(fixture.pool);
after(async () => {
  setDatabasePoolForTests(previousPool);
  await fixture.close();
});

const { assignProjectPdInCharge } = await import("./projects.ts");

test("assigning and clearing a project's PD in charge works on PostgreSQL", async () => {
  const input = { workspaceId: "local-test-workspace", projectId: "local-test-project" };
  assert.equal(await assignProjectPdInCharge({ ...input, pdInChargeUserId: "local-test-user" }), true);
  const { rows: [assigned] } = await fixture.pool.query("SELECT pd_in_charge_user_id FROM project WHERE id = 'local-test-project'");
  assert.equal(assigned.pd_in_charge_user_id, "local-test-user");

  assert.equal(await assignProjectPdInCharge({ ...input, pdInChargeUserId: null }), true);
  const { rows: [cleared] } = await fixture.pool.query("SELECT pd_in_charge_user_id FROM project WHERE id = 'local-test-project'");
  assert.equal(cleared.pd_in_charge_user_id, null);

  assert.equal(await assignProjectPdInCharge({ ...input, pdInChargeUserId: "not-a-member" }), false);
});
