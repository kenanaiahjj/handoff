import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Database from "better-sqlite3";

function createDatabase() {
  const database = new Database(":memory:");
  database.pragma("foreign_keys = ON");
  database.exec(`
    CREATE TABLE "user" (id TEXT PRIMARY KEY);
    CREATE TABLE handoff (
      id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      review_share_id TEXT,
      published_version_id TEXT,
      UNIQUE (id, workspace_id),
      PRIMARY KEY (id)
    );
  `);
  database.exec(readFileSync(new URL("./0012_handoff_sharing.sql", import.meta.url), "utf8"));
  database.prepare('INSERT INTO "user" (id) VALUES (?)').run("designer-1");
  database.prepare("INSERT INTO handoff (id, workspace_id) VALUES (?, ?)").run("handoff-1", "workspace-1");
  return database;
}

test("sharing migration defaults existing handoffs to workspace access", () => {
  const database = createDatabase();

  assert.equal(database.prepare("SELECT sharing_mode FROM handoff WHERE id = ?").get("handoff-1").sharing_mode, "workspace");
  assert.throws(
    () => database.prepare("UPDATE handoff SET sharing_mode = ? WHERE id = ?").run("private", "handoff-1"),
    /CHECK constraint failed/,
  );

  database.close();
});

test("handoff deletion cascades invite records and tokens are unique", () => {
  const database = createDatabase();
  database.prepare(`INSERT INTO handoff_invite
    (id, workspace_id, handoff_id, email, token_hash, invited_by_user_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run("invite-1", "workspace-1", "handoff-1", "qa@example.com", "a".repeat(64), "designer-1", "2026-11-09T12:00:00.000Z");
  assert.throws(
    () => database.prepare(`INSERT INTO handoff_invite
      (id, workspace_id, handoff_id, email, token_hash, invited_by_user_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run("invite-2", "workspace-1", "handoff-1", "dev@example.com", "a".repeat(64), "designer-1", "2026-11-09T12:00:00.000Z"),
    /UNIQUE constraint failed/,
  );

  database.prepare("DELETE FROM handoff WHERE id = ?").run("handoff-1");
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM handoff_invite").get().count, 0);

  database.close();
});
