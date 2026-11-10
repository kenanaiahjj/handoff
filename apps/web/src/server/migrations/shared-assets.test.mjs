import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Database from "better-sqlite3";

test("a new version can reuse a stored object from the same handoff", () => {
  const database = new Database(":memory:");
  database.pragma("foreign_keys = ON");
  database.exec(`
    CREATE TABLE handoff_version (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      UNIQUE (id, workspace_id)
    );
    CREATE TABLE handoff_asset (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      handoff_version_id TEXT NOT NULL,
      asset_key TEXT NOT NULL,
      object_key TEXT NOT NULL UNIQUE,
      file_name TEXT NOT NULL,
      content_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      created_at TEXT NOT NULL,
      FOREIGN KEY (handoff_version_id, workspace_id)
        REFERENCES handoff_version (id, workspace_id) ON DELETE CASCADE,
      UNIQUE (handoff_version_id, asset_key)
    );
  `);
  database.prepare("INSERT INTO handoff_version (id, workspace_id) VALUES (?, ?)").run("version-1", "workspace-1");
  database.prepare("INSERT INTO handoff_version (id, workspace_id) VALUES (?, ?)").run("version-2", "workspace-1");
  database.prepare(`
    INSERT INTO handoff_asset (
      id, workspace_id, handoff_version_id, asset_key, object_key,
      file_name, content_type, size_bytes, sha256, width, height, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "asset-1", "workspace-1", "version-1", "home-render", "a".repeat(48),
    "home.png", "image/png", 10, "b".repeat(64), 100, 200, "2026-11-09T00:00:00.000Z",
  );

  const migration = readFileSync(new URL("./0011_shared_asset_objects.sql", import.meta.url), "utf8");
  database.exec(migration);
  database.prepare(`
    INSERT INTO handoff_asset (
      id, workspace_id, handoff_version_id, asset_key, object_key,
      file_name, content_type, size_bytes, sha256, width, height, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "asset-2", "workspace-1", "version-2", "home-render", "a".repeat(48),
    "home.png", "image/png", 10, "b".repeat(64), 100, 200, "2026-11-09T00:01:00.000Z",
  );

  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM handoff_asset WHERE object_key = ?").get("a".repeat(48)).count, 2);
  database.prepare("DELETE FROM handoff_version WHERE id = ?").run("version-1");
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM handoff_asset WHERE object_key = ?").get("a".repeat(48)).count, 1);

  database.close();
});
