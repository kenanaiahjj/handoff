import assert from "node:assert/strict";
import test from "node:test";
import { PostgresDatabase } from "../db.ts";
import { createPostgresTestDatabase } from "../test-support/postgres-test-database.mjs";

async function createDatabase() {
  const fixture = await createPostgresTestDatabase();
  const database = new PostgresDatabase(fixture.pool);
  await database.prepare(`INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
    VALUES ('designer-1', 'Designer', 'designer@example.invalid', true, now(), now())`).run();
  await database.prepare("INSERT INTO workspace (id, name, created_by_user_id, created_at) VALUES ('workspace-1', 'Workspace', 'designer-1', now())").run();
  await database.prepare("INSERT INTO project (id, workspace_id, name, created_by_user_id, created_at) VALUES ('project-1', 'workspace-1', 'Project', 'designer-1', now())").run();
  await database.prepare(`INSERT INTO handoff (id, workspace_id, project_id, name, created_by_user_id, created_at)
    VALUES ('handoff-1', 'workspace-1', 'project-1', 'Handoff', 'designer-1', now())`).run();
  return { fixture, database };
}

test("sharing defaults to workspace access and accepts only supported modes", async () => {
  const { fixture, database } = await createDatabase();

  try {
    const handoff = await database.prepare("SELECT sharing_mode FROM handoff WHERE id = ?").get("handoff-1");
    assert.equal(handoff.sharing_mode, "workspace");
    await assert.rejects(
      database.transaction(async () => {
        await database.prepare("UPDATE handoff SET sharing_mode = ? WHERE id = ?").run("private", "handoff-1");
      })(),
      /check constraint/,
    );
  } finally {
    await fixture.close();
  }
});

test("handoff deletion cascades invite records and tokens are unique", async () => {
  const { fixture, database } = await createDatabase();

  try {
    await database.prepare(`INSERT INTO handoff_invite
      (id, workspace_id, handoff_id, email, token_hash, invited_by_user_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run("invite-1", "workspace-1", "handoff-1", "qa@example.com", "a".repeat(64), "designer-1", "2026-11-09T12:00:00.000Z");
    await assert.rejects(
      database.transaction(async () => {
        await database.prepare(`INSERT INTO handoff_invite
          (id, workspace_id, handoff_id, email, token_hash, invited_by_user_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run("invite-2", "workspace-1", "handoff-1", "dev@example.com", "a".repeat(64), "designer-1", "2026-11-09T12:00:00.000Z");
      })(),
      /duplicate key|unique constraint/i,
    );

    await database.prepare("DELETE FROM handoff WHERE id = ?").run("handoff-1");
    const invites = await database.prepare("SELECT COUNT(*) AS count FROM handoff_invite").get();
    assert.equal(invites.count, 0);
  } finally {
    await fixture.close();
  }
});
