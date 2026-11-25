import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { PostgresDatabase, setDatabasePoolForTests } from "../db.ts";
import { createPostgresTestDatabase } from "../test-support/postgres-test-database.mjs";
import { defaultHandbook, getHandbook, HandbookError, resetHandbook, saveHandbook } from "./handbook.ts";

const previousPool = globalThis.__asbirDatabase;
let fixture;

before(async () => {
  fixture = await createPostgresTestDatabase();
  setDatabasePoolForTests(fixture.pool);
  const database = new PostgresDatabase(fixture.pool);
  await database.prepare(`INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
    VALUES ('user-1', 'Dana Designer', 'designer@example.com', true, '2026-11-10', '2026-11-10')`).run();
  await database.prepare("INSERT INTO workspace (id, name, created_by_user_id, created_at) VALUES ('workspace-1', 'Workspace', 'user-1', '2026-11-10')").run();
  await database.prepare("INSERT INTO workspace (id, name, created_by_user_id, created_at) VALUES ('workspace-2', 'Other', 'user-1', '2026-11-10')").run();
});

after(async () => {
  await fixture?.close();
  setDatabasePoolForTests(previousPool);
});

test("a workspace starts with the built-in Figma guide", async () => {
  assert.match(defaultHandbook(), /^# Figma File Guidelines/);
  const handbook = await getHandbook("workspace-1");
  assert.equal(handbook.isDefault, true);
  assert.equal(handbook.markdown, defaultHandbook());
});

test("saving keeps the workspace's own copy, and reset goes back to the built-in guide", async () => {
  const saved = await saveHandbook("workspace-1", "user-1", "# Our rules\r\n\r\nUse `Page - Surface`.");
  assert.equal(saved.isDefault, false);
  assert.equal(saved.markdown, "# Our rules\n\nUse `Page - Surface`.");
  assert.equal(saved.updatedByName, "Dana Designer");

  const edited = await saveHandbook("workspace-1", "user-1", "# Our rules v2");
  assert.equal(edited.markdown, "# Our rules v2");
  assert.equal((await getHandbook("workspace-2")).isDefault, true, "other workspaces keep the built-in guide");

  const reset = await resetHandbook("workspace-1");
  assert.equal(reset.isDefault, true);
  assert.equal(reset.markdown, defaultHandbook());
});

test("an empty handbook is refused", async () => {
  await assert.rejects(saveHandbook("workspace-1", "user-1", "  \n "), HandbookError);
});
