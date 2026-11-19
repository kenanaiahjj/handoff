import assert from "node:assert/strict";
import test from "node:test";
import { mergeDuplicateWorkspaces } from "./merge-duplicate-workspaces.mjs";
import { createPostgresTestDatabase } from "../src/server/test-support/postgres-test-database.mjs";
import { getDatabase, setDatabasePoolForTests } from "../src/server/db.ts";
import { ensureCompanyWorkspace } from "../src/server/services/company-workspace.ts";

const keeperId = "workspace-keep";
const duplicateId = "workspace-dup";
const hash = (c) => c.repeat(64);

async function seed(client) {
  const run = (sql, params = []) => client.query(sql, params);
  for (const [id, email] of [["owner", "owner@example.invalid"], ["designer", "designer@example.invalid"], ["dev", "dev@example.invalid"]]) {
    await run(`INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES ($1, $1, $2, true, now(), now())`, [id, email]);
  }
  await run("INSERT INTO workspace (id, name, created_by_user_id, created_at) VALUES ($1, 'Asbir Tech', 'owner', '2026-11-18T08:00:00.000Z')", [keeperId]);
  await run("INSERT INTO workspace (id, name, created_by_user_id, created_at, allowed_email_domains) VALUES ($1, 'Asbir Tech', 'owner', '2026-11-18T08:00:00.050Z', 'example.invalid')", [duplicateId]);
  // The owner is in both; the designer only in the duplicate, where they own it; the dev only in the keeper.
  await run("INSERT INTO workspace_membership VALUES ($1, 'owner', 'designer', now())", [keeperId]);
  await run("INSERT INTO workspace_membership VALUES ($1, 'owner', 'owner', now())", [duplicateId]);
  await run("INSERT INTO workspace_membership VALUES ($1, 'designer', 'owner', now())", [duplicateId]);
  await run("INSERT INTO workspace_membership VALUES ($1, 'dev', 'developer', now())", [keeperId]);

  await run("INSERT INTO project (id, workspace_id, name, created_by_user_id, created_at) VALUES ('p-keep', $1, 'Tripket', 'owner', now())", [keeperId]);
  await run("INSERT INTO project (id, workspace_id, name, created_by_user_id, created_at) VALUES ('p-dup', $1, 'Tripket', 'owner', now())", [duplicateId]);
  await run("INSERT INTO handoff (id, workspace_id, project_id, name, created_by_user_id, created_at) VALUES ('h-dup', $1, 'p-dup', 'Tripket', 'owner', now())", [duplicateId]);
  await run(`INSERT INTO handoff_version (id, workspace_id, handoff_id, version_label, source, source_file_id, captured_at, content_hash, snapshot_json, created_by_user_id, created_at)
             VALUES ('v-dup', $1, 'h-dup', '2.0.4', 'figma', 'file', now(), $2, '{"frames":[]}', 'owner', now())`, [duplicateId, hash("a")]);
  await run("INSERT INTO handoff_snapshot_frame_chunk VALUES ($1, $2, '\\x00', 1)", [keeperId, hash("b")]);
  await run("INSERT INTO handoff_snapshot_frame_chunk VALUES ($1, $2, '\\x00', 1)", [duplicateId, hash("b")]);
  await run("INSERT INTO handoff_snapshot_frame_chunk VALUES ($1, $2, '\\x01', 1)", [duplicateId, hash("c")]);
  await run("INSERT INTO handoff_snapshot_manifest VALUES ('v-dup', $1, '{}', 2)", [duplicateId]);
  await run("INSERT INTO handoff_snapshot_frame_ref VALUES ('v-dup', $1, 0, 'f1', $2)", [duplicateId, hash("b")]);
  await run("INSERT INTO handoff_snapshot_frame_ref VALUES ('v-dup', $1, 1, 'f2', $2)", [duplicateId, hash("c")]);
  await run("INSERT INTO viewer_pin VALUES ('owner', 'workspace', $1, now())", [duplicateId]);
}

test("merges a duplicate workspace into the one the app opens, keeping every row reachable", async () => {
  const fixture = await createPostgresTestDatabase();
  const client = await fixture.pool.connect();
  try {
    await seed(client);
    const lines = [];
    const result = await mergeDuplicateWorkspaces(client, { keeperId, duplicateId, log: (line) => lines.push(line) });
    assert.equal(result.merged, true);
    const rows = async (sql, params = []) => (await client.query(sql, params)).rows;

    assert.deepEqual((await rows("SELECT id FROM workspace")).map((row) => row.id), [keeperId]);
    assert.deepEqual(
      await rows("SELECT user_id, role FROM workspace_membership ORDER BY user_id"),
      [{ user_id: "designer", role: "owner" }, { user_id: "dev", role: "developer" }, { user_id: "owner", role: "owner" }],
    );
    assert.deepEqual(
      (await rows("SELECT name FROM project WHERE workspace_id = $1 ORDER BY name", [keeperId])).map((row) => row.name),
      ["Tripket", "Tripket (2)"],
    );
    const [version] = await rows("SELECT workspace_id, snapshot_json FROM handoff_version WHERE id = 'v-dup'");
    assert.deepEqual(version, { workspace_id: keeperId, snapshot_json: '{"frames":[]}' });
    assert.equal((await rows("SELECT count(*)::int n FROM handoff_snapshot_frame_chunk WHERE workspace_id = $1", [keeperId]))[0].n, 2);
    assert.equal((await rows("SELECT count(*)::int n FROM handoff_snapshot_frame_ref WHERE workspace_id = $1", [keeperId]))[0].n, 2);
    assert.deepEqual(await rows("SELECT target_id FROM viewer_pin"), [{ target_id: keeperId }]);
    assert.deepEqual(await rows("SELECT allowed_email_domains FROM workspace"), [{ allowed_email_domains: "example.invalid" }]);

    // Saved versions are immutable again once the merge commits.
    await assert.rejects(client.query("UPDATE handoff_version SET version_label = 'x' WHERE id = 'v-dup'"), /immutable/);
    // A second run finds nothing to do.
    assert.equal((await mergeDuplicateWorkspaces(client, { keeperId, duplicateId, log: () => {} })).merged, false);
  } finally {
    client.release();
    await fixture.close();
  }
});

test("refuses to merge into a workspace that is not the oldest, and leaves everything as it was", async () => {
  const fixture = await createPostgresTestDatabase();
  const client = await fixture.pool.connect();
  try {
    await seed(client);
    await assert.rejects(
      mergeDuplicateWorkspaces(client, { keeperId: duplicateId, duplicateId: keeperId, log: () => {} }),
      /not the one the app opens/,
    );
    assert.equal((await client.query("SELECT count(*)::int n FROM workspace")).rows[0].n, 2);
    assert.equal((await client.query("SELECT workspace_id FROM handoff_version")).rows[0].workspace_id, duplicateId);
  } finally {
    client.release();
    await fixture.close();
  }
});

test("two simultaneous first sign-ins create one company workspace", async () => {
  const fixture = await createPostgresTestDatabase();
  setDatabasePoolForTests(fixture.pool);
  try {
    await getDatabase().prepare(`INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
      VALUES ('first', 'First', 'first@example.invalid', true, now(), now())`).run();
    const user = { id: "first", email: "first@example.invalid" };
    const [a, b] = await Promise.all([ensureCompanyWorkspace(user), ensureCompanyWorkspace(user)]);
    assert.equal(a.id, b.id);
    assert.equal((await getDatabase().prepare("SELECT count(*)::int AS n FROM workspace").get()).n, 1);
  } finally {
    setDatabasePoolForTests(undefined);
    await fixture.close();
  }
});
