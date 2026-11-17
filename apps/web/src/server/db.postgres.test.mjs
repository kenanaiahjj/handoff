import assert from "node:assert/strict";
import { test } from "node:test";
import { Pool } from "pg";
import { createPgConfig } from "@electric-sql/pglite/node-postgres";
import { PGlite } from "@electric-sql/pglite";
import { getDatabase, getDatabasePool, setDatabasePoolForTests, withTransaction } from "./db.ts";

test("PostgreSQL helpers reuse one pool and commit or roll back explicit transactions", async () => {
  const postgres = await PGlite.create();
  const pool = new Pool(createPgConfig(postgres));

  setDatabasePoolForTests(pool);
  try {
    const database = getDatabase();
    assert.equal(getDatabasePool(), pool);
    await database.query("CREATE TABLE transaction_probe (id integer PRIMARY KEY, label text NOT NULL)");
    await database.query('CREATE TABLE casing_probe ("emailVerified" boolean NOT NULL)');
    await database.prepare("INSERT INTO casing_probe (emailVerified) VALUES (?)").run(false);
    assert.deepEqual(
      await database.prepare("SELECT emailVerified AS targetId FROM casing_probe WHERE emailVerified = ?").get(false),
      { targetId: false },
    );
    await database.prepare("INSERT INTO transaction_probe (id, label) VALUES (?, '?')").run(0);
    assert.deepEqual(await database.prepare("SELECT id, label FROM transaction_probe WHERE id = ?").get(0), {
      id: 0,
      label: "?",
    });

    await withTransaction(async (client) => {
      await client.query("INSERT INTO transaction_probe (id, label) VALUES ($1, $2)", [1, "committed"]);
    });
    assert.equal((await database.prepare("SELECT id FROM transaction_probe WHERE id = ?").get(1)).id, 1);

    await assert.rejects(
      withTransaction(async (client) => {
        await client.query("INSERT INTO transaction_probe (id, label) VALUES ($1, $2)", [2, "rolled back"]);
        throw new Error("rollback probe");
      }),
      /rollback probe/,
    );
    assert.deepEqual(
      (await database.prepare("SELECT id FROM transaction_probe ORDER BY id").all()).map((row) => row.id),
      [0, 1],
    );
  } finally {
    setDatabasePoolForTests(undefined);
    await pool.end();
    await postgres.close();
  }
});

test("getDatabase returns one stable handle per pool so per-database caches survive across requests", async () => {
  const first = new Pool({ connectionString: "postgresql://unused@127.0.0.1:1/unused" });
  const second = new Pool({ connectionString: "postgresql://unused@127.0.0.1:1/unused" });
  try {
    setDatabasePoolForTests(first);
    const handle = getDatabase();
    assert.equal(getDatabase(), handle, "SQLite's getDatabase() was a singleton; parsed-snapshot caching depends on it");
    setDatabasePoolForTests(second);
    assert.notEqual(getDatabase(), handle, "a different pool gets its own handle");
  } finally {
    setDatabasePoolForTests(undefined);
    await Promise.all([first.end(), second.end()]);
  }
});
