import assert from "node:assert/strict";
import { test } from "node:test";
import { createPostgresTestDatabase } from "./postgres-test-database.mjs";

test("PostgreSQL test databases are isolated and load the production schema", async () => {
  const left = await createPostgresTestDatabase();
  const right = await createPostgresTestDatabase();

  try {
    await left.pool.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ('left-user', 'Left User', 'left@example.invalid', true, now(), now())`,
    );

    const { rows } = await right.pool.query(`SELECT id FROM "user"`);
    assert.deepEqual(rows, []);

    const { rows: relations } = await left.pool.query(`
      SELECT count(*)::integer AS count
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `);
    // Every migration: 35 existing tables, three chunked-snapshot tables, the two profile tables, and comment images.
    assert.equal(relations[0].count, 45);
  } finally {
    await Promise.all([left.close(), right.close()]);
  }
});
