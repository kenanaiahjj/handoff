import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Database from "better-sqlite3";

function readMigration(fileName) {
  try {
    return readFileSync(new URL(fileName, import.meta.url), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function createLegacyDatabase() {
  const database = new Database(":memory:");
  database.pragma("foreign_keys = ON");
  database.exec(`
    CREATE TABLE workspace (id TEXT PRIMARY KEY);
    CREATE TABLE "user" (id TEXT PRIMARY KEY);
    CREATE TABLE handoff (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      UNIQUE (id, workspace_id)
    );
    CREATE TABLE handoff_version (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      UNIQUE (id, workspace_id)
    );
    CREATE TABLE task_mcp_connection (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      endpoint_url TEXT NOT NULL,
      auth_type TEXT NOT NULL,
      secret_ciphertext TEXT,
      secret_iv TEXT,
      secret_tag TEXT,
      allowed_actions_json TEXT NOT NULL,
      tools_json TEXT NOT NULL DEFAULT '[]',
      selected_create_tool TEXT,
      created_by_user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (workspace_id, endpoint_url)
    );
    CREATE TABLE linked_task (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
      handoff_id TEXT NOT NULL,
      version_id TEXT NOT NULL,
      connection_id TEXT NOT NULL REFERENCES task_mcp_connection (id) ON DELETE RESTRICT,
      external_task_id TEXT,
      external_url TEXT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
      created_by_user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL,
      agent_run_url TEXT,
      pull_request_url TEXT,
      FOREIGN KEY (handoff_id, workspace_id)
        REFERENCES handoff (id, workspace_id) ON DELETE CASCADE,
      FOREIGN KEY (version_id, workspace_id)
        REFERENCES handoff_version (id, workspace_id) ON DELETE CASCADE
    );
  `);

  database.prepare("INSERT INTO workspace (id) VALUES (?)").run("workspace-1");
  database.prepare('INSERT INTO "user" (id) VALUES (?)').run("user-1");
  database.prepare("INSERT INTO handoff (id, workspace_id) VALUES (?, ?)").run("handoff-1", "workspace-1");
  database.prepare("INSERT INTO handoff_version (id, workspace_id) VALUES (?, ?)").run("version-1", "workspace-1");
  database.prepare(`
    INSERT INTO task_mcp_connection (
      id, workspace_id, name, endpoint_url, auth_type, secret_ciphertext, secret_iv,
      secret_tag, allowed_actions_json, tools_json, created_by_user_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "connection-1", "workspace-1", "Asbir Teams", "https://teams.asbir.tech/mcp", "bearer",
    "ciphertext", "iv", "tag", "[]", "[]", "user-1", "created", "updated",
  );
  database.prepare(`
    INSERT INTO linked_task (
      id, workspace_id, handoff_id, version_id, connection_id, external_task_id,
      external_url, title, description, evidence_json, created_by_user_id, created_at,
      agent_run_url, pull_request_url
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "task-1", "workspace-1", "handoff-1", "version-1", "connection-1", "TEAM-42",
    "https://teams.asbir.tech/tasks/TEAM-42", "Fix hero action", "Keep evidence linked",
    JSON.stringify({ frameId: "frame-home", sourceNodeId: "node-button" }), "user-1", "created",
    "https://agents.asbir.tech/runs/42", "https://github.com/asbir/app/pull/42",
  );

  return database;
}

test("preserves external task links before dropping legacy MCP credentials", () => {
  const database = createLegacyDatabase();

  try {
    database.exec(readMigration("./0008_external_task_links.sql"));
    const cleanupMigration = readMigration("./0014_remove_legacy_task_mcp.sql");
    assert.ok(cleanupMigration, "the legacy task MCP cleanup migration must exist");
    database.exec(cleanupMigration);

    const preservedTask = database.prepare(`
      SELECT source_system, external_task_id, external_url, title, description,
             evidence_json, agent_run_url, pull_request_url
      FROM linked_external_task WHERE id = ?
    `).get("task-1");
    assert.deepEqual(preservedTask, {
      source_system: "Asbir Teams",
      external_task_id: "TEAM-42",
      external_url: "https://teams.asbir.tech/tasks/TEAM-42",
      title: "Fix hero action",
      description: "Keep evidence linked",
      evidence_json: JSON.stringify({ frameId: "frame-home", sourceNodeId: "node-button" }),
      agent_run_url: "https://agents.asbir.tech/runs/42",
      pull_request_url: "https://github.com/asbir/app/pull/42",
    });

    const remainingLegacyTables = database.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name IN ('linked_task', 'task_mcp_connection')
      ORDER BY name
    `).all();
    assert.deepEqual(remainingLegacyTables, []);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM linked_external_task").get().count, 1);
  } finally {
    database.close();
  }
});
