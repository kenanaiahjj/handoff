import { Pool, types, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";

type DatabaseGlobal = typeof globalThis & {
  __asbirDatabase?: Pool;
};

const globalForDatabase = globalThis as DatabaseGlobal;
const activeTransaction = new AsyncLocalStorage<{ pool: Pool; client: PoolClient }>();

types.setTypeParser(20, (value) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new RangeError("PostgreSQL bigint result is outside JavaScript's safe integer range.");
  return parsed;
});

export type RunResult = { changes: number; lastInsertRowid: number | bigint | undefined };

export class PostgresDatabase {
  constructor(private readonly pool: Pool) {}

  private getQueryable() {
    const transaction = activeTransaction.getStore();
    return transaction?.pool === this.pool ? transaction.client : this.pool;
  }

  query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]) {
    return this.getQueryable().query<T>(text, values);
  }

  prepare(text: string) {
    const sql = translateSql(text);
    return {
      get: async <T extends QueryResultRow = QueryResultRow>(...values: unknown[]) => {
        const result = await this.query<T>(sql, normalizeValues(values));
        return result.rows[0];
      },
      all: async <T extends QueryResultRow = QueryResultRow>(...values: unknown[]) => {
        const result = await this.query<T>(sql, normalizeValues(values));
        return result.rows;
      },
      run: async (...values: unknown[]): Promise<RunResult> => {
        const result = await this.query(sql, normalizeValues(values));
        const insertedId = result.rows[0]?.id;
        return {
          changes: result.rowCount ?? 0,
          lastInsertRowid: typeof insertedId === "number" || typeof insertedId === "bigint" ? insertedId : undefined,
        };
      },
    };
  }

  transaction<T>(work: () => T | Promise<T>) {
    return async () => {
      const currentTransaction = activeTransaction.getStore();
      if (currentTransaction?.pool === this.pool) return work();

      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        const result = await activeTransaction.run({ pool: this.pool, client }, work);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    };
  }
}

function normalizeValues(values: unknown[]) {
  if (values.length === 1 && Array.isArray(values[0])) return values[0];
  return values;
}

function replaceQuestionPlaceholders(sql: string) {
  let result = "";
  let parameterIndex = 0;
  let state: "normal" | "single" | "double" | "line-comment" | "block-comment" = "normal";

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    const nextCharacter = sql[index + 1];

    if (state === "single") {
      result += character;
      if (character === "'" && nextCharacter === "'") {
        result += nextCharacter;
        index += 1;
      } else if (character === "'") {
        state = "normal";
      }
      continue;
    }

    if (state === "double") {
      result += character;
      if (character === '"' && nextCharacter === '"') {
        result += nextCharacter;
        index += 1;
      } else if (character === '"') {
        state = "normal";
      }
      continue;
    }

    if (state === "line-comment") {
      result += character;
      if (character === "\n") state = "normal";
      continue;
    }

    if (state === "block-comment") {
      result += character;
      if (character === "*" && nextCharacter === "/") {
        result += nextCharacter;
        index += 1;
        state = "normal";
      }
      continue;
    }

    if (character === "'" ) {
      state = "single";
      result += character;
    } else if (character === '"') {
      state = "double";
      result += character;
    } else if (character === "-" && nextCharacter === "-") {
      state = "line-comment";
      result += "--";
      index += 1;
    } else if (character === "/" && nextCharacter === "*") {
      state = "block-comment";
      result += "/*";
      index += 1;
    } else if (/[A-Za-z_]/.test(character)) {
      const start = index;
      let end = index + 1;
      while (end < sql.length && /[A-Za-z0-9_$]/.test(sql[end])) end += 1;
      const identifier = sql.slice(start, end);
      if (/[a-z]/.test(identifier) && /[A-Z]/.test(identifier)) {
        result += `"${identifier}"`;
      } else {
        result += identifier;
      }
      index = end - 1;
    } else if (character === "?") {
      parameterIndex += 1;
      result += `$${parameterIndex}`;
    } else {
      result += character;
    }
  }

  return result;
}

function translateSql(text: string) {
  const sql = text.trim().replace(/;\s*$/, "");
  return replaceQuestionPlaceholders(sql);
}

export function getDataDirectory() {
  return path.resolve(
    process.env.ASBIR_DATA_DIR ?? path.join(process.cwd(), "data"),
  );
}

export function isUniqueConstraintViolation(error: unknown) {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return candidate.code === "23505" ||
    (typeof candidate.message === "string" && /UNIQUE constraint failed/.test(candidate.message));
}

function isLocalDatabaseUrl(connectionString: string) {
  const hostname = new URL(connectionString).hostname.toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function databasePoolMax() {
  const configured = Number(process.env.DATABASE_POOL_MAX ?? "");
  return Number.isInteger(configured) && configured >= 1 && configured <= 50 ? configured : 5;
}

function createPool() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("DATABASE_URL must be set before the app can connect to PostgreSQL.");
  }

  return new Pool({
    connectionString,
    // One connection made every query on an instance wait in line (SQLite never had to), and a long
    // transaction could time out unrelated requests. Supabase's transaction pooler multiplexes these.
    max: databasePoolMax(),
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 10_000,
    ssl: isLocalDatabaseUrl(connectionString) ? false : { rejectUnauthorized: true },
  });
}

/** Return the shared PostgreSQL pool. The Supabase transaction pooler needs no session state. */
export function getDatabasePool() {
  if (!globalForDatabase.__asbirDatabase) {
    globalForDatabase.__asbirDatabase = createPool();
  }

  return globalForDatabase.__asbirDatabase;
}

const databaseHandles = new WeakMap<Pool, PostgresDatabase>();

/**
 * Async query facade backed by the shared PostgreSQL pool. One stable handle per pool, like the old
 * SQLite singleton: callers key per-database caches (such as parsed snapshots) on this object.
 */
export function getDatabase() {
  const pool = getDatabasePool();
  let handle = databaseHandles.get(pool);
  if (!handle) {
    handle = new PostgresDatabase(pool);
    databaseHandles.set(pool, handle);
  }
  return handle;
}

/** Run a unit test against its own Postgres-compatible pool. */
export function setDatabasePoolForTests(pool: Pool | undefined) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Test database injection is unavailable in production.");
  }
  globalForDatabase.__asbirDatabase = pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values?: unknown[],
): Promise<QueryResult<T>> {
  // Joins an active transaction on this pool, like every other helper here.
  return getDatabase().query<T>(text, values);
}

export async function withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const pool = getDatabasePool();
  const active = activeTransaction.getStore();
  if (active?.pool === pool) return work(active.client);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await activeTransaction.run({ pool, client }, () => work(client));
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
