import assert from "node:assert/strict";
import { test } from "node:test";
import { createPostgresTestFixture } from "./postgres-test-fixture.mjs";

test("PostgreSQL test fixtures are isolated and expose the application database facade", async () => {
  const left = await createPostgresTestFixture();
  const right = await createPostgresTestFixture();

  try {
    await left.pool.query("CREATE TABLE fixture_probe (id text PRIMARY KEY)");
    await left.database.prepare("INSERT INTO fixture_probe (id) VALUES (?)").run("left");

    const result = await right.pool.query("SELECT to_regclass('public.fixture_probe') AS relation");
    assert.equal(result.rows[0].relation, null);
  } finally {
    await right.close();
    await left.close();
  }
});
