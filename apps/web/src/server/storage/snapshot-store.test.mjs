import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Database from "better-sqlite3";
import { compressStoredSnapshots, readSnapshotJson } from "./snapshot-store.ts";

/** A handoff_version table with every column the immutability rule checks, plus the real migrations. */
function createDatabase() {
  const database = new Database(":memory:");
  database.pragma("foreign_keys = ON");
  database.exec(`
    CREATE TABLE handoff_version (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, handoff_id TEXT NOT NULL, version_label TEXT NOT NULL,
      release_note TEXT, source TEXT NOT NULL, source_file_id TEXT NOT NULL, source_revision_id TEXT,
      captured_at TEXT NOT NULL, content_hash TEXT NOT NULL, visual_only INTEGER NOT NULL DEFAULT 0,
      snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)), created_by_user_id TEXT NOT NULL, created_at TEXT NOT NULL
    );
  `);
  for (const file of ["../migrations/0010_immutable_handoff_versions.sql", "../migrations/0020_compressed_snapshots.sql"]) {
    database.exec(readFileSync(new URL(file, import.meta.url), "utf8"));
  }
  return database;
}

// A capture-shaped payload large enough to show the size win, with characters outside ASCII.
const frames = Array.from({ length: 300 }, (_, index) => ({
  sourceFrameId: `1:${index}`,
  name: `Screen ${index} · Café`,
  renderAssetKey: `frame-${index}`,
  nodes: Array.from({ length: 20 }, (__, node) => ({ id: `${index}:${node}`, width: { value: 390.5 }, fills: ["#ff7a30"] })),
}));
const snapshotJson = JSON.stringify({ schemaVersion: 1, frames, contentHash: "a".repeat(64) });

function insertVersion(database, id, json = snapshotJson) {
  database
    .prepare(
      `INSERT INTO handoff_version VALUES (?, 'ws', 'h', '1.0', NULL, 'figma', 'file', NULL, 'now', ?, 0, ?, 'u', 'now')`,
    )
    .run(id, "b".repeat(64), json);
}

test("existing captures are compressed, read back byte for byte, and keep a screen index", () => {
  const database = createDatabase();
  insertVersion(database, "v1");

  assert.equal(compressStoredSnapshots(database), 1);
  assert.equal(database.prepare("SELECT snapshot_json FROM handoff_version WHERE id = 'v1'").get().snapshot_json, "{}");
  assert.equal(readSnapshotJson(database, "v1", "ws"), snapshotJson);

  const stored = database.prepare("SELECT raw_bytes, length(compressed) AS size, frame_index FROM handoff_version_snapshot").get();
  assert.equal(stored.raw_bytes, Buffer.byteLength(snapshotJson));
  assert.ok(stored.size * 10 < stored.raw_bytes, `expected at least 10x smaller, got ${stored.raw_bytes} -> ${stored.size}`);
  assert.deepEqual(JSON.parse(stored.frame_index)[2], { sourceFrameId: "1:2", name: "Screen 2 · Café", renderAssetKey: "frame-2" });

  // Running again finds nothing left to do.
  assert.equal(compressStoredSnapshots(database), 0);
});

test("versions stay immutable apart from swapping in the verified compressed copy", () => {
  const database = createDatabase();
  insertVersion(database, "v1");

  // No compressed copy yet: blanking the capture is refused.
  assert.throws(() => database.prepare("UPDATE handoff_version SET snapshot_json = '{}' WHERE id = 'v1'").run(), /immutable/);

  compressStoredSnapshots(database);
  // Any other change is still refused, even alongside the allowed one.
  assert.throws(() => database.prepare("UPDATE handoff_version SET version_label = 'Edited' WHERE id = 'v1'").run(), /immutable/);
  assert.throws(() => database.prepare(`UPDATE handoff_version SET snapshot_json = '{"x":1}' WHERE id = 'v1'`).run(), /immutable/);
  assert.equal(database.prepare("SELECT version_label FROM handoff_version WHERE id = 'v1'").get().version_label, "1.0");
});
