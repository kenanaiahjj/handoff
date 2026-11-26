import assert from "node:assert/strict";
import test, { after } from "node:test";
import { readFile } from "node:fs/promises";
import { heartbeatCanvasPresence, leaveCanvasPresence, markHandoffVersionSeen } from "./canvas-presence.ts";
import { createPostgresTestFixture } from "../test-support/postgres-test-fixture.mjs";

const fixture = await createPostgresTestFixture();
const { pool } = fixture;
after(() => fixture.close());

await pool.query(`
  CREATE TABLE "user" (id TEXT PRIMARY KEY, name TEXT NOT NULL, image TEXT);
  CREATE TABLE handoff (id TEXT PRIMARY KEY);
  INSERT INTO "user" VALUES ('ana', 'Ana Lim', NULL), ('ben', 'Ben Ong', 'https://example.com/ben.png'), ('cai', 'Cai', NULL);
  INSERT INTO handoff VALUES ('h1'), ('h2');
`);
await pool.query(await readFile(new URL("../../../../../supabase/migrations/20261126150000_canvas_presence_and_seen.sql", import.meta.url), "utf8"));

const t0 = new Date("2026-11-26T10:00:00.000Z");
const later = (seconds) => new Date(t0.getTime() + seconds * 1000);

test("shows everyone else with the handoff open, and drops people who left or went quiet", async () => {
  assert.deepEqual(await heartbeatCanvasPresence({ handoffId: "h1", userId: "ana", versionId: "v2", screenId: null, x: null, y: null, now: t0 }), []);
  await heartbeatCanvasPresence({ handoffId: "h1", userId: "ben", versionId: "v2", screenId: "s1", x: 10.5, y: 20, now: later(1) });
  await heartbeatCanvasPresence({ handoffId: "h2", userId: "cai", versionId: "v9", screenId: null, x: null, y: null, now: later(1) });

  const seenByAna = await heartbeatCanvasPresence({ handoffId: "h1", userId: "ana", versionId: "v2", screenId: "s2", x: 1, y: 2, now: later(2) });
  assert.deepEqual(seenByAna, [{ userId: "ben", name: "Ben Ong", image: "https://example.com/ben.png", versionId: "v2", screenId: "s1", x: 10.5, y: 20 }]);

  // Ben's last heartbeat was 14 s ago: gone.
  assert.deepEqual(await heartbeatCanvasPresence({ handoffId: "h1", userId: "ana", versionId: "v2", screenId: null, x: null, y: null, now: later(15) }), []);

  await heartbeatCanvasPresence({ handoffId: "h1", userId: "ben", versionId: "v2", screenId: null, x: null, y: null, now: later(16) });
  await leaveCanvasPresence("h1", "ben");
  assert.deepEqual(await heartbeatCanvasPresence({ handoffId: "h1", userId: "ana", versionId: "v2", screenId: null, x: null, y: null, now: later(17) }), []);
});

test("compares with the version you had open last time, and keeps that across reloads", async () => {
  assert.equal(await markHandoffVersionSeen({ handoffId: "h1", userId: "ana", versionId: "v1" }), null, "first visit: nothing to compare with");
  assert.equal(await markHandoffVersionSeen({ handoffId: "h1", userId: "ana", versionId: "v1" }), null);
  assert.equal(await markHandoffVersionSeen({ handoffId: "h1", userId: "ana", versionId: "v3" }), "v1");
  assert.equal(await markHandoffVersionSeen({ handoffId: "h1", userId: "ana", versionId: "v3" }), "v1", "a reload keeps the same baseline");
  assert.equal(await markHandoffVersionSeen({ handoffId: "h1", userId: "ana", versionId: "v4" }), "v3");
  assert.equal(await markHandoffVersionSeen({ handoffId: "h1", userId: "ben", versionId: "v4" }), null, "each person has their own");
});
