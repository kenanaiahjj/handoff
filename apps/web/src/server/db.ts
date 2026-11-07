import Database from "better-sqlite3";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

type DatabaseGlobal = typeof globalThis & {
  __asbirDatabase?: Database.Database;
};

const globalForDatabase = globalThis as DatabaseGlobal;

export function getDataDirectory() {
  return path.resolve(
    /* turbopackIgnore: true */
    process.env.ASBIR_DATA_DIR ?? path.join(process.cwd(), "data"),
  );
}

function applyMigrations(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const migrationDirectory = path.join(process.cwd(), "src", "server", "migrations");
  let migrationFiles: string[] = [];

  try {
    migrationFiles = readdirSync(migrationDirectory)
      .filter((fileName) => /^\d+_[a-z0-9_-]+\.sql$/i.test(fileName))
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  for (const fileName of migrationFiles) {
    const sql = readFileSync(path.join(migrationDirectory, fileName), "utf8");
    const applyMigration = database.transaction(() => {
      const alreadyApplied = database
        .prepare("SELECT 1 FROM schema_migrations WHERE name = ?")
        .get(fileName);

      if (alreadyApplied) return;

      database.exec(sql);
      database
        .prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)")
        .run(fileName, new Date().toISOString());
    });

    applyMigration.immediate();
  }
}

export function getDatabase() {
  if (globalForDatabase.__asbirDatabase) {
    return globalForDatabase.__asbirDatabase;
  }

  const dataDirectory = getDataDirectory();
  mkdirSync(dataDirectory, { recursive: true });

  const database = new Database(path.join(dataDirectory, "asbir-handoff.sqlite"));
  database.pragma("busy_timeout = 10000");
  database.pragma("foreign_keys = ON");
  database.pragma("journal_mode = WAL");
  applyMigrations(database);

  globalForDatabase.__asbirDatabase = database;
  return database;
}
