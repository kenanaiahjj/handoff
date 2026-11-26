import assert from "node:assert/strict";
import test, { after } from "node:test";
import { checkAndTouchMcpClient, isConnectionActive, isMissingSchema, listMcpClientConnections, revokeMcpClientConnection } from "./mcp-clients.ts";
import { createPostgresTestFixture } from "../test-support/postgres-test-fixture.mjs";

const fixture = await createPostgresTestFixture();
const { pool } = fixture;
after(() => fixture.close());

await pool.query(`
  CREATE TABLE "user" (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '');
  CREATE TABLE workspace (id TEXT PRIMARY KEY);
  CREATE TABLE "oauthClient" ("clientId" TEXT PRIMARY KEY, name TEXT);
  CREATE TABLE "oauthRefreshToken" (id TEXT PRIMARY KEY, "clientId" TEXT NOT NULL, "userId" TEXT NOT NULL);
  CREATE TABLE "oauthAccessToken" (id TEXT PRIMARY KEY, "clientId" TEXT NOT NULL, "userId" TEXT);
  CREATE TABLE "oauthConsent" (id TEXT PRIMARY KEY, "clientId" TEXT NOT NULL, "userId" TEXT);
  INSERT INTO "user" VALUES ('ana', 'Ana', 'ana@example.com'), ('ben', 'Ben', 'ben@example.com');
  INSERT INTO workspace VALUES ('ws-a'), ('ws-b');
  INSERT INTO "oauthClient" VALUES ('claude', 'Claude Code'), ('codex', '');
`);

const t0 = new Date("2026-11-26T10:00:00.000Z");
const at = (minutes) => new Date(t0.getTime() + minutes * 60_000);
const seconds = (date) => Math.floor(date.getTime() / 1000);

test("treats a missing table or column as not migrated yet", () => {
  assert.equal(isMissingSchema({ code: "42P01" }), true);
  assert.equal(isMissingSchema({ code: "42703" }), true);
  assert.equal(isMissingSchema({ code: "23505" }), false);
  assert.equal(isMissingSchema(null), false);
});

test("records clients, throttles last-used, and revokes them", async () => {
  const migration = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../../../../../supabase/migrations/20261126140000_mcp_client_connections.sql", import.meta.url), "utf8"));
  await pool.query(`CREATE TABLE workspace_mcp_token (id TEXT PRIMARY KEY);`);
  await pool.query(migration);

  assert.equal(await checkAndTouchMcpClient({ userId: "ana", clientId: "claude", workspaceId: "ws-a", issuedAt: seconds(t0), now: t0 }), true);
  assert.equal(await checkAndTouchMcpClient({ userId: "ana", clientId: "claude", workspaceId: "ws-a", issuedAt: seconds(t0), now: at(2) }), true);
  assert.equal(await checkAndTouchMcpClient({ userId: "ben", clientId: "codex", workspaceId: "ws-a", issuedAt: seconds(t0), now: at(1) }), true);

  let all = await listMcpClientConnections({ workspaceId: "ws-a", userId: "ana", includeAll: true });
  assert.deepEqual(all.map((row) => [row.userName, row.clientName]), [["Ben", "AI client"], ["Ana", "Claude Code"]]);
  assert.equal(all.find((row) => row.userId === "ana").lastUsedAt, t0.toISOString(), "a call two minutes later is not written");

  await checkAndTouchMcpClient({ userId: "ana", clientId: "claude", workspaceId: "ws-a", issuedAt: seconds(t0), now: at(6) });
  all = await listMcpClientConnections({ workspaceId: "ws-a", userId: "ana", includeAll: true });
  assert.equal(all.find((row) => row.userId === "ana").lastUsedAt, at(6).toISOString());

  const own = await listMcpClientConnections({ workspaceId: "ws-a", userId: "ben", includeAll: false });
  assert.deepEqual(own.map((row) => row.userId), ["ben"]);

  // A reviewer can't disconnect someone else's client, and nobody can from another workspace.
  assert.equal(await revokeMcpClientConnection({ workspaceId: "ws-a", userId: "ana", clientId: "claude", actorId: "ben", canManageAll: false }), false);
  assert.equal(await revokeMcpClientConnection({ workspaceId: "ws-b", userId: "ana", clientId: "claude", actorId: "ana", canManageAll: true }), false);

  await pool.query(`INSERT INTO "oauthRefreshToken" VALUES ('r1', 'claude', 'ana'), ('r2', 'codex', 'ben');
    INSERT INTO "oauthAccessToken" VALUES ('a1', 'claude', 'ana');
    INSERT INTO "oauthConsent" VALUES ('c1', 'claude', 'ana');`);
  assert.equal(await revokeMcpClientConnection({ workspaceId: "ws-a", userId: "ana", clientId: "claude", actorId: "ben", canManageAll: true, now: at(10) }), true);
  const { rows: refresh } = await pool.query(`SELECT id FROM "oauthRefreshToken" ORDER BY id`);
  assert.deepEqual(refresh.map((row) => row.id), ["r2"], "only Ana's Claude Code refresh token is deleted");
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM "oauthConsent"`)).rows[0].n, 0);

  // Tokens issued before the revoke stop working; a fresh sign-in afterwards works and reconnects it.
  assert.equal(await checkAndTouchMcpClient({ userId: "ana", clientId: "claude", workspaceId: "ws-a", issuedAt: seconds(at(9)), now: at(11) }), false);
  assert.equal(await checkAndTouchMcpClient({ userId: "ana", clientId: "claude", workspaceId: "ws-a", issuedAt: null, now: at(11) }), false);
  let ana = (await listMcpClientConnections({ workspaceId: "ws-a", userId: "ana", includeAll: false }))[0];
  assert.equal(isConnectionActive(ana), false);

  assert.equal(await checkAndTouchMcpClient({ userId: "ana", clientId: "claude", workspaceId: "ws-a", issuedAt: seconds(at(12)), now: at(12) }), true);
  ana = (await listMcpClientConnections({ workspaceId: "ws-a", userId: "ana", includeAll: false }))[0];
  assert.equal(isConnectionActive(ana), true);

  // The sign-in is the person's, so revoking it also blocks the same client in their other workspace.
  assert.equal(await checkAndTouchMcpClient({ userId: "ben", clientId: "codex", workspaceId: "ws-b", issuedAt: seconds(at(1)), now: at(13) }), true);
  await revokeMcpClientConnection({ workspaceId: "ws-a", userId: "ben", clientId: "codex", actorId: "ben", canManageAll: false, now: at(14) });
  assert.equal(await checkAndTouchMcpClient({ userId: "ben", clientId: "codex", workspaceId: "ws-b", issuedAt: seconds(at(1)), now: at(15) }), false);
});
