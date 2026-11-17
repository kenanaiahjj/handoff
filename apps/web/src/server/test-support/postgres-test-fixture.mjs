import { getDatabase, setDatabasePoolForTests } from "../db.ts";
import { createPostgresTestDatabase } from "./postgres-test-database.mjs";

/**
 * Create a fresh PGlite-backed application database with an empty public schema.
 * Tests create only the tables they need, while all database calls still use PostgreSQL.
 */
export async function createPostgresTestFixture() {
  const fixture = await createPostgresTestDatabase();
  const previousPool = globalThis.__asbirDatabase;

  try {
    await fixture.pool.query("DROP SCHEMA public CASCADE");
    await fixture.pool.query("CREATE SCHEMA public");
    setDatabasePoolForTests(fixture.pool);

    let closed = false;
    return {
      pool: fixture.pool,
      database: getDatabase(),
      async close() {
        if (closed) return;
        closed = true;
        setDatabasePoolForTests(previousPool);
        await fixture.close();
      },
    };
  } catch (error) {
    await fixture.close();
    throw error;
  }
}
