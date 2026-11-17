import assert from "node:assert/strict";
import test from "node:test";
import { PostgresDatabase } from "../db.ts";
import { createPostgresTestDatabase } from "../test-support/postgres-test-database.mjs";

test("external task links survive removal of legacy MCP credentials", async () => {
  const fixture = await createPostgresTestDatabase();
  const { pool } = fixture;
  const database = new PostgresDatabase(pool);

  try {
    await database.prepare(`INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
      VALUES ('user-1', 'Fixture User', 'fixture@example.invalid', true, now(), now())`).run();
    await database.prepare("INSERT INTO workspace (id, name, created_by_user_id, created_at) VALUES ('workspace-1', 'Workspace', 'user-1', now())").run();
    await database.prepare("INSERT INTO project (id, workspace_id, name, created_by_user_id, created_at) VALUES ('project-1', 'workspace-1', 'Project', 'user-1', now())").run();
    await database.prepare(`INSERT INTO handoff (id, workspace_id, project_id, name, created_by_user_id, created_at)
      VALUES ('handoff-1', 'workspace-1', 'project-1', 'Handoff', 'user-1', now())`).run();
    await database.prepare(`INSERT INTO handoff_version
      (id, workspace_id, handoff_id, version_label, source, source_file_id, captured_at,
       content_hash, snapshot_json, created_by_user_id, created_at)
      VALUES ('version-1', 'workspace-1', 'handoff-1', '1.0', 'figma', 'file-1', now(), ?, '{}', 'user-1', now())`)
      .run("a".repeat(64));

    await pool.query(`
      CREATE TABLE task_mcp_connection (
        id text PRIMARY KEY,
        workspace_id text NOT NULL,
        name text NOT NULL,
        endpoint_url text NOT NULL,
        created_by_user_id text NOT NULL,
        created_at text NOT NULL,
        UNIQUE (workspace_id, endpoint_url)
      );
      CREATE TABLE linked_task (
        id text PRIMARY KEY,
        workspace_id text NOT NULL,
        handoff_id text NOT NULL,
        version_id text NOT NULL,
        connection_id text NOT NULL,
        external_task_id text,
        external_url text,
        title text NOT NULL,
        description text NOT NULL,
        evidence_json text NOT NULL CHECK (evidence_json::jsonb IS NOT NULL),
        created_by_user_id text NOT NULL,
        created_at text NOT NULL,
        agent_run_url text,
        pull_request_url text
      );
    `);
    await database.prepare(`INSERT INTO task_mcp_connection (id, workspace_id, name, endpoint_url, created_by_user_id, created_at)
      VALUES ('connection-1', 'workspace-1', 'Asbir Teams', 'https://teams.asbir.tech/mcp', 'user-1', 'created')`).run();
    await database.prepare(`INSERT INTO linked_task (
      id, workspace_id, handoff_id, version_id, connection_id, external_task_id, external_url,
      title, description, evidence_json, created_by_user_id, created_at, agent_run_url, pull_request_url
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        "task-1", "workspace-1", "handoff-1", "version-1", "connection-1", "TEAM-42",
        "https://teams.asbir.tech/tasks/TEAM-42", "Fix hero action", "Keep evidence linked",
        JSON.stringify({ frameId: "frame-home", sourceNodeId: "node-button" }), "user-1", "created",
        "https://agents.asbir.tech/runs/42", "https://github.com/asbir/app/pull/42",
      );

    await pool.query(`INSERT INTO linked_external_task (
      id, workspace_id, handoff_id, version_id, source_system,
      external_task_id, external_url, title, description, evidence_json,
      created_by_user_id, created_at, agent_run_url, pull_request_url
    )
    SELECT linked_task.id, linked_task.workspace_id, linked_task.handoff_id,
           linked_task.version_id, task_mcp_connection.name,
           linked_task.external_task_id, linked_task.external_url,
           linked_task.title, linked_task.description, linked_task.evidence_json,
           linked_task.created_by_user_id, linked_task.created_at,
           linked_task.agent_run_url, linked_task.pull_request_url
    FROM linked_task
    JOIN task_mcp_connection ON task_mcp_connection.id = linked_task.connection_id`);
    await pool.query("DROP TABLE linked_task");
    await pool.query("DROP TABLE task_mcp_connection");

    const preservedTask = await database.prepare(`
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

    const remainingLegacyTables = await pool.query(`
      SELECT table_name AS name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('linked_task', 'task_mcp_connection')
      ORDER BY table_name
    `);
    assert.deepEqual(remainingLegacyTables.rows, []);
    const taskCount = await database.prepare("SELECT COUNT(*) AS count FROM linked_external_task").get();
    assert.equal(taskCount.count, 1);
  } finally {
    await fixture.close();
  }
});
