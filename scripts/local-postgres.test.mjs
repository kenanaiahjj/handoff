import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Pool } from "pg";

async function unusedPort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  const { port } = listener.address();
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  return port;
}

test("a client socket reset after the handler lets go does not crash the local PostgreSQL server", async () => {
  const runtime = await import("./local-postgres.mjs");
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "asbir-local-postgres-reset-"));
  const port = await unusedPort();
  const localPostgres = await runtime.startLocalPostgres({ dataDirectory, port });
  try {
    const accepted = new Promise((resolve) => localPostgres.server.server.once("connection", resolve));
    const client = net.connect(port, "127.0.0.1");
    client.on("error", () => undefined);
    const serverSocket = await accepted;
    await new Promise((resolve) => setImmediate(resolve));

    // pglite-socket strips every error listener on detach without always destroying the socket.
    serverSocket.removeAllListeners("error");
    assert.doesNotThrow(() => serverSocket.emit("error", Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" })));
    client.destroy();

    const pool = new Pool({ host: "127.0.0.1", port, database: "postgres", user: "postgres", password: "postgres", max: 1 });
    try {
      assert.deepEqual((await pool.query("SELECT 1 AS ok")).rows, [{ ok: 1 }]);
    } finally {
      await pool.end();
    }
  } finally {
    await localPostgres.close();
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test("client connections that reset do not use up the local PostgreSQL connection limit", async () => {
  const runtime = await import("./local-postgres.mjs");
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "asbir-local-postgres-leak-"));
  const port = await unusedPort();
  const localPostgres = await runtime.startLocalPostgres({ dataDirectory, port });
  const connection = { host: "127.0.0.1", port, database: "postgres", user: "postgres", password: "postgres" };
  try {
    for (let attempt = 0; attempt < 70; attempt += 1) {
      const pool = new Pool({ ...connection, max: 1 });
      const client = await pool.connect();
      await client.query("SELECT 1");
      client.connection.stream.resetAndDestroy();
      client.release(true);
      await pool.end().catch(() => undefined);
    }
    const pool = new Pool({ ...connection, max: 1, connectionTimeoutMillis: 5000 });
    try {
      assert.deepEqual((await pool.query("SELECT 1 AS ok")).rows, [{ ok: 1 }]);
    } finally {
      await pool.end();
    }
  } finally {
    await localPostgres.close();
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test("local PostgreSQL starts with the app schema and persists its seed across restarts", async () => {
  const runtime = await import("./local-postgres.mjs").catch(() => null);
  assert.ok(runtime, "the local PostgreSQL runtime must be available");
  assert.equal(typeof runtime.startLocalPostgres, "function");

  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "asbir-local-postgres-"));
  const port = await unusedPort();

  try {
    for (let restart = 0; restart < 2; restart += 1) {
      const localPostgres = await runtime.startLocalPostgres({ dataDirectory, port });
      const pool = new Pool({
        host: "127.0.0.1",
        port,
        database: "postgres",
        user: "postgres",
        password: "postgres",
        max: 1,
      });
      try {
        const result = await pool.query(
          `SELECT workspace.name AS workspace, project.name AS project
           FROM workspace JOIN project ON project.workspace_id = workspace.id
           WHERE project.id = 'local-test-project'`,
        );
        assert.deepEqual(result.rows, [{ workspace: "Local Test Workspace", project: "Local Test Project" }]);

        if (restart === 0) {
          const workerPools = Array.from({ length: 12 }, () => new Pool({
            host: "127.0.0.1",
            port,
            database: "postgres",
            user: "postgres",
            password: "postgres",
            max: 1,
          }));
          try {
            const workerResults = await Promise.allSettled(
              workerPools.map((workerPool) => workerPool.query("SELECT 1")),
            );
            assert.equal(
              workerResults.filter(({ status }) => status === "rejected").length,
              0,
              "the local database must accept connections from all Next.js development workers",
            );
          } finally {
            await Promise.all(workerPools.map((workerPool) => workerPool.end()));
          }
        }
      } finally {
        await pool.end();
        await localPostgres.close();
      }
    }
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
});
