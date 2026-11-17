import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import Database from "better-sqlite3";

const migrationPath = new URL("./migrations/20261117000000_asbir_baseline.sql", import.meta.url);
const projectRoot = fileURLToPath(new URL("..", import.meta.url));

test("baseline migration creates the app schema and protects immutable versions", async () => {
  const database = await PGlite.create();
  const sourceDatabase = new Database(":memory:");

  try {
    await database.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA storage;
      CREATE TABLE storage.buckets (
        id text PRIMARY KEY,
        name text NOT NULL,
        public boolean NOT NULL DEFAULT false,
        file_size_limit bigint,
        allowed_mime_types text[]
      );
    `);

    const sqliteMigrationDirectory = path.join(projectRoot, "apps/web/src/server/migrations");
    const sqliteMigrations = (await readdir(sqliteMigrationDirectory))
      .filter((fileName) => fileName.endsWith(".sql"))
      .sort();
    for (const fileName of sqliteMigrations) {
      sourceDatabase.exec(await readFile(path.join(sqliteMigrationDirectory, fileName), "utf8"));
    }

    const migration = await readFile(migrationPath, "utf8");
    await database.exec(migration);
    await database.exec(await readFile(new URL("./seed.sql", import.meta.url), "utf8"));
    const config = await readFile(new URL("./config.toml", import.meta.url), "utf8");
    assert.match(config, /^project_id\s*=\s*"asbir-handoff"/m);
    assert.match(config, /^stack\s*=\s*true$/m);
    assert.match(config, /\[storage\.buckets\.handoff-assets\]/);

    const { rows: tableRows } = await database.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    const tableNames = new Set(tableRows.map((row) => row.table_name));
    const sqliteTableNames = sourceDatabase
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map((row) => row.name);
    const migrationOnlyTables = ["capture_upload", "capture_upload_abandoned"];
    assert.deepEqual(
      [...tableNames].sort(),
      [...sqliteTableNames, ...migrationOnlyTables].sort(),
      "baseline table list must match the SQLite schema plus the direct-upload tables",
    );

    const { rows: pgColumnRows } = await database.query(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position
    `);
    const pgColumnsByTable = new Map();
    for (const { table_name: tableName, column_name: columnName } of pgColumnRows) {
      const columns = pgColumnsByTable.get(tableName) ?? [];
      columns.push(columnName);
      pgColumnsByTable.set(tableName, columns);
    }
    for (const tableName of sqliteTableNames) {
      const sqliteColumns = sourceDatabase
        .prepare(`PRAGMA table_info("${tableName}")`)
        .all()
        .map((column) => column.name);
      assert.deepEqual(pgColumnsByTable.get(tableName), sqliteColumns, `column list must match for ${tableName}`);
    }

    const sqliteIndexNames = sourceDatabase
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL ORDER BY name")
      .all()
      .map((row) => row.name);
    const { rows: pgIndexRows } = await database.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
    `);
    const pgIndexNames = new Set(pgIndexRows.map((row) => row.indexname));
    for (const indexName of sqliteIndexNames) {
      assert.ok(pgIndexNames.has(indexName), `missing index ${indexName}`);
    }

    for (const tableName of [
      "user", "account", "session", "verification", "workspace", "workspace_membership",
      "project", "handoff", "handoff_version", "handoff_version_snapshot", "handoff_asset",
      "capture_session", "handoff_comment", "handoff_annotation", "workspace_mcp_token",
    ]) {
      assert.ok(tableNames.has(tableName), `missing public.${tableName}`);
    }

    const { rows: rlsRows } = await database.query(`
      SELECT c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
    `);
    assert.equal(rlsRows.length, tableNames.size, "RLS must be enabled on every public app table");

    const { rows: privilegeRows } = await database.query(`
      SELECT has_table_privilege('anon', 'public.handoff', 'SELECT') AS anon_can_read,
             has_table_privilege('authenticated', 'public.handoff', 'SELECT') AS authenticated_can_read
    `);
    assert.deepEqual(privilegeRows[0], { anon_can_read: false, authenticated_can_read: false });

    const { rows: bucketRows } = await database.query(`
      SELECT public, file_size_limit, allowed_mime_types
      FROM storage.buckets
      WHERE id = 'handoff-assets'
    `);
    assert.equal(bucketRows.length, 1, "private handoff-assets bucket must be configured");
    assert.equal(bucketRows[0].public, false);
    assert.ok(Number(bucketRows[0].file_size_limit) >= 6 * 1024 * 1024);
    assert.ok(bucketRows[0].allowed_mime_types.includes("image/png"));

    await database.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, true, now(), now())`,
      ["schema-test-user", "Schema Test", "schema-test@example.invalid"],
    );
    await database.query(
      `INSERT INTO workspace (id, name, created_by_user_id, created_at)
       VALUES ($1, $2, $3, $4)`,
      ["schema-test-workspace", "Schema Test", "schema-test-user", new Date().toISOString()],
    );
    await database.query(
      `INSERT INTO project (id, workspace_id, name, created_by_user_id, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      ["schema-test-project", "schema-test-workspace", "Schema Test", "schema-test-user", new Date().toISOString()],
    );
    await database.query(
      `INSERT INTO handoff (id, workspace_id, project_id, name, created_by_user_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      ["schema-test-handoff", "schema-test-workspace", "schema-test-project", "Schema Test", "schema-test-user", new Date().toISOString()],
    );
    await database.query(
      `INSERT INTO handoff_version (
         id, workspace_id, handoff_id, version_label, source, source_file_id,
         captured_at, content_hash, snapshot_json, created_by_user_id, created_at
       ) VALUES ($1, $2, $3, $4, 'figma', 'test-file', $5, $6, '{"version":1}', $7, $8)`,
      ["schema-test-version", "schema-test-workspace", "schema-test-handoff", "1", new Date().toISOString(), "a".repeat(64), "schema-test-user", new Date().toISOString()],
    );

    await assert.rejects(
      database.query(`UPDATE handoff_version SET version_label = 'changed' WHERE id = $1`, ["schema-test-version"]),
      /immutable/i,
    );

    await database.query(
      `INSERT INTO handoff_version_snapshot (version_id, encoding, compressed, raw_bytes, frame_index)
       VALUES ($1, 'br', $2, 0, '{}')`,
      ["schema-test-version", new Uint8Array([1])],
    );
    await database.query(`UPDATE handoff_version SET snapshot_json = '{}' WHERE id = $1`, ["schema-test-version"]);
  } finally {
    await database.close();
  }
});
