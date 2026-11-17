import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startLocalPostgres } from "./local-postgres.mjs";
import { createPostgresPool, migrateSqliteToSupabase } from "./migrate-sqlite-to-supabase.mjs";
import { LocalObjectStore } from "../apps/web/src/server/storage/local-object-store.ts";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appDirectory = path.join(repositoryRoot, "apps/web");
const dataDirectory = path.resolve(process.env.ASBIR_DATA_DIR || path.join(appDirectory, "data"));
const sqlitePath = path.resolve(process.env.ASBIR_LOCAL_SQLITE_PATH || path.join(dataDirectory, "asbir-handoff.sqlite"));
const sourceObjectDirectory = path.resolve(process.env.ASBIR_LOCAL_OBJECTS_DIR || path.join(dataDirectory, "objects"));
const importLocalSqlite = process.env.ASBIR_LOCAL_IMPORT_SQLITE !== "0" && existsSync(sqlitePath);
const appPort = Number(process.env.ASBIR_LOCAL_APP_PORT || 3000);
const databasePort = Number(process.env.ASBIR_LOCAL_POSTGRES_PORT || 54322);

function validPort(port) {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

if (!validPort(appPort) || !validPort(databasePort)) {
  throw new Error("ASBIR_LOCAL_APP_PORT and ASBIR_LOCAL_POSTGRES_PORT must be valid TCP ports.");
}

async function localAuthSecret() {
  const secretFile = path.join(dataDirectory, ".dev-auth-secret");
  await mkdir(dataDirectory, { recursive: true });
  try {
    const secret = (await readFile(secretFile, "utf8")).trim();
    if (secret.length >= 32) return secret;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const secret = randomBytes(32).toString("base64url");
  try {
    await writeFile(secretFile, `${secret}\n`, { mode: 0o600, flag: "wx" });
    return secret;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    return (await readFile(secretFile, "utf8")).trim();
  }
}

const secret = await localAuthSecret();
process.env.NODE_ENV = "development";
process.env.ASBIR_LOCAL_DEV_MODE = "1";
process.env.ASBIR_DATA_DIR = dataDirectory;
process.env.ASBIR_LOCAL_STORAGE_SECRET = secret;
process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${databasePort}/postgres`;
process.env.BETTER_AUTH_URL = process.env.ASBIR_LOCAL_APP_URL?.trim() || `http://localhost:${appPort}`;
process.env.BETTER_AUTH_SECRET = secret;
process.env.ASBIR_AUTH_BYPASS = "1";
process.env.SUPABASE_STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET?.trim() || "handoff-assets";
process.env.ASBIR_COMPANY_NAME = process.env.ASBIR_COMPANY_NAME?.trim() || "Asbir Tech";
process.env.ASBIR_ALLOWED_EMAIL_DOMAINS = process.env.ASBIR_ALLOWED_EMAIL_DOMAINS?.trim() || "lmf.ventures,plxrmedia.com";

const localPostgres = await startLocalPostgres({
  dataDirectory: path.join(dataDirectory, "postgres"),
  port: databasePort,
  seed: !importLocalSqlite,
});

/**
 * The SQLite file seeds local PostgreSQL once. After that PostgreSQL is the source of truth: using the
 * app changes rows (for example when a handoff was last seen), and the importer, built to re-run a
 * production migration safely, refuses to overwrite rows that differ, which would block every restart.
 */
async function sqliteAlreadyImported(database) {
  await database.exec(`CREATE TABLE IF NOT EXISTS asbir_local.sqlite_import (
    source text PRIMARY KEY,
    imported_at timestamptz NOT NULL DEFAULT now()
  )`);
  const recorded = await database.query("SELECT 1 FROM asbir_local.sqlite_import WHERE source = $1", [sqlitePath]);
  if (recorded.rows.length) return true;
  // Databases imported before this record existed already hold the workspace data.
  const existing = await database.query("SELECT 1 FROM workspace LIMIT 1");
  if (!existing.rows.length) return false;
  await recordSqliteImport(database);
  return true;
}

async function recordSqliteImport(database) {
  await database.query("INSERT INTO asbir_local.sqlite_import (source) VALUES ($1) ON CONFLICT (source) DO NOTHING", [sqlitePath]);
}

if (importLocalSqlite && await sqliteAlreadyImported(localPostgres.database)) {
  process.stdout.write(
    "Local PostgreSQL already holds the imported SQLite data; skipping the import. " +
      "Delete apps/web/data/postgres to import the SQLite file again.\n",
  );
} else if (importLocalSqlite) {
  const checkpointPath = path.resolve(
    process.env.ASBIR_LOCAL_MIGRATION_CHECKPOINT ||
      path.join(os.homedir(), ".cache", "asbir-handoff", "local-data-migration-checkpoint.json"),
  );
  const pool = createPostgresPool(process.env.DATABASE_URL);
  try {
    let summary;
    try {
      summary = await migrateSqliteToSupabase({
        sqlitePath,
        objectDirectory: sourceObjectDirectory,
        pool,
        storage: new LocalObjectStore(path.join(dataDirectory, "objects")),
        dryRun: false,
        checkpointPath,
      });
    } finally {
      await pool.end();
    }
    if (!summary.ok) {
      throw new Error(`Local SQLite import found ${summary.objects.localIssues.length} missing or damaged object files.`);
    }
    await recordSqliteImport(localPostgres.database);
    process.stdout.write(
      `Imported local SQLite data: ${summary.completedTables} tables; verified ${summary.objects.reused + summary.objects.copied} assets.\n`,
    );
  } catch (error) {
    await localPostgres.close();
    throw error;
  }
}

const nextBinary = path.join(repositoryRoot, "node_modules/next/dist/bin/next");
const next = spawn(process.execPath, [nextBinary, "dev", "--hostname", "127.0.0.1", "--port", String(appPort)], {
  cwd: appDirectory,
  env: process.env,
  stdio: "inherit",
});

process.once("SIGINT", () => next.kill("SIGINT"));
process.once("SIGTERM", () => next.kill("SIGTERM"));

let exitCode = 0;
try {
  exitCode = await new Promise((resolve, reject) => {
    next.once("error", reject);
    next.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
} finally {
  await localPostgres.close();
}

process.exitCode = exitCode;
