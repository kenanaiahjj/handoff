import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Database from "better-sqlite3";

function createDatabase() {
  const database = new Database(":memory:");
  database.pragma("foreign_keys = ON");
  database.exec(`
    CREATE TABLE handoff (
      id TEXT PRIMARY KEY
    );
    CREATE TABLE handoff_version (
      id TEXT PRIMARY KEY,
      handoff_id TEXT NOT NULL REFERENCES handoff (id) ON DELETE CASCADE,
      version_label TEXT NOT NULL
    );
  `);

  let migrationSql = "";
  try {
    migrationSql = readFileSync(new URL("./0010_immutable_handoff_versions.sql", import.meta.url), "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (migrationSql) database.exec(migrationSql);

  database.prepare("INSERT INTO handoff (id) VALUES (?)").run("handoff-1");
  database.prepare("INSERT INTO handoff_version (id, handoff_id, version_label) VALUES (?, ?, ?)")
    .run("version-1", "handoff-1", "Original");
  return database;
}

test("rejects updates to an existing handoff version", () => {
  const database = createDatabase();

  assert.throws(
    () => database.prepare("UPDATE handoff_version SET version_label = ? WHERE id = ?").run("Edited", "version-1"),
    /Handoff versions are immutable/,
  );
  assert.equal(
    database.prepare("SELECT version_label FROM handoff_version WHERE id = ?").get("version-1").version_label,
    "Original",
  );

  database.close();
});

test("allows a new version and preserves parent handoff deletion cascades", () => {
  const database = createDatabase();

  database.prepare("INSERT INTO handoff_version (id, handoff_id, version_label) VALUES (?, ?, ?)")
    .run("version-2", "handoff-1", "Updated");
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM handoff_version").get().count, 2);

  database.prepare("DELETE FROM handoff WHERE id = ?").run("handoff-1");
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM handoff_version").get().count, 0);

  database.close();
});
