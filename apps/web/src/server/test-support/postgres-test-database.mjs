import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { createPgConfig } from "@electric-sql/pglite/node-postgres";
import { PGlite } from "@electric-sql/pglite";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../");

/**
 * Create an isolated, in-memory PostgreSQL database for tests. This never reads DATABASE_URL
 * and cannot connect to a hosted Supabase project.
 */
export async function createPostgresTestDatabase({ seed = false } = {}) {
  const postgres = await PGlite.create();
  const pool = new Pool(createPgConfig(postgres));

  try {
    await postgres.exec(`
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

    const migrationPath = path.join(
      repositoryRoot,
      "supabase/migrations/20261117000000_asbir_baseline.sql",
    );
    await postgres.exec(await readFile(migrationPath, "utf8"));

    if (seed) {
      await postgres.exec(await readFile(path.join(repositoryRoot, "supabase/seed.sql"), "utf8"));
    }

    return {
      pool,
      async close() {
        await pool.end();
        await postgres.close();
      },
    };
  } catch (error) {
    await pool.end().catch(() => undefined);
    await postgres.close().catch(() => undefined);
    throw error;
  }
}
