import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDirectory = path.join(repositoryRoot, "supabase/migrations");
const seedFile = path.join(repositoryRoot, "supabase/seed.sql");

async function prepareLocalSchema(database, seed) {
  await database.exec(`
    DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE service_role BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    CREATE SCHEMA IF NOT EXISTS storage;
    CREATE TABLE IF NOT EXISTS storage.buckets (
      id text PRIMARY KEY,
      name text NOT NULL,
      public boolean NOT NULL DEFAULT false,
      file_size_limit bigint,
      allowed_mime_types text[]
    );
    CREATE SCHEMA IF NOT EXISTS asbir_local;
    CREATE TABLE IF NOT EXISTS asbir_local.migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  const appliedMigrations = await database.query("SELECT name FROM asbir_local.migrations");
  const appliedNames = new Set(appliedMigrations.rows.map(({ name }) => name));
  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  for (const name of migrationFiles) {
    if (appliedNames.has(name)) continue;
    const sql = await readFile(path.join(migrationsDirectory, name), "utf8");
    try {
      await database.exec(`BEGIN;\n${sql}\nINSERT INTO asbir_local.migrations (name) VALUES ('${name}');\nCOMMIT;`);
    } catch (error) {
      await database.exec("ROLLBACK").catch(() => undefined);
      throw new Error(`Could not apply local database migration ${name}.`, { cause: error });
    }
  }

  if (seed) await database.exec(await readFile(seedFile, "utf8"));
}

/**
 * pglite-socket 0.2.x strips every socket error listener when a handler detaches, and only destroys the
 * socket if it is still writable. A client that half-closes and then resets (common for pg pool clients in
 * Next.js workers) therefore emits an unhandled `read ECONNRESET` that kills the whole dev runner. There is
 * also a window between accept and the handler attaching. Swallow client socket errors that nobody handles.
 */
function guardClientSocketErrors(socketServer) {
  socketServer.server.on("connection", (socket) => {
    // pglite-socket removes a handler from its connection count only on a clean close. After an error it
    // detaches without that bookkeeping, so each reset leaks a slot until "Too many connections". Prune here;
    // the library admits this socket in a later tick, after this runs.
    for (const handler of socketServer.handlers) {
      if (!handler.isAttached) socketServer.handlers.delete(handler);
    }

    const emit = socket.emit;
    socket.emit = function emitWithErrorGuard(event, ...args) {
      if (event === "error" && this.listenerCount("error") === 0) {
        this.destroy();
        return false;
      }
      return emit.call(this, event, ...args);
    };
  });
}

/** Start a file-backed PGlite server with the same Supabase migrations and local fixture seed. */
export async function startLocalPostgres({
  dataDirectory,
  host = "127.0.0.1",
  port = 54322,
  seed = true,
} = {}) {
  if (!dataDirectory) throw new TypeError("dataDirectory is required for the local PostgreSQL server.");
  const database = await PGlite.create({ dataDir: path.resolve(dataDirectory) });
  let server;
  try {
    await prepareLocalSchema(database, seed);
    server = new PGLiteSocketServer({ db: database, host, port, maxConnections: 64 });
    await server.start();
    guardClientSocketErrors(server);
  } catch (error) {
    if (server) await server.stop().catch(() => undefined);
    await database.close().catch(() => undefined);
    throw error;
  }

  let closed = false;
  return {
    host,
    port,
    database,
    server,
    async close() {
      if (closed) return;
      closed = true;
      await server.stop();
      await database.close();
    },
  };
}
